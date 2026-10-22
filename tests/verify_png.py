"""Verifica de forma independente os PNGs que o JavaScript gerou.

O ponto: não confiar no próprio encoder. Abrimos o arquivo com Pillow e
checamos os chunks na mão.
"""
import os
import struct
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

failures = 0
passes = 0


def check(cond, label, extra=""):
    global failures, passes
    if cond:
        passes += 1
        print(f"  ok   {label}" + (f"  [{extra}]" if extra else ""))
    else:
        failures += 1
        print(f"  FAIL {label}" + (f"  [{extra}]" if extra else ""))


def chunks(path):
    with open(path, "rb") as fh:
        data = fh.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "assinatura inválida"
    pos = 8
    out = []
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8].decode("ascii")
        body = data[pos + 8:pos + 8 + length]
        crc = struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])[0]
        out.append((ctype, body, crc))
        pos += 12 + length
    return out


def verify(path, expected_size, label):
    print(f"\n== {label} ({os.path.basename(path)}) ==")
    cs = chunks(path)
    types = [c[0] for c in cs]
    check(types[0] == "IHDR", "primeiro chunk é IHDR")
    check(types[-1] == "IEND", "último chunk é IEND")
    check("PLTE" in types, "tem PLTE")

    ihdr = cs[0][1]
    w, h, depth, ctype = struct.unpack(">IIBB", ihdr[:10])
    check(ctype == 3, "color type 3 (paleta)", str(ctype))
    check(depth == 8, "bit depth 8", str(depth))
    check((w, h) == expected_size, f"dimensões {expected_size}", f"{w}x{h}")

    plte = [c for c in cs if c[0] == "PLTE"][0][1]
    check(len(plte) % 3 == 0 and 0 < len(plte) <= 768, "PLTE com 1..256 cores", f"{len(plte)//3} cores")

    trns = [c for c in cs if c[0] == "tRNS"]
    check(bool(trns), "tRNS presente (transparência)")

    img = Image.open(path)
    check(img.mode == "P", "Pillow lê como P (indexado)", img.mode)

    rgba = img.convert("RGBA")
    alphas = set(rgba.getchannel("A").tobytes())
    check(alphas <= {0, 255}, "nenhum alpha parcial (sem antialias)", str(sorted(alphas)))

    colors = img.convert("RGB").getcolors(maxcolors=70000) or []
    n = len(colors) + 1
    check(n <= 17, "poucas cores distintas", str(n))

    check(img.size == expected_size, "Pillow confirma o tamanho", str(img.size))
    return rgba


def main() -> int:
    if not os.path.isdir(OUT):
        print("nada para verificar: rode test-core.mjs primeiro")
        return 0

    p1 = os.path.join(OUT, "result.png")
    p8 = os.path.join(OUT, "result@8x.png")
    for p in (p1, p8):
        if not os.path.exists(p):
            print(f"ausente: {p}")
            return 1

    verify(p1, (64, 64), "resultado 1x")
    rgba8 = verify(p8, (512, 512), "resultado 8x")

    # o upscale nearest não pode ter inventado cor nenhuma
    src = Image.open(p1).convert("RGBA")
    up = Image.open(p8).convert("RGBA")
    expect = src.resize((src.width * 8, src.height * 8), Image.NEAREST)
    check(up.tobytes() == expect.tobytes(), "8x é nearest-neighbor exato")

    print("\n----------------------------------------")
    print(f"{passes} passaram, {failures} falharam")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
