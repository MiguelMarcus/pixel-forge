"""Lê os .aseprite gerados usando só a spec do formato e compara com o PNG.

Dois níveis de confiança:
  1. o mesmo parser precisa ler um .aseprite escrito pelo próprio Aseprite
     (tests/fixtures/cavaleiro-64.aseprite) — se ele lê o arquivo real, o
     entendimento do container está certo;
  2. os arquivos gerados precisam reconstruir exatamente os mesmos pixels do PNG.

O app exporta em RGB (depth 32, paleta 0x0004). O modo indexado (depth 8,
paleta 0x2019) também é verificado.
"""
import os
import struct
import sys
import zlib

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
REF = os.path.join(HERE, "fixtures", "cavaleiro-64.aseprite")
REF_PNG = os.path.join(HERE, "fixtures", "cavaleiro-64.png")

passes = 0
failures = 0


def check(cond, label, extra=""):
    global passes, failures
    if cond:
        passes += 1
        print(f"  ok   {label}" + (f"  [{extra}]" if extra else ""))
    else:
        failures += 1
        print(f"  FAIL {label}" + (f"  [{extra}]" if extra else ""))


def parse(path):
    with open(path, "rb") as fh:
        d = fh.read()

    if len(d) < 128:
        raise ValueError("arquivo menor que o header")
    fsize, magic, frames, w, h, depth = struct.unpack_from("<IHHHHH", d, 0)
    if magic != 0xA5E0:
        raise ValueError(f"magic invalido: {magic:#x}")
    if fsize != len(d):
        raise ValueError(f"tamanho do header {fsize} != arquivo {len(d)}")
    if depth not in (8, 16, 32):
        raise ValueError(f"color depth inesperado: {depth}")

    meta = {
        "w": w, "h": h, "depth": depth, "frames": frames,
        "transparent": d[28],
        "ncolors": struct.unpack_from("<H", d, 32)[0],
        "layers": [], "cels": [], "palette": [], "durations": [],
    }

    pos = 128
    for _ in range(frames):
        if pos + 16 > len(d):
            raise ValueError("frame header fora do arquivo")
        bframe, fmagic, oldn, dur = struct.unpack_from("<IHHH", d, pos)
        newn = struct.unpack_from("<I", d, pos + 12)[0]
        if fmagic != 0xF1FA:
            raise ValueError(f"frame magic invalido: {fmagic:#x}")
        if bframe < 16 or pos + bframe > len(d):
            raise ValueError("tamanho de frame invalido")

        n = newn or oldn
        cp = pos + 16
        for _ in range(n):
            if cp + 6 > len(d):
                raise ValueError("chunk header fora do arquivo")
            csize, ctype = struct.unpack_from("<IH", d, cp)
            if csize < 6 or cp + csize > pos + bframe:
                raise ValueError(f"chunk {ctype:#06x} com tamanho invalido ({csize})")

            if ctype == 0x2019:                     # paleta com alfa
                psize, first, last = struct.unpack_from("<III", d, cp + 6)
                q = cp + 26
                for i in range(first, last + 1):
                    fl, r, g, b, a = struct.unpack_from("<HBBBB", d, q)
                    q += 6
                    if fl & 1:
                        nlen = struct.unpack_from("<H", d, q)[0]
                        q += 2 + nlen
                    while len(meta["palette"]) <= i:
                        meta["palette"].append((0, 0, 0, 0))
                    meta["palette"][i] = (r, g, b, a)
                if psize != max(psize, len(meta["palette"])):
                    raise ValueError("paleta menor que o declarado")

            elif ctype == 0x0004:                   # paleta antiga (sem alfa)
                packets = struct.unpack_from("<H", d, cp + 6)[0]
                q = cp + 8
                idx = 0
                for _ in range(packets):
                    skip = d[q]
                    ncol = d[q + 1]
                    q += 2
                    idx += skip
                    if ncol == 0:
                        ncol = 256
                    for _ in range(ncol):
                        r, g, b = d[q], d[q + 1], d[q + 2]
                        q += 3
                        while len(meta["palette"]) <= idx:
                            meta["palette"].append((0, 0, 0, 255))
                        meta["palette"][idx] = (r, g, b, 255)
                        idx += 1

            elif ctype == 0x2004:                   # layer
                lf, lt, child, dw, dh, blend = struct.unpack_from("<HHHHHH", d, cp + 6)
                op = d[cp + 18]
                nlen = struct.unpack_from("<H", d, cp + 22)[0]
                name = d[cp + 24:cp + 24 + nlen].decode("utf-8", "replace")
                meta["layers"].append({"flags": lf, "type": lt, "opacity": op, "name": name})

            elif ctype == 0x2005:                   # cel
                li, x, y = struct.unpack_from("<Hhh", d, cp + 6)
                op = d[cp + 12]
                ct = struct.unpack_from("<H", d, cp + 13)[0]
                cw, ch = struct.unpack_from("<HH", d, cp + 22)
                payload = d[cp + 26:cp + csize]
                if ct == 2:
                    payload = zlib.decompress(payload)
                elif ct != 0:
                    raise ValueError(f"cel type {ct} nao suportado")
                expected = cw * ch * (4 if depth == 32 else 1)
                if len(payload) != expected:
                    raise ValueError(f"cel com {len(payload)} bytes, esperado {expected}")
                meta["cels"].append({"layer": li, "x": x, "y": y, "w": cw, "h": ch,
                                     "type": ct, "data": payload})

            cp += csize

        if cp != pos + bframe:
            raise ValueError(f"chunks somam {cp - pos}, frame declara {bframe}")
        meta["durations"].append(dur)
        pos += bframe

    if pos != len(d):
        raise ValueError("frames nao fecham no fim do arquivo")
    return meta


def to_rgba(meta):
    w, h = meta["w"], meta["h"]
    canvas = [(0, 0, 0, 0)] * (w * h)
    for cel in meta["cels"]:
        cw, ch = cel["w"], cel["h"]
        data = cel["data"]
        for yy in range(ch):
            Y = cel["y"] + yy
            if Y < 0 or Y >= h:
                continue
            for xx in range(cw):
                X = cel["x"] + xx
                if X < 0 or X >= w:
                    continue
                i = yy * cw + xx
                if meta["depth"] == 32:
                    px = tuple(data[i * 4:i * 4 + 4])
                elif meta["depth"] == 16:
                    v = data[i * 2]
                    px = (v, v, v, data[i * 2 + 1])
                else:
                    idx = data[i]
                    px = meta["palette"][idx] if idx < len(meta["palette"]) else (0, 0, 0, 0)
                canvas[Y * w + X] = px
    return canvas


def compare_pixels(meta, png_path):
    rgba = to_rgba(meta)
    png = Image.open(png_path).convert("RGBA")
    if png.size != (meta["w"], meta["h"]):
        return False, f"{png.size} vs {(meta['w'], meta['h'])}"
    pb = png.tobytes()
    diff = 0
    for i, px in enumerate(rgba):
        if px != (pb[i * 4], pb[i * 4 + 1], pb[i * 4 + 2], pb[i * 4 + 3]):
            diff += 1
    return diff == 0, f"{diff} pixels diferentes"


def main():
    rgba_path = os.path.join(OUT, "result.aseprite")
    idx_path = os.path.join(OUT, "result-indexed.aseprite")
    png_path = os.path.join(OUT, "result.png")
    for p in (rgba_path, idx_path, png_path):
        if not os.path.exists(p):
            print(f"ausente: {p}")
            return 1

    print("\n== parser no arquivo real do Aseprite ==")
    if not os.path.exists(REF):
        print("  --   referencia ausente, pulando")
    else:
        ref = parse(REF)
        check(ref["w"] == 64 and ref["h"] == 64, "referencia 64x64", f"{ref['w']}x{ref['h']}")
        check(ref["depth"] == 32, "referencia em RGBA", str(ref["depth"]))
        check(len(ref["layers"]) >= 1, "referencia tem layer", ref["layers"][0]["name"])
        rgba_ref = to_rgba(ref)
        opaque = sum(1 for p in rgba_ref if p[3] > 0)
        check(opaque > 100, "referencia decodifica pixels", f"{opaque} px opacos")
        png_ref = Image.open(REF_PNG).convert("RGBA")
        rb = png_ref.tobytes()
        ref_pixels = [tuple(rb[i:i + 4]) for i in range(0, len(rb), 4)]
        same = sum(1 for x, y in zip(rgba_ref, ref_pixels) if x == y)
        check(same / len(rgba_ref) > 0.99, "leitura da referencia == PNG original",
              f"{(same / len(rgba_ref) * 100):.1f}%")

    print("\n== .aseprite em RGB (o que o app exporta) ==")
    m = parse(rgba_path)
    check(m["depth"] == 32, "color depth 32 (RGB, sem trava de paleta)", str(m["depth"]))
    check(m["frames"] == 1, "1 frame", str(m["frames"]))
    check(m["w"] == 64 and m["h"] == 64, "64x64", f"{m['w']}x{m['h']}")
    check(len(m["layers"]) == 1, "1 layer", m["layers"][0]["name"] if m["layers"] else "-")
    check(m["layers"][0]["flags"] & 1 == 1, "layer visivel")
    check(len(m["cels"]) == 1, "1 cel")
    check(m["transparent"] == 0, "sem índice transparente marcado")
    check(len(m["palette"]) >= 8, "paleta de referência incluída", f"{len(m['palette'])} cores")
    ok, detail = compare_pixels(m, png_path)
    check(ok, "pixels idênticos ao PNG exportado", detail)

    print("\n== .aseprite indexado ==")
    mi = parse(idx_path)
    check(mi["depth"] == 8, "color depth 8", str(mi["depth"]))
    check(len(mi["palette"]) >= 2, "paleta presente", f"{len(mi['palette'])} cores")
    check(mi["transparent"] < max(1, len(mi["palette"])),
          "índice transparente válido", str(mi["transparent"]))
    ok2, detail2 = compare_pixels(mi, png_path)
    check(ok2, "pixels idênticos ao PNG exportado", detail2)

    print("\n----------------------------------------")
    print(f"{passes} passaram, {failures} falharam")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
