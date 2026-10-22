/*
 * Encoder .aseprite (Aseprite file format).
 *
 * Escreve um sprite indexado de 1 frame e 1 layer:
 *   header (128) + frame header (16) + chunk de paleta (0x2019)
 *   + chunk de layer (0x2004) + chunk de cel (0x2005, zlib)
 *
 * Em modo indexado a cor vem da paleta e a transparência vem do alpha da
 * entrada — o pixel guarda só o índice. É o formato que mantém o padrão
 * travado quando o arquivo é reaberto no Aseprite.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else factory(root.PF);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';

  var HEADER_SIZE = 128;
  var MAGIC = 0xA5E0;
  var FRAME_MAGIC = 0xF1FA;

  var CHUNK_LAYER = 0x2004;
  var CHUNK_CEL = 0x2005;
  var CHUNK_PALETTE = 0x2019;

  /* ---------------------------------------------------------------- writer */

  function Writer() {
    this.buf = new Uint8Array(4096);
    this.pos = 0;
  }

  Writer.prototype._need = function (n) {
    if (this.pos + n <= this.buf.length) return;
    var cap = this.buf.length;
    while (cap < this.pos + n) cap *= 2;
    var next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  };
  Writer.prototype.u8 = function (v) {
    this._need(1);
    this.buf[this.pos++] = v & 255;
    return this;
  };
  Writer.prototype.u16 = function (v) {
    this._need(2);
    this.buf[this.pos++] = v & 255;
    this.buf[this.pos++] = (v >>> 8) & 255;
    return this;
  };
  Writer.prototype.u32 = function (v) {
    this._need(4);
    this.buf[this.pos++] = v & 255;
    this.buf[this.pos++] = (v >>> 8) & 255;
    this.buf[this.pos++] = (v >>> 16) & 255;
    this.buf[this.pos++] = (v >>> 24) & 255;
    return this;
  };
  Writer.prototype.zero = function (n) {
    this._need(n);
    for (var i = 0; i < n; i++) this.buf[this.pos++] = 0;
    return this;
  };
  Writer.prototype.raw = function (arr) {
    this._need(arr.length);
    this.buf.set(arr, this.pos);
    this.pos += arr.length;
    return this;
  };
  Writer.prototype.bytes = function () {
    return this.buf.subarray(0, this.pos);
  };

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  /* ---------------------------------------------------------------- chunks */

  function paletteChunk(palette) {
    // size = header 6 + (newSize 4 + first 4 + last 4 + future 8) + 6 por cor
    var w = new Writer();
    w.u32(6 + 20 + palette.length * 6);
    w.u16(CHUNK_PALETTE);
    w.u32(palette.length);
    w.u32(0);
    w.u32(palette.length - 1);
    w.zero(8);
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i];
      w.u16(0); // flags
      w.u8(c.r & 255);
      w.u8(c.g & 255);
      w.u8(c.b & 255);
      w.u8(c.a === undefined ? 255 : c.a & 255);
    }
    return w.bytes();
  }

  /* Chunk antigo (0x0004): sem alfa, mas é o que o Aseprite grava em modo RGB.
   * Um pacote com todas as cores, que é como o próprio Aseprite salva. */
  function oldPaletteChunk(palette) {
    var n = palette.length;
    var w = new Writer();
    w.u32(6 + 2 + 1 + 1 + n * 3);
    w.u16(0x0004);
    w.u16(1);                       // número de pacotes
    w.u8(0);                        // cores a pular
    w.u8(n === 256 ? 0 : n);        // 0 significa 256
    for (var i = 0; i < n; i++) {
      w.u8(palette[i].r & 255);
      w.u8(palette[i].g & 255);
      w.u8(palette[i].b & 255);
    }
    return w.bytes();
  }

  function rgbaBytes(asset) {
    var n = asset.width * asset.height;
    var out = new Uint8Array(n * 4);
    var t = asset.transparentIndex;
    for (var i = 0; i < n; i++) {
      var v = asset.indices[i];
      var o = i * 4;
      if (v === t) continue;                 // já está zerado
      var c = asset.palette[v];
      if (!c || c.a === 0) continue;
      out[o] = c.r;
      out[o + 1] = c.g;
      out[o + 2] = c.b;
      out[o + 3] = c.a == null ? 255 : c.a;
    }
    return out;
  }

  function layerChunk(name) {
    var n = utf8(name);
    var w = new Writer();
    w.u32(6 + 16 + 2 + n.length);
    w.u16(CHUNK_LAYER);
    w.u16(3);    // visível | editável
    w.u16(0);    // layer normal (imagem)
    w.u16(0);    // child level
    w.u16(0);    // largura padrão (ignorada)
    w.u16(0);    // altura padrão (ignorada)
    w.u16(0);    // blend mode normal
    w.u8(255);   // opacidade
    w.zero(3);
    w.u16(n.length);
    w.raw(n);
    return w.bytes();
  }

  function celChunk(width, height, data, compressed) {
    var w = new Writer();
    w.u32(6 + 16 + 4 + data.length);
    w.u16(CHUNK_CEL);
    w.u16(0);   // layer index
    w.u16(0);   // x
    w.u16(0);   // y
    w.u8(255);  // opacidade
    w.u16(compressed ? 2 : 0); // 0 = raw, 2 = imagem comprimida (zlib)
    w.u16(0);   // z-index
    w.zero(5);
    w.u16(width);
    w.u16(height);
    w.raw(data);
    return w.bytes();
  }

  /* Confere o que o Aseprite vai ler primeiro; se algo não bate, é melhor
   * falhar aqui (com mensagem) do que entregar um arquivo que não abre. */
  function verify(bytes) {
    if (bytes.length < HEADER_SIZE) throw new Error('.aseprite curto demais (' + bytes.length + ' bytes)');
    var magic = bytes[4] | (bytes[5] << 8);
    if (magic !== MAGIC) throw new Error('magic inválido: 0x' + magic.toString(16));
    var declared = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
    if (declared !== bytes.length) {
      throw new Error('tamanho declarado ' + declared + ' != arquivo ' + bytes.length);
    }
    return true;
  }

  /* ---------------------------------------------------------------- encode */

  function encode(asset, opts) {
    opts = opts || {};
    var rgba = opts.colorDepth === 'rgba';
    var palette = (asset.palette || []).slice();
    var width = asset.width, height = asset.height;

    if (!width || !height) return Promise.reject(new Error('asset sem dimensão'));
    if (width > 0xFFFF || height > 0xFFFF) return Promise.reject(new Error('dimensão grande demais'));
    if (!palette.length) return Promise.reject(new Error('paleta vazia'));

    var layerName = String(opts.layerName || 'Pixel Forge').slice(0, 200);
    var transparent = 0;

    if (rgba) {
      /* Em RGB a paleta é só referência (a barra de cores do Aseprite) e não
       * trava nada: dá pra pintar com qualquer cor. Alpha vem do pixel. */
      palette = palette.filter(function (c) { return c.a > 0; });
      if (!palette.length) return Promise.reject(new Error('paleta sem cores opacas'));
    } else {
      /* Indexado: o header aponta um índice transparente. Se o sprite é opaco
       * não existe esse índice, então criamos uma entrada só pra ele. */
      transparent = asset.transparentIndex;
      if (transparent == null || transparent < 0) {
        if (palette.length >= 256) return Promise.reject(new Error('Aseprite aceita no máximo 256 cores'));
        palette.push({ r: 0, g: 0, b: 0, a: 0 });
        transparent = palette.length - 1;
      }
    }
    if (palette.length > 256) return Promise.reject(new Error('Aseprite aceita no máximo 256 cores'));

    var raw = rgba ? rgbaBytes(asset) : asset.indices;

    function assemble(celData, compressed) {
      var pal = rgba ? oldPaletteChunk(palette) : paletteChunk(palette);
      var layer = layerChunk(layerName);
      var cel = celChunk(width, height, celData, compressed);
      var frameLen = 16 + pal.length + layer.length + cel.length;

      var w = new Writer();

      /* header — 128 bytes */
      w.u32(HEADER_SIZE + frameLen); // tamanho do arquivo
      w.u16(MAGIC);
      w.u16(1);                      // frames
      w.u16(width);
      w.u16(height);
      w.u16(rgba ? 32 : 8);          // color depth
      w.u32(1);                      // flags
      w.u16(100);                    // speed (ms)
      w.u32(0);
      w.u32(0);
      w.u8(transparent);             // índice transparente
      w.zero(3);
      w.u16(palette.length);         // número de cores
      w.u8(1);                       // pixel ratio
      w.u8(1);
      w.u16(0);                      // grid x
      w.u16(0);                      // grid y
      w.u16(0);                      // grid largura
      w.u16(0);                      // grid altura
      w.zero(84);

      /* frame header — 16 bytes */
      w.u32(frameLen);
      w.u16(FRAME_MAGIC);
      w.u16(3);                      // chunks (campo antigo)
      w.u16(100);                    // duração do frame (ms)
      w.zero(2);
      w.u32(3);                      // chunks (campo novo)

      w.raw(pal);
      w.raw(layer);
      w.raw(cel);

      var view = w.bytes();
      var out = new Uint8Array(view.length);
      out.set(view);
      if (out.length !== HEADER_SIZE + frameLen) {
        throw new Error('tamanho inconsistente no .aseprite');
      }
      verify(out);
      return out;
    }

    if (opts.uncompressed) {
      return Promise.resolve(assemble(raw, false));
    }

    var compress = opts.deflate || PF.zlibDeflate;
    return Promise.resolve(compress(raw)).then(function (z) {
      return assemble(new Uint8Array(z), true);
    });
  }

  if (PF) {
    PF.encodeAseprite = encode;
    PF.aseprite = { encode: encode };
  }

  return { encode: encode };
});
