/*
 * Pixel Forge — núcleo determinístico.
 *
 * Nada aqui depende do DOM: o mesmo arquivo roda no navegador (window.PF)
 * e no Node (module.exports), o que permite testar o pipeline de verdade.
 *
 * Modelo de dados:
 *   Image  = { width, height, data: Uint8ClampedArray RGBA }
 *   Asset  = { width, height, indices: Uint8Array, palette: [{r,g,b,a}],
 *              transparentIndex: int, outlineIndex: int }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Paletas                                                             */
  /* ------------------------------------------------------------------ */

  var PALETTE_DEFS = {
    pico8: {
      name: 'PICO-8',
      colors: ['000000', '1D2B53', '7E2553', '008751', 'AB5236', '5F574F', 'C2C3C7', 'FFF1E8',
        'FF004D', 'FFA300', 'FFEC27', '00E436', '29ADFF', '83769C', 'FF77A8', 'FFCCAA']
    },
    gameboy: {
      name: 'Game Boy',
      colors: ['0F380F', '306230', '8BAC0F', '9BBC0F']
    },
    db16: {
      name: 'DawnBringer 16',
      colors: ['140C1C', '442434', '30346D', '4E4A4E', '854C30', '346524', 'D04648', '757161',
        '597DCE', 'D27D2C', '8595A1', '6DAA2C', 'D2AA99', '6DC2CA', 'DAD45E', 'DEEED6']
    },
    sweetie16: {
      name: 'Sweetie 16',
      colors: ['1A1C2C', '5D275D', 'B13E53', 'EF7D57', 'FFCD75', 'A7F070', '38B764', '257179',
        '29366F', '3B5DC9', '41A6F6', '73EFF7', 'F4F4F4', '94B0C2', '566C86', '333C57']
    },
    ash4: {
      name: 'Ash 4 (mono)',
      colors: ['1A1A1A', '4D4D4D', 'A6A6A6', 'F2F2F2']
    }
  };

  function hexToRgb(hex) {
    var h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 8) h = h.slice(0, 6);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function rgbToHex(c) {
    function p(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16).toUpperCase(); }
    return '#' + p(c.r) + p(c.g) + p(c.b);
  }

  function paletteFromHexList(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = hexToRgb(list[i]);
      if (c) out.push({ r: c.r, g: c.g, b: c.b, a: 255 });
    }
    return out;
  }

  function parsePalette(text) {
    if (!text) return [];
    var parts = String(text).split(/[\s,;]+/).filter(Boolean);
    var list = [];
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$/.test(t) || /^[0-9a-fA-F]{6}$/.test(t) || /^[0-9a-fA-F]{8}$/.test(t)) list.push(t);
    }
    return paletteFromHexList(list);
  }

  function resolvedPalettes() {
    var out = {};
    for (var k in PALETTE_DEFS) {
      if (!Object.prototype.hasOwnProperty.call(PALETTE_DEFS, k)) continue;
      out[k] = { name: PALETTE_DEFS[k].name, colors: paletteFromHexList(PALETTE_DEFS[k].colors) };
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Imagem                                                              */
  /* ------------------------------------------------------------------ */

  function createImage(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  function cloneImage(img) {
    return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  }

  function applyForegroundMask(img, mask) {
    if (!mask || mask.length !== img.width * img.height) {
      throw new Error('máscara de segmentação incompatível com a imagem');
    }
    var out = cloneImage(img);
    for (var i = 0; i < mask.length; i++) {
      out.data[i * 4 + 3] = Math.round(out.data[i * 4 + 3] * mask[i] / 255);
    }
    return out;
  }

  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  /* Remove fundo por flood fill a partir das bordas. Só apaga o que é
   * conectado ao fundo, então um olho branco dentro do sprite sobrevive. */
  function removeBackground(img, target, tolerance) {
    var w = img.width, h = img.height;
    var out = cloneImage(img);
    var src = img.data, dst = out.data;
    var tr = target.r, tg = target.g, tb = target.b;
    var tol = Math.max(0, tolerance | 0);
    var seen = new Uint8Array(w * h);
    var stack = new Int32Array(w * h);
    var sp = 0;

    function matches(i) {
      var p = i * 4;
      if (src[p + 3] === 0) return true;
      return Math.abs(src[p] - tr) <= tol &&
        Math.abs(src[p + 1] - tg) <= tol &&
        Math.abs(src[p + 2] - tb) <= tol;
    }
    function push(i) {
      if (i < 0 || i >= w * h || seen[i] || !matches(i)) return;
      seen[i] = 1;
      stack[sp++] = i;
    }

    for (var x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }

    while (sp > 0) {
      var i = stack[--sp];
      var p = i * 4;
      dst[p + 3] = 0;
      var cx = i % w, cy = (i - cx) / w;
      if (cx > 0) push(i - 1);
      if (cx < w - 1) push(i + 1);
      if (cy > 0) push(i - w);
      if (cy < h - 1) push(i + w);
    }
    return out;
  }

  function boundsOfOpaque(img) {
    var w = img.width, h = img.height, d = img.data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function cropImage(img, box) {
    var out = createImage(box.w, box.h);
    for (var y = 0; y < box.h; y++) {
      var s = ((y + box.y) * img.width + box.x) * 4;
      out.data.set(img.data.subarray(s, s + box.w * 4), y * box.w * 4);
    }
    return out;
  }

  function autoCrop(img) {
    var b = boundsOfOpaque(img);
    if (!b) return { image: img, box: null };
    if (b.x === 0 && b.y === 0 && b.w === img.width && b.h === img.height) return { image: img, box: b };
    return { image: cropImage(img, b), box: b };
  }

  /* ------------------------------------------------------------------ */
  /* Reamostragem                                                        */
  /*   box      -> média (premultiplied, sem halo escuro)                */
  /*   dominant -> cor mais frequente da célula (evita cor fantasma)     */
  /*   nearest  -> amostra central                                       */
  /* ------------------------------------------------------------------ */

  /* Histograma 5 bits/canal reutilizado entre células (evita alocar
   * objeto por bucket no caminho quente da amostragem dominante). */
  var DOM_SIZE = 32768;
  var DOM_BUF = null;
  var DOM_STAMP = 0;

  function resample(src, dw, dh, mode) {
    if (dw === src.width && dh === src.height) return cloneImage(src);
    var sw = src.width, sh = src.height;
    var out = createImage(dw, dh);
    var sd = src.data, od = out.data;
    var dom = null;

    var exact = mode === 'clean' || mode === 'structure' || mode === 'shape';
    if (mode === 'dominant') {
      if (!DOM_BUF) {
        DOM_BUF = {
          gen: new Uint32Array(DOM_SIZE), n: new Float64Array(DOM_SIZE),
          r: new Float64Array(DOM_SIZE), g: new Float64Array(DOM_SIZE),
          b: new Float64Array(DOM_SIZE), keys: new Int32Array(DOM_SIZE)
        };
      }
      dom = DOM_BUF;
    }

    for (var y = 0; y < dh; y++) {
      var y0 = Math.floor((y * sh) / dh);
      var y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * sh) / dh));
      if (y1 > sh) y1 = sh;

      for (var x = 0; x < dw; x++) {
        // cada célula precisa de um carimbo novo: o histograma é reaproveitado
        if (dom) {
          DOM_STAMP++;
          if (DOM_STAMP > 0xFFFFFFF0) { dom.gen.fill(0); DOM_STAMP = 1; }
        }
        var x0 = Math.floor((x * sw) / dw);
        var x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * sw) / dw));
        if (x1 > sw) x1 = sw;

        var o = (y * dw + x) * 4;
        var votes = exact ? new Map() : null;

        if (mode === 'nearest') {
          var sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
          var sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
          var si = (sy * sw + sx) * 4;
          od[o] = sd[si]; od[o + 1] = sd[si + 1]; od[o + 2] = sd[si + 2]; od[o + 3] = sd[si + 3];
          continue;
        }

        var center = null;
        var centerX = 0, centerY = 0;
        if (mode === 'shape') {
          centerX = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
          centerY = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
          center = (centerY * sw + centerX) * 4;
        }

        var sa = 0, sr = 0, sg = 0, sb = 0, n = 0, countA = 0, nKeys = 0;

        for (var yy = y0; yy < y1; yy++) {
          for (var xx = x0; xx < x1; xx++) {
            var i = (yy * sw + xx) * 4;
            var a = sd[i + 3];
            // Exact pixel/cell overlap matters at non-integer reduction ratios.
            var weight = (Math.min(xx + 1, (x + 1) * sw / dw) - Math.max(xx, x * sw / dw)) *
              (Math.min(yy + 1, (y + 1) * sh / dh) - Math.max(yy, y * sh / dh));
            n += weight;
            countA += a * weight;
            if (a === 0) continue;

            var coverage = a * weight;
            sa += coverage;

            if (votes) {
              var rgbKey = (sd[i] << 16) | (sd[i + 1] << 8) | sd[i + 2];
              votes.set(rgbKey, (votes.get(rgbKey) || 0) + coverage);
            } else if (dom) {
              var key = ((sd[i] >> 3) << 10) | ((sd[i + 1] >> 3) << 5) | (sd[i + 2] >> 3);
              if (dom.gen[key] !== DOM_STAMP) {
                dom.gen[key] = DOM_STAMP;
                dom.n[key] = 0; dom.r[key] = 0; dom.g[key] = 0; dom.b[key] = 0;
                dom.keys[nKeys++] = key;
              }
              dom.n[key] += coverage;
              dom.r[key] += sd[i] * coverage;
              dom.g[key] += sd[i + 1] * coverage;
              dom.b[key] += sd[i + 2] * coverage;
            } else {
              sr += sd[i] * coverage; sg += sd[i + 1] * coverage; sb += sd[i + 2] * coverage;
            }
          }
        }

        if (sa === 0) {
          od[o] = 0; od[o + 1] = 0; od[o + 2] = 0; od[o + 3] = 0;
          continue;
        }

        var alpha = Math.round(countA / n);
        if (mode === 'shape') {
          var connectedCenter = false;
          if (sd[center + 3] >= 128) {
            for (var oy = -1; oy <= 1 && !connectedCenter; oy++) {
              for (var ox = -1; ox <= 1; ox++) {
                if (!ox && !oy) continue;
                var nx = centerX + ox, ny = centerY + oy;
                if (nx >= 0 && nx < sw && ny >= 0 && ny < sh &&
                    sd[(ny * sw + nx) * 4 + 3] >= 128) {
                  connectedCenter = true;
                  break;
                }
              }
            }
          }
          // Preserve a connected thin stroke through the cell center, not isolated noise.
          alpha = alpha >= 128 || (connectedCenter && alpha >= 32) ? 255 : 0;
        }
        od[o + 3] = alpha;

        if (votes) {
          var winner = -1, winnerWeight = -1;
          votes.forEach(function (value, key) {
            // Stable RGB ordering breaks exact ties independently of scan order.
            if (value > winnerWeight + 1e-8 || (Math.abs(value - winnerWeight) <= 1e-8 && key < winner)) {
              winner = key; winnerWeight = value;
            }
          });
          if (mode === 'shape') {
            var centerKey = (sd[center] << 16) | (sd[center + 1] << 8) | sd[center + 2];
            var centerWeight = votes.get(centerKey) || 0;
            // Keep centered details with meaningful area support, not isolated specks.
            if (centerWeight >= winnerWeight * 0.35) winner = centerKey;
          }
          od[o] = winner >> 16; od[o + 1] = (winner >> 8) & 255; od[o + 2] = winner & 255;
        } else if (dom) {
          var bestKey = -1, bestN = -1;
          for (var k = 0; k < nKeys; k++) {
            var kk = dom.keys[k];
            if (dom.n[kk] > bestN + 1e-8 || (Math.abs(dom.n[kk] - bestN) <= 1e-8 && kk < bestKey)) { bestN = dom.n[kk]; bestKey = kk; }
          }
          od[o] = Math.round(dom.r[bestKey] / bestN);
          od[o + 1] = Math.round(dom.g[bestKey] / bestN);
          od[o + 2] = Math.round(dom.b[bestKey] / bestN);
        } else {
          od[o] = Math.round(sr / sa);
          od[o + 1] = Math.round(sg / sa);
          od[o + 2] = Math.round(sb / sa);
        }
      }
    }
    return out;
  }

  // Bilateral filtering: nearby, similarly colored pixels support each other;
  // strong color edges and transparent boundaries do not contribute.
  function analyzeRegions(src) {
    var out = cloneImage(src), w = src.width, h = src.height, d = src.data;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = (y * w + x) * 4;
      if (!d[p + 3]) continue;
      var r = 0, g = 0, b = 0, total = 0;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        var xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        var q = (yy * w + xx) * 4;
        if (!d[q + 3]) continue;
        var dr = d[q] - d[p], dg = d[q + 1] - d[p + 1], db = d[q + 2] - d[p + 2];
        var distance = (dr * dr + dg * dg + db * db) / 3;
        if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) > 48) continue;
        var weight = Math.exp(-(dx * dx + dy * dy) / 4 - distance / (2 * 20 * 20)) * d[q + 3] / 255;
        r += d[q] * weight; g += d[q + 1] * weight; b += d[q + 2] * weight; total += weight;
      }
      out.data[p] = Math.round(r / total); out.data[p + 1] = Math.round(g / total);
      out.data[p + 2] = Math.round(b / total);
    }
    return out;
  }

  // Only isolated, low-contrast color specks inside solid regions qualify.
  // Connected lines, silhouettes, gaps, and high-contrast highlights survive.
  function cleanRegionSpecks(asset) {
    var src = asset.indices, out = new Uint8Array(src), w = asset.width, h = asset.height;
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var p = y * w + x, current = src[p], c = asset.palette[current];
      if (!c.a) continue;
      var counts = new Map(), isolated = true, opaque = true;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var index = src[p + dy * w + dx];
        if (index === current) isolated = false;
        if (!asset.palette[index].a) opaque = false;
        counts.set(index, (counts.get(index) || 0) + 1);
      }
      if (!isolated || !opaque) continue;
      counts.forEach(function (count, index) {
        var next = asset.palette[index];
        if (count >= 6 && Math.max(Math.abs(c.r-next.r), Math.abs(c.g-next.g), Math.abs(c.b-next.b)) <= 32) out[p] = index;
      });
    }
    // Extend cleanup only to complete 2x2 islands. Eight-connected components
    // protect diagonal lines; pairs and L-shaped details remain untouched.
    var seen = new Uint8Array(src.length);
    for (var start = 0; start < src.length; start++) {
      if (seen[start] || !asset.palette[src[start]].a) continue;
      var component = [start], color = src[start]; seen[start] = 1;
      var minX = w, minY = h, maxX = -1, maxY = -1;
      for (var head = 0; head < component.length; head++) {
        var cp = component[head], cx = cp % w, cy = Math.floor(cp / w);
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
          var nx = cx + ox, ny = cy + oy, np = ny * w + nx;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || seen[np] || src[np] !== color) continue;
          seen[np] = 1; component.push(np);
        }
      }
      if (component.length !== 4 || maxX-minX !== 1 || maxY-minY !== 1 || minX === 0 || minY === 0 || maxX === w-1 || maxY === h-1) continue;
      var surround = -1, uniform = true;
      for (var ry = minY-1; ry <= maxY+1; ry++) for (var rx = minX-1; rx <= maxX+1; rx++) {
        if (rx >= minX && rx <= maxX && ry >= minY && ry <= maxY) continue;
        var neighbor = src[ry*w+rx];
        if (!asset.palette[neighbor].a || (surround >= 0 && neighbor !== surround)) uniform = false;
        surround = neighbor;
      }
      var original = asset.palette[color], replacement = asset.palette[surround];
      if (uniform && Math.max(Math.abs(original.r-replacement.r), Math.abs(original.g-replacement.g), Math.abs(original.b-replacement.b)) <= 24) {
        component.forEach(function (pixel) { out[pixel] = surround; });
      }
    }
    return Object.assign({}, asset, { indices: out });
  }

  function blitAt(dst, src, ox, oy) {
    var x0 = Math.max(0, ox), y0 = Math.max(0, oy);
    var x1 = Math.min(dst.width, ox + src.width);
    var y1 = Math.min(dst.height, oy + src.height);
    for (var y = y0; y < y1; y++) {
      var sy = y - oy;
      var s = (sy * src.width + (x0 - ox)) * 4;
      var d = (y * dst.width + x0) * 4;
      dst.data.set(src.data.subarray(s, s + (x1 - x0) * 4), d);
    }
    return dst;
  }

  function fitSize(src, maxW, maxH, mode) {
    var scale = Math.min(maxW / src.width, maxH / src.height);
    var nw = Math.max(1, Math.min(maxW, Math.round(src.width * scale)));
    var nh = Math.max(1, Math.min(maxH, Math.round(src.height * scale)));
    return resample(src, nw, nh, scale >= 1 ? 'nearest' : mode);
  }

  function place(w, h, img, margin, align) {
    var out = createImage(w, h);
    var m = Math.max(0, margin | 0);
    var x = Math.round((w - img.width) / 2);
    var y = align === 'bottom' ? (h - m - img.height) : Math.round((h - img.height) / 2);
    blitAt(out, img, x, Math.max(0, y));
    return out;
  }

  function fitContain(src, tw, th, mode) {
    return place(tw, th, fitSize(src, tw, th, mode), 0, 'center');
  }

  /* "cover": preenche o destino e corta o excedente (fundo não pode ter tarja). */
  function fitCover(src, tw, th, mode) {
    var scale = Math.max(tw / src.width, th / src.height);
    var nw = Math.max(tw, Math.round(src.width * scale));
    var nh = Math.max(th, Math.round(src.height * scale));
    var mid = resample(src, nw, nh, scale >= 1 ? 'nearest' : mode);
    if (nw === tw && nh === th) return mid;
    var out = createImage(tw, th);
    return blitAt(out, mid, -Math.floor((nw - tw) / 2), -Math.floor((nh - th) / 2));
  }

  function alphaThreshold(img, t) {
    var out = cloneImage(img);
    var d = out.data;
    for (var i = 3; i < d.length; i += 4) d[i] = d[i] >= t ? 255 : 0;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Quantização                                                         */
  /* ------------------------------------------------------------------ */

  var BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  /* Máscara de blue noise 64×64 gerada por void-and-cluster
   * (tools/gen-blue-noise.mjs) e embutida por tools/embed-blue-noise.mjs.
   * O padrão é irregular: disfarça o degradê sem o xadrez do Bayer. */
  var BLUE_NOISE_B64 = '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';
  var BLUE_NOISE = null;

  function blueNoise() {
    if (BLUE_NOISE) return BLUE_NOISE;
    if (typeof atob !== 'function' || !BLUE_NOISE_B64 || BLUE_NOISE_B64.charAt(0) === '@') return null;
    try {
      var bin = atob(BLUE_NOISE_B64);
      var out = new Uint8Array(bin.length);
      for (var bi = 0; bi < bin.length; bi++) out[bi] = bin.charCodeAt(bi);
      BLUE_NOISE = out;
      return out;
    } catch (e) {
      return null;
    }
  }

  function nearestIndex(r, g, b, colors, cache) {
    var key = (r << 16) | (g << 8) | b;
    if (cache) {
      var hit = cache.get(key);
      if (hit !== undefined) return hit;
    }
    var best = 0, bestD = Infinity;
    for (var i = 0; i < colors.length; i++) {
      var c = colors[i];
      var dr = r - c.r, dg = g - c.g, db = b - c.b;
      var rmean = (r + c.r) >> 1;
      // "redmean": barato e bem melhor que euclidiano em tons escuros
      var d = (512 + rmean) * dr * dr + 1024 * dg * dg + (767 - rmean) * db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (cache) cache.set(key, best);
    return best;
  }

  function quantize(img, palette, opts) {
    opts = opts || {};
    var dither = opts.dither || 'none';
    var amount = opts.amount == null ? 0.5 : opts.amount;

    var colors = [];
    for (var i = 0; i < palette.length; i++) {
      if (palette[i].a > 0) colors.push(palette[i]);
    }
    if (!colors.length) throw new Error('paleta vazia');

    var w = img.width, h = img.height, d = img.data;
    var n = w * h;
    var idx = new Uint8Array(n);
    var hasAlpha = false;
    for (var q = 3; q < d.length; q += 4) { if (d[q] < 128) { hasAlpha = true; break; } }
    if (colors.length + (hasAlpha ? 1 : 0) > 256) {
      throw new Error('paleta excede 256 entradas; reserve uma cor para transparência');
    }

    var outPalette = colors.map(function (c) { return { r: c.r, g: c.g, b: c.b, a: 255 }; });
    var transIndex = -1;
    if (hasAlpha) { outPalette.push({ r: 0, g: 0, b: 0, a: 0 }); transIndex = outPalette.length - 1; }

    var cache = new Map();
    var errR = null, errG = null, errB = null;
    if (dither === 'fs') {
      errR = new Float32Array(n); errG = new Float32Array(n); errB = new Float32Array(n);
    }

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = (y * w + x) * 4;
        var pi = y * w + x;

        if (d[pi * 4 + 3] < 128) { idx[pi] = transIndex < 0 ? 0 : transIndex; continue; }

        var r = d[p], g = d[p + 1], b = d[p + 2];

        if (dither === 'fs') {
          r = clamp8(r + errR[pi]);
          g = clamp8(g + errG[pi]);
          b = clamp8(b + errB[pi]);
        } else if (dither === 'ordered') {
          var t = (BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5;
          var s = t * amount * 64;
          r = clamp8(r + s); g = clamp8(g + s); b = clamp8(b + s);
        } else if (dither === 'blue') {
          var bn = blueNoise();
          if (bn) {
            var tb = (bn[((y & 63) << 6) | (x & 63)] + 0.5) / 256 - 0.5;
            var sb = tb * amount * 64;
            r = clamp8(r + sb); g = clamp8(g + sb); b = clamp8(b + sb);
          } else {
            var tf = (BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5;
            var sf = tf * amount * 64;
            r = clamp8(r + sf); g = clamp8(g + sf); b = clamp8(b + sf);
          }
        }

        r = Math.round(r); g = Math.round(g); b = Math.round(b);
        var ci = nearestIndex(r, g, b, colors, cache);
        // colors[] e outPalette[] têm a mesma ordem: ci já é o índice final.
        idx[pi] = ci;

        if (dither === 'fs') {
          var er = r - colors[ci].r, eg = g - colors[ci].g, eb = b - colors[ci].b;
          var spread = [
            [1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]
          ];
          for (var si = 0; si < 4; si++) {
            var sxx = x + spread[si][0], syy = y + spread[si][1];
            if (sxx < 0 || sxx >= w || syy >= h) continue;
            var ti = syy * w + sxx;
            if (d[ti * 4 + 3] < 128) continue;
            var f = spread[si][2] * amount;
            errR[ti] += er * f; errG[ti] += eg * f; errB[ti] += eb * f;
          }
        }
      }
    }

    return {
      asset: {
        width: w, height: h, indices: idx, palette: outPalette,
        transparentIndex: transIndex, outlineIndex: -1
      },
      colors: colors
    };
  }

  /* ------------------------------------------------------------------ */
  /* Pós-processamento                                                   */
  /* ------------------------------------------------------------------ */

  function luminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

  function darkestOpaqueIndex(palette) {
    var best = -1, bl = Infinity;
    for (var i = 0; i < palette.length; i++) {
      if (palette[i].a === 0) continue;
      var l = luminance(palette[i]);
      if (l < bl) { bl = l; best = i; }
    }
    return best;
  }

  /* Apaga pixels praticamente pretos ou brancos. Roda antes do recorte, então a
   * silhueta já sai sem eles. */
  function removeBlackWhite(img, tolerance) {
    var out = cloneImage(img);
    var d = out.data;
    var t = Math.max(0, Math.min(128, tolerance | 0));
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx <= t || mn >= 255 - t) d[i + 3] = 0;
    }
    return out;
  }

  /* Silhueta: achata o sprite num tom só (a "sombra"), mantendo o alfa.
   * A borda é aplicada depois, em cima dessa forma. */
  function flattenSilhouette(asset, tone) {
    var white = tone === 'white';
    var fill = white ? 255 : 0;
    var t = asset.transparentIndex;
    var palette = [{ r: fill, g: fill, b: fill, a: 255 }];
    var trans = -1;
    if (t >= 0) {
      palette.push({ r: 0, g: 0, b: 0, a: 0 });
      trans = 1;
    }
    var out = new Uint8Array(asset.indices.length);
    for (var i = 0; i < out.length; i++) out[i] = asset.indices[i] === t ? trans : 0;
    return {
      width: asset.width, height: asset.height, indices: out, palette: palette,
      transparentIndex: trans, outlineIndex: -1
    };
  }

  function addOutline(asset, radius, opts) {
    opts = opts || {};
    var w = asset.width, h = asset.height;
    var palette = asset.palette.slice();
    var trans = asset.transparentIndex;
    var src = asset.indices;

    var opaque = 0;
    for (var i = 0; i < src.length; i++) if (src[i] !== trans) opaque++;
    if (opaque === 0) return asset;

    if (trans < 0) {
      if (palette.length >= 256) throw new Error('reserve uma entrada da paleta para transparência do contorno');
      palette.push({ r: 0, g: 0, b: 0, a: 0 });
      trans = palette.length - 1;
    }

    /* Cor da borda: a escolhida (entra na paleta se ainda não estiver), a de
     * um índice dado, ou a mais escura como padrão. */
    var outlineIndex = -1;
    if (opts.color) {
      var cc = hexToRgb(opts.color);
      if (cc) {
        for (var pi = 0; pi < palette.length; pi++) {
          var pc = palette[pi];
          if (pc.a > 0 && pc.r === cc.r && pc.g === cc.g && pc.b === cc.b) { outlineIndex = pi; break; }
        }
        if (outlineIndex < 0) {
          if (palette.length < 256) {
            palette.push({ r: cc.r, g: cc.g, b: cc.b, a: 255 });
            outlineIndex = palette.length - 1;
          } else {
            outlineIndex = darkestOpaqueIndex(palette);
          }
        }
      }
    }
    if (outlineIndex < 0 && opts.colorIndex != null && palette[opts.colorIndex] && palette[opts.colorIndex].a > 0) {
      outlineIndex = opts.colorIndex;
    }
    if (outlineIndex < 0) outlineIndex = darkestOpaqueIndex(palette);
    if (outlineIndex < 0) outlineIndex = 0;

    var grid = new Uint8Array(w * h);
    for (var k = 0; k < src.length; k++) grid[k] = src[k] === trans ? 0 : 1;

    var radiusN = Math.max(1, Math.min(8, radius | 0));
    var diag = !!opts.diag;
    var out = new Uint8Array(src);

    /* Borda para dentro: pinta as N camadas externas da silhueta, sem crescer
     * o sprite. A profundidade vem de uma BFS a partir do transparente. */
    if (opts.inner) {
      var depth = new Int32Array(w * h);
      var queue = new Int32Array(w * h);
      var head = 0, tail = 0;
      for (var q = 0; q < w * h; q++) {
        if (grid[q]) {
          var qx = q % w, qy = Math.floor(q / w);
          if (qx === 0 || qy === 0 || qx === w - 1 || qy === h - 1) {
            depth[q] = 1;
            queue[tail++] = q;
          } else depth[q] = -1;
        }
        else { depth[q] = 0; queue[tail++] = q; }
      }
      // Processa primeiro distância 0; depois as sementes da borda (distância 1).
      // Assim cada célula entra na fila uma vez, com a menor distância.
      var seeds = Array.prototype.slice.call(queue, 0, tail);
      seeds.sort(function (a, b) { return depth[a] - depth[b]; });
      queue.set(seeds);
      while (head < tail) {
        var cur = queue[head++];
        var cx = cur % w, cy = (cur - cx) / w;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (!diag && dx !== 0 && dy !== 0) continue;
            var nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            var ni = ny * w + nx;
            if (!grid[ni] || depth[ni] >= 0) continue;
            depth[ni] = depth[cur] + 1;
            queue[tail++] = ni;
          }
        }
      }
      for (var ip = 0; ip < w * h; ip++) {
        if (grid[ip] && depth[ip] >= 1 && depth[ip] <= radiusN) out[ip] = outlineIndex;
      }
      return {
        width: w, height: h, indices: out, palette: palette,
        transparentIndex: trans, outlineIndex: outlineIndex
      };
    }

    for (var pass = 0; pass < radiusN; pass++) {
      var next = new Uint8Array(grid);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var p = y * w + x;
          if (grid[p]) continue;
          var touch = false;
          for (var dy = -1; dy <= 1 && !touch; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (!diag && dx !== 0 && dy !== 0) continue;
              var nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              if (grid[ny * w + nx]) { touch = true; break; }
            }
          }
          if (touch) { next[p] = 2; out[p] = outlineIndex; }
        }
      }
      for (var m = 0; m < next.length; m++) if (next[m] === 2) grid[m] = 1;
    }

    return {
      width: w, height: h, indices: out, palette: palette,
      transparentIndex: trans, outlineIndex: outlineIndex
    };
  }

  /* Órfão = pixel sem nenhum vizinho da mesma cor em 8 direções E cuja cor
   * aparece no máximo 2× no asset. Só a primeira condição puniria detalhe
   * legítimo de 1px (olho, brilho); a segunda condição é o que separa ruído
   * de antialias de detalhe intencional. */
  var RARE_COLOR_MAX = 2;

  function sameNeighbors(idx, w, h, x, y, v) {
    var n = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (idx[ny * w + nx] === v) n++;
      }
    }
    return n;
  }

  function usageMap(asset) {
    var map = new Map();
    var t = asset.transparentIndex;
    for (var i = 0; i < asset.indices.length; i++) {
      var v = asset.indices[i];
      if (v === t) continue;
      map.set(v, (map.get(v) || 0) + 1);
    }
    return map;
  }

  function countOrphans(asset, usage) {
    var w = asset.width, h = asset.height, idx = asset.indices, t = asset.transparentIndex;
    var map = usage || usageMap(asset);
    var count = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x, v = idx[p];
        if (v === t) continue;
        if ((map.get(v) || 0) > RARE_COLOR_MAX) continue;
        if (sameNeighbors(idx, w, h, x, y, v) === 0) count++;
      }
    }
    return count;
  }

  function removeOrphans(asset, maxPasses) {
    var passes = maxPasses || 1;
    var cur = asset, total = 0;
    for (var pass = 0; pass < passes; pass++) {
      var w = cur.width, h = cur.height, idx = cur.indices, t = cur.transparentIndex;
      if (t < 0) return { asset: cur, removed: total };
      var map = usageMap(cur);
      var out = new Uint8Array(idx);
      var removedNow = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var p = y * w + x, v = idx[p];
          if (v === t) continue;
          if ((map.get(v) || 0) > RARE_COLOR_MAX) continue;
          if (sameNeighbors(idx, w, h, x, y, v) === 0) { out[p] = t; removedNow++; }
        }
      }
      if (!removedNow) break;
      total += removedNow;
      cur = {
        width: w, height: h, indices: out, palette: cur.palette,
        transparentIndex: t, outlineIndex: cur.outlineIndex
      };
    }
    return { asset: cur, removed: total };
  }

  /* ------------------------------------------------------------------ */
  /* Estatísticas e validação                                            */
  /* ------------------------------------------------------------------ */

  function computeStats(asset) {
    var w = asset.width, h = asset.height, idx = asset.indices, t = asset.transparentIndex;
    var used = new Map();
    var opaque = 0;
    var minX = w, minY = h, maxX = -1, maxY = -1;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = idx[y * w + x];
        if (v === t) continue;
        opaque++;
        used.set(v, (used.get(v) || 0) + 1);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    var touchesBorder = false;
    if (maxX >= 0) {
      touchesBorder = minX === 0 || minY === 0 || maxX === w - 1 || maxY === h - 1;
    }

    return {
      width: w,
      height: h,
      pixels: w * h,
      opaque: opaque,
      coverage: opaque / (w * h),
      colorsUsed: used.size,
      usage: used,
      orphans: countOrphans(asset, used),
      bbox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      touchesBorder: touchesBorder
    };
  }

  function minColorDistance(usage, palette) {
    var list = [];
    usage.forEach(function (_count, index) {
      var c = palette[index];
      if (c && c.a > 0) list.push(c);
    });
    var best = Infinity, pair = null;
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var dr = list[i].r - list[j].r, dg = list[i].g - list[j].g, db = list[i].b - list[j].b;
        var d = Math.sqrt(dr * dr + dg * dg + db * db);
        if (d < best) { best = d; pair = [list[i], list[j]]; }
      }
    }
    return { distance: list.length < 2 ? Infinity : best, pair: pair };
  }

  /* Emenda de tile: a última coluna fica vizinha da primeira quando o fundo
   * repete. Comparamos essa distância com a distância média entre colunas
   * vizinhas dentro da própria imagem — se a emenda é um outlier, não tileia. */
  function columnDistance(asset, x1, x2) {
    var w = asset.width, h = asset.height, idx = asset.indices, pal = asset.palette;
    var sum = 0;
    for (var y = 0; y < h; y++) {
      var a = pal[idx[y * w + x1]] || { r: 0, g: 0, b: 0 };
      var b = pal[idx[y * w + x2]] || { r: 0, g: 0, b: 0 };
      var dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
      sum += Math.sqrt(dr * dr + dg * dg + db * db);
    }
    return sum / Math.max(1, h);
  }

  function seamReport(asset) {
    var w = asset.width;
    if (w < 2) return { internal: 0, wrap: 0, limit: 1, ok: true };
    var internal = 0;
    for (var x = 0; x < w - 1; x++) internal += columnDistance(asset, x, x + 1);
    internal /= (w - 1);
    var wrap = columnDistance(asset, w - 1, 0);
    var limit = Math.max(24, internal * 2.5);
    return { internal: internal, wrap: wrap, limit: limit, ok: wrap <= limit };
  }

  function validate(asset, contract, stats) {
    contract = contract || {};
    var maxColors = contract.maxColors == null ? 16 : contract.maxColors;
    var minDistance = contract.minDistance == null ? 16 : contract.minDistance;
    var requireOutline = !!contract.requireOutline;
    var maxOrphans = contract.maxOrphans == null ? 0 : contract.maxOrphans;
    var minCoverage = contract.minCoverage == null ? 0.04 : contract.minCoverage;
    var requireMargin = contract.requireMargin !== false;
    var rules = contract.rules || [];

    var checks = [];
    var t = asset.transparentIndex;
    var w = asset.width, h = asset.height;

    checks.push({
      id: 'resolution',
      label: 'Resolução na grade',
      ok: w > 0 && h > 0 &&
        w <= (contract.maxWidth || (rules.indexOf('fullFrame') !== -1 ? 2048 : 512)) &&
        h <= (contract.maxHeight || (rules.indexOf('fullFrame') !== -1 ? 2048 : 512)),
      detail: w + '×' + h + (w <= 128 && h <= 128 ? '' : ' (grande pra sprite)')
    });

    var outOfPalette = 0;
    for (var i = 0; i < asset.indices.length; i++) {
      if (asset.indices[i] >= asset.palette.length) outOfPalette++;
    }
    checks.push({
      id: 'palette',
      label: 'Índices válidos',
      ok: outOfPalette === 0,
      detail: outOfPalette === 0 ? 'todas as células apontam pra paleta' : outOfPalette + ' inválidos'
    });

    checks.push({
      id: 'colorCount',
      label: 'Máximo de cores',
      ok: stats.colorsUsed <= maxColors,
      detail: stats.colorsUsed + ' / ' + maxColors
    });

    var partial = 0;
    for (var p = 0; p < asset.palette.length; p++) {
      var a = asset.palette[p].a;
      if (a !== 0 && a !== 255) partial++;
    }
    checks.push({
      id: 'alpha',
      label: 'Alpha binário',
      ok: partial === 0,
      detail: partial === 0 ? 'sem semitransparência' : partial + ' tons com alpha parcial'
    });

    var dist = minColorDistance(stats.usage, asset.palette);
    checks.push({
      id: 'distance',
      label: 'Separação de cores',
      ok: !isFinite(dist.distance) || dist.distance >= minDistance,
      detail: isFinite(dist.distance)
        ? 'mais próximas: ' + Math.round(dist.distance) + ' (mín ' + minDistance + ')'
        : 'menos de 2 cores em uso'
    });

    var boundaryWrong = 0, boundaryTotal = 0;
    if (requireOutline) {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var pi = y * w + x;
          var v = asset.indices[pi];
          if (v === t) continue;
          var edge = false;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
          else if (asset.indices[pi - 1] === t || asset.indices[pi + 1] === t ||
            asset.indices[pi - w] === t || asset.indices[pi + w] === t) edge = true;
          if (edge) {
            boundaryTotal++;
            if (v !== asset.outlineIndex) boundaryWrong++;
          }
        }
      }
    }
    checks.push({
      id: 'outline',
      label: 'Outline na silhueta',
      ok: !requireOutline || boundaryWrong === 0,
      detail: !requireOutline ? 'não exigido' :
        (boundaryWrong === 0 ? boundaryTotal + ' px de borda marcados' : boundaryWrong + ' px de borda sem outline')
    });

    checks.push({
      id: 'margin',
      label: 'Margem transparente',
      ok: !requireMargin || !stats.touchesBorder,
      detail: !requireMargin ? 'não exigida' : (stats.touchesBorder ? 'silhueta encosta na borda' : 'ok')
    });

    checks.push({
      id: 'orphans',
      label: 'Pixels órfãos',
      ok: stats.orphans <= maxOrphans,
      detail: stats.orphans + ' (máx ' + maxOrphans + ')'
    });

    checks.push({
      id: 'coverage',
      label: 'Cobertura do quadro',
      ok: stats.coverage >= minCoverage &&
        stats.coverage <= (rules.indexOf('opaque') !== -1 ? 1.0001 : 0.98),
      detail: (stats.coverage * 100).toFixed(1) + '%'
    });

    /* regras específicas de aplicação (personagem / prop / fundo) */
    var bbox = stats.bbox;
    function has(r) { return rules.indexOf(r) !== -1; }

    if (has('ground')) {
      var emptyBelow = bbox ? h - (bbox.y + bbox.h) : h;
      checks.push({
        id: 'ground', label: 'Pé na linha de base',
        ok: emptyBelow <= 1,
        detail: emptyBelow + ' linha(s) vazia(s) embaixo'
      });
    }
    if (has('headroom')) {
      var top = bbox ? bbox.y : h;
      checks.push({ id: 'headroom', label: 'Espaço acima', ok: top >= 1, detail: top + ' px' });
    }
    if (has('centeredX')) {
      var cx = bbox ? bbox.x + bbox.w / 2 : 0;
      var offX = Math.abs(cx - w / 2);
      checks.push({
        id: 'centeredX', label: 'Centralizado na horizontal',
        ok: offX <= 1.5, detail: 'desvio ' + offX.toFixed(1) + ' px'
      });
    }
    if (has('centered')) {
      var cxx = bbox ? bbox.x + bbox.w / 2 : 0;
      var cyy = bbox ? bbox.y + bbox.h / 2 : 0;
      var off = Math.max(Math.abs(cxx - w / 2), Math.abs(cyy - h / 2));
      checks.push({
        id: 'centered', label: 'Centralizado no quadro',
        ok: off <= 1.5, detail: 'desvio ' + off.toFixed(1) + ' px'
      });
    }
    if (has('opaque')) {
      checks.push({
        id: 'opaque', label: 'Sem transparência',
        ok: stats.coverage >= 0.9999,
        detail: ((1 - stats.coverage) * 100).toFixed(1) + '% vazado'
      });
    }
    if (has('fullFrame')) {
      var full = !!bbox && bbox.x === 0 && bbox.y === 0 && bbox.w === w && bbox.h === h;
      checks.push({
        id: 'fullFrame', label: 'Preenche o quadro',
        ok: full,
        detail: bbox ? bbox.w + '×' + bbox.h + ' em ' + w + '×' + h : 'vazio'
      });
    }
    if (has('noOutline')) {
      checks.push({
        id: 'noOutline', label: 'Sem outline',
        ok: asset.outlineIndex < 0,
        detail: asset.outlineIndex < 0 ? 'ok' : 'outline presente'
      });
    }
    if (has('seamlessX')) {
      var seam = seamReport(asset);
      checks.push({
        id: 'seamlessX', label: 'Emenda horizontal (tile)',
        ok: seam.ok,
        detail: 'borda ' + Math.round(seam.wrap) + ' vs interna ' + Math.round(seam.internal) +
          ' (limite ' + Math.round(seam.limit) + ')'
      });
    }

    var ok = true;
    for (var c = 0; c < checks.length; c++) if (!checks[c].ok) ok = false;
    return { ok: ok, checks: checks };
  }

  /* ------------------------------------------------------------------ */
  /* Pipeline                                                            */
  /* ------------------------------------------------------------------ */

  function conform(src, opts) {
    opts = opts || {};
    var o = {
      targetW: 64, targetH: 64,
      mode: 'dominant',
      preserveAspect: true,
      doAutoCrop: true,
      removeBg: false,
      bgColor: { r: 255, g: 255, b: 255 },
      bgTolerance: 32,
      alphaThreshold: 128,
      palette: null,
      dither: 'none',
      ditherAmount: 0.5,
      outline: false,
      outlineRadius: 1,
      outlineDiag: false,
      orphanCleanup: false,
      contract: {}
    };
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k) && opts[k] !== undefined) o[k] = opts[k];

    if (!o.palette || !o.palette.length) o.palette = resolvedPalettes().pico8.colors;

    var img = cloneImage(src);
    var stages = { source: true };

    if (o.removeBg) {
      img = removeBackground(img, o.bgColor, o.bgTolerance);
      stages.bgRemoved = true;
    }

    // o limiar vem ANTES do encaixe: senão um glow semi-transparente infla a
    // silhueta e o alinhamento (pé na base) sai errado
    if (o.alphaThreshold != null) {
      img = alphaThreshold(img, o.alphaThreshold);
      stages.alphaClipped = true;
    }

    if (o.removeBlackWhite) {
      img = removeBlackWhite(img, o.bwTolerance == null ? 12 : o.bwTolerance);
      stages.bwRemoved = true;
    }

    var cropBox = null;
    if (o.doAutoCrop) {
      var c = autoCrop(img);
      img = c.image;
      cropBox = c.box;
      stages.cropped = cropBox;
    }

    var margin = Math.max(0, Math.min(8, o.margin | 0));
    var fit = o.fit || (o.preserveAspect === false ? 'stretch' : 'contain');
    var align = o.align || 'center';
    var scaled;

    var availableW = Math.max(1, o.targetW - (fit === 'cover' ? 0 : margin * 2));
    var availableH = Math.max(1, o.targetH - (fit === 'cover' ? 0 : margin * 2));
    var reducing = fit === 'stretch' ? img.width > availableW || img.height > availableH :
      (fit === 'cover' ? Math.max(availableW / img.width, availableH / img.height) :
        Math.min(availableW / img.width, availableH / img.height)) < 1;
    if (o.mode === 'structure' && reducing) {
      // Bound analysis cost while retaining more spatial detail than the output.
      var analysisScale = Math.min(1, Math.max(768, availableW, availableH) / Math.max(img.width, img.height),
        Math.max(availableW / img.width, availableH / img.height) * 3);
      if (analysisScale < 1) img = resample(img, Math.max(1, Math.round(img.width * analysisScale)),
        Math.max(1, Math.round(img.height * analysisScale)), 'box');
      img = analyzeRegions(img);
      stages.regionAnalysis = { w: img.width, h: img.height };
    }

    // Resolve competing shades into the final palette before counting votes.
    // Keep alpha independent: pre-quantization must not expand the silhouette.
    if ((o.mode === 'clean' || o.mode === 'structure' || o.mode === 'shape') && reducing) {
      var groupColors = o.palette.filter(function (color) { return color.a > 0; });
      if (!groupColors.length) throw new Error('paleta vazia');
      var groupCache = new Map();
      for (var gp = 0; gp < img.data.length; gp += 4) {
        if (!img.data[gp + 3]) continue;
        var gc = groupColors[nearestIndex(img.data[gp], img.data[gp + 1], img.data[gp + 2], groupColors, groupCache)];
        img.data[gp] = gc.r; img.data[gp + 1] = gc.g; img.data[gp + 2] = gc.b;
      }
      stages.paletteBeforeReduction = true;
    }

    if (fit === 'cover') {
      scaled = fitCover(img, o.targetW, o.targetH, o.mode);
    } else {
      var innerW = Math.max(1, o.targetW - margin * 2);
      var innerH = Math.max(1, o.targetH - margin * 2);
      var fitted = fit === 'stretch'
        ? resample(img, innerW, innerH, o.mode)
        : fitSize(img, innerW, innerH, o.mode);
      scaled = place(o.targetW, o.targetH, fitted, margin, align);
    }

    stages.scaled = { w: scaled.width, h: scaled.height };
    stages.fit = fit;
    stages.align = align;

    // reamostrar recria alpha parcial (média da célula): fecha de novo
    scaled = alphaThreshold(scaled, o.alphaThreshold == null ? 128 : o.alphaThreshold);

    var q = quantize(scaled, o.palette, { dither: o.dither, amount: o.ditherAmount });
    var asset = q.asset;
    if (o.mode === 'structure' && reducing && o.dither === 'none') asset = cleanRegionSpecks(asset);
    stages.colors = q.colors.length;

    if (o.silhouette === 'black' || o.silhouette === 'white') {
      asset = flattenSilhouette(asset, o.silhouette);
      stages.silhouette = o.silhouette;
    }

    var removedOrphans = 0;
    if (o.orphanCleanup) {
      var r1 = removeOrphans(asset, 2);
      asset = r1.asset;
      removedOrphans += r1.removed;
    }

    if (o.outline) {
      /* numa silhueta de um tom só, a borda automática usa o tom oposto —
       * senão ela seria invisível */
      var autoContrast = (o.silhouette === 'black') ? '#FFFFFF'
        : (o.silhouette === 'white') ? '#000000' : null;
      asset = addOutline(asset, o.outlineRadius, {
        diag: o.outlineDiag,
        color: o.outlineColor || autoContrast,
        inner: !!o.outlineInner
      });
      stages.outline = true;
    }

    var stats = computeStats(asset);
    stats.removedOrphans = removedOrphans;
    var checks = validate(asset, o.contract, stats);

    return {
      asset: asset,
      stats: stats,
      checks: checks.checks,
      ok: checks.ok,
      stages: stages
    };
  }

  /* ------------------------------------------------------------------ */
  /* Extração de paleta (median cut)                                     */
  /* ------------------------------------------------------------------ */

  function makeBox(pts) {
    var minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p[0] < minR) minR = p[0];
      if (p[0] > maxR) maxR = p[0];
      if (p[1] < minG) minG = p[1];
      if (p[1] > maxG) maxG = p[1];
      if (p[2] < minB) minB = p[2];
      if (p[2] > maxB) maxB = p[2];
    }
    var ranges = [maxR - minR, maxG - minG, maxB - minB];
    var ch = 0;
    if (ranges[1] > ranges[ch]) ch = 1;
    if (ranges[2] > ranges[ch]) ch = 2;
    return { pts: pts, range: ranges[ch], channel: ch };
  }

  function avgColor(pts) {
    var r = 0, g = 0, b = 0;
    for (var i = 0; i < pts.length; i++) { r += pts[i][0]; g += pts[i][1]; b += pts[i][2]; }
    var n = pts.length || 1;
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: 255 };
  }

  function extractMedian(img, count) {
    count = Math.max(2, Math.min(64, count | 0));
    var d = img.data;
    var total = img.width * img.height;
    var step = Math.max(1, Math.floor(Math.sqrt(total / 24000)));
    var pts = [];
    for (var y = 0; y < img.height; y += step) {
      for (var x = 0; x < img.width; x += step) {
        var i = (y * img.width + x) * 4;
        if (d[i + 3] < 128) continue;
        pts.push([d[i], d[i + 1], d[i + 2]]);
      }
    }
    if (!pts.length) return [];
    var boxes = [makeBox(pts)];
    while (boxes.length < count) {
      var bi = -1, best = -1;
      for (var k = 0; k < boxes.length; k++) {
        if (boxes[k].pts.length < 2) continue;
        if (boxes[k].range > best) { best = boxes[k].range; bi = k; }
      }
      if (bi < 0) break;
      var box = boxes[bi];
      var ch = box.channel;
      box.pts.sort(function (a, b) { return a[ch] - b[ch]; });
      var mid = box.pts.length >> 1;
      var A = box.pts.slice(0, mid), B = box.pts.slice(mid);
      if (!A.length || !B.length) break;
      boxes.splice(bi, 1, makeBox(A), makeBox(B));
    }
    return boxes.map(function (b) { return avgColor(b.pts); });
  }

  /* Extração "distribuída": agrupa em bins de cor, escolhe os representantes
   * por população PONDERADA pela distância (farthest point) e refina com
   * k-means. Median cut puro gasta a paleta na cor dominante; aqui uma cor
   * minoritária mas distante (tronco, contorno) também entra. */
  function extractSpread(img, count) {
    count = Math.max(2, Math.min(64, count | 0));
    var BITS = 4;
    var SHIFT = 8 - BITS;
    var SIZE = 1 << (BITS * 3);
    var cnt = new Uint32Array(SIZE);
    var sumR = new Float64Array(SIZE), sumG = new Float64Array(SIZE), sumB = new Float64Array(SIZE);
    var occupied = [];
    var total = img.width * img.height;
    var step = Math.max(1, Math.floor(Math.sqrt(total / 40000)));
    var d = img.data;

    for (var y = 0; y < img.height; y += step) {
      for (var x = 0; x < img.width; x += step) {
        var i = (y * img.width + x) * 4;
        if (d[i + 3] < 128) continue;
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var key = ((r >> SHIFT) << (BITS * 2)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);
        if (cnt[key] === 0) occupied.push(key);
        cnt[key]++;
        sumR[key] += r; sumG[key] += g; sumB[key] += b;
      }
    }
    if (!occupied.length) return [];

    var n = occupied.length;
    var pr = new Float64Array(n), pg = new Float64Array(n), pb = new Float64Array(n), wt = new Float64Array(n);
    for (var k = 0; k < n; k++) {
      var kk = occupied[k];
      pr[k] = sumR[kk] / cnt[kk];
      pg[k] = sumG[kk] / cnt[kk];
      pb[k] = sumB[kk] / cnt[kk];
      wt[k] = cnt[kk];
    }

    function d2(i, j) {
      var dr = pr[i] - pr[j], dg = pg[i] - pg[j], db = pb[i] - pb[j];
      return dr * dr + dg * dg + db * db;
    }

    var first = 0;
    for (var f = 1; f < n; f++) if (wt[f] > wt[first]) first = f;

    var chosen = [first];
    var minD = new Float64Array(n);
    for (var m0 = 0; m0 < n; m0++) minD[m0] = d2(m0, first);

    while (chosen.length < count && chosen.length < n) {
      var bestIdx = -1, bestScore = -1;
      for (var s = 0; s < n; s++) {
        var score = Math.sqrt(wt[s]) * minD[s];
        if (score > bestScore) { bestScore = score; bestIdx = s; }
      }
      if (bestIdx < 0 || bestScore <= 0) break;
      chosen.push(bestIdx);
      for (var m1 = 0; m1 < n; m1++) {
        var dd = d2(m1, bestIdx);
        if (dd < minD[m1]) minD[m1] = dd;
      }
    }

    var centers = [];
    for (var c = 0; c < chosen.length; c++) {
      centers.push({ r: pr[chosen[c]], g: pg[chosen[c]], b: pb[chosen[c]] });
    }

    for (var it = 0; it < 4; it++) {
      var accR = new Float64Array(centers.length);
      var accG = new Float64Array(centers.length);
      var accB = new Float64Array(centers.length);
      var accW = new Float64Array(centers.length);
      for (var p = 0; p < n; p++) {
        var bestC = 0, bestD = Infinity;
        for (var c2 = 0; c2 < centers.length; c2++) {
          var dr = pr[p] - centers[c2].r;
          var dg = pg[p] - centers[c2].g;
          var db = pb[p] - centers[c2].b;
          var dd2 = dr * dr + dg * dg + db * db;
          if (dd2 < bestD) { bestD = dd2; bestC = c2; }
        }
        accR[bestC] += pr[p] * wt[p];
        accG[bestC] += pg[p] * wt[p];
        accB[bestC] += pb[p] * wt[p];
        accW[bestC] += wt[p];
      }
      for (var c3 = 0; c3 < centers.length; c3++) {
        if (accW[c3] > 0) {
          centers[c3].r = accR[c3] / accW[c3];
          centers[c3].g = accG[c3] / accW[c3];
          centers[c3].b = accB[c3] / accW[c3];
        }
      }
    }

    var out = [], seen = new Set();
    for (var c4 = 0; c4 < centers.length; c4++) {
      var rr = Math.round(centers[c4].r);
      var gg = Math.round(centers[c4].g);
      var bb = Math.round(centers[c4].b);
      var k2 = (rr << 16) | (gg << 8) | bb;
      if (seen.has(k2)) continue;
      seen.add(k2);
      out.push({ r: rr, g: gg, b: bb, a: 255 });
    }
    return out;
  }

  /* Ordena a paleta em rampas: família de matiz, depois do escuro pro claro.
   * Reordenar não muda a quantização (a busca é por proximidade), mas faz o
   * .gpl e o painel de paleta do Aseprite lerem como rampa. */
  function hueBucket(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    var min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    var d = max - min;
    if (d < 0.06) return 255;
    var h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return Math.floor(h / 30);
  }

  function lumOf(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

  function sortPaletteRamps(colors) {
    return colors.slice().sort(function (x, y) {
      var hx = hueBucket(x), hy = hueBucket(y);
      if (hx !== hy) return hx - hy;
      return lumOf(x) - lumOf(y);
    });
  }

  function extractPalette(img, count, mode) {
    var list = mode === 'spread' ? extractSpread(img, count) : extractMedian(img, count);
    return sortPaletteRamps(list);
  }

  /* ------------------------------------------------------------------ */
  /* PNG indexado (colorType 3)                                          */
  /* ------------------------------------------------------------------ */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u32(v) {
    return new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
  }

  function chunk(type, data) {
    var typeBytes = new Uint8Array(4);
    for (var i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
    var body = new Uint8Array(typeBytes.length + data.length);
    body.set(typeBytes, 0);
    body.set(data, 4);
    var crc = crc32(body);
    var out = new Uint8Array(12 + data.length);
    out.set(u32(data.length), 0);
    out.set(body, 4);
    out.set(u32(crc), 8 + data.length);
    return out;
  }

  function adler32(data) {
    var a = 1, b = 0;
    for (var i = 0; i < data.length; i++) {
      a = (a + data[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  /* zlib "stored": sem compressão, mas é um zlib válido em qualquer lugar. */
  function deflateStored(data) {
    var max = 65535;
    var blocks = Math.max(1, Math.ceil(data.length / max));
    var out = new Uint8Array(2 + data.length + blocks * 5 + 4);
    var o = 0;
    out[o++] = 0x78; out[o++] = 0x01;
    for (var i = 0; i < blocks; i++) {
      var start = i * max;
      var len = Math.min(max, data.length - start);
      var final = i === blocks - 1 ? 1 : 0;
      out[o++] = final;
      out[o++] = len & 255;
      out[o++] = (len >>> 8) & 255;
      out[o++] = (~len) & 255;
      out[o++] = ((~len) >>> 8) & 255;
      out.set(data.subarray(start, start + len), o);
      o += len;
    }
    var ad = adler32(data);
    out[o++] = (ad >>> 24) & 255;
    out[o++] = (ad >>> 16) & 255;
    out[o++] = (ad >>> 8) & 255;
    out[o++] = ad & 255;
    return out.subarray(0, o);
  }

  /* Compressão: a saída tem que ser consumida ENQUANTO se escreve. O padrão
   * writer.write() -> close() -> ler deadlocka quando a fila do readable enche
   * (acontece no Chrome, não no Node). pipeThrough liga os dois de uma vez. */
  function defaultDeflate(data) {
    var canPipe = typeof CompressionStream === 'function' &&
      typeof Response === 'function' &&
      typeof Blob === 'function' &&
      typeof Blob.prototype.stream === 'function';

    if (!canPipe) return Promise.resolve(deflateStored(data));

    try {
      var compressed = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));

      var work = new Response(compressed).arrayBuffer()
        .then(function (buf) { return new Uint8Array(buf); })
        .catch(function () { return null; });

      // rede de segurança: se algum navegador engasgar, ainda sai arquivo válido
      var guard = new Promise(function (resolve) {
        setTimeout(function () { resolve(null); }, 4000);
      });

      return Promise.race([work, guard]).then(function (result) {
        return result && result.length ? result : deflateStored(data);
      });
    } catch (e) {
      return Promise.resolve(deflateStored(data));
    }
  }

  function encodePNG(asset, opts) {
    opts = opts || {};
    var w = asset.width, h = asset.height;
    var palette = asset.palette;
    if (palette.length > 256) return Promise.reject(new Error('paleta acima de 256 cores'));

    var ihdr = new Uint8Array(13);
    ihdr.set(u32(w), 0);
    ihdr.set(u32(h), 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 3;   // color type: indexed
    ihdr[10] = 0;  // compression
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // interlace

    var plte = new Uint8Array(palette.length * 3);
    var lastAlpha = -1;
    for (var i = 0; i < palette.length; i++) {
      plte[i * 3] = palette[i].r;
      plte[i * 3 + 1] = palette[i].g;
      plte[i * 3 + 2] = palette[i].b;
      if (palette[i].a < 255) lastAlpha = i;
    }

    var trns = null;
    if (lastAlpha >= 0) {
      trns = new Uint8Array(lastAlpha + 1);
      for (var t = 0; t <= lastAlpha; t++) trns[t] = palette[t].a;
    }

    var raw = new Uint8Array((w + 1) * h);
    for (var y = 0; y < h; y++) {
      raw[y * (w + 1)] = 0; // filtro None
      raw.set(asset.indices.subarray(y * w, y * w + w), y * (w + 1) + 1);
    }

    var deflate = opts.deflate || defaultDeflate;

    return Promise.resolve(deflate(raw)).then(function (z) {
      var parts = [
        new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('PLTE', plte)
      ];
      if (trns) parts.push(chunk('tRNS', trns));
      parts.push(chunk('IDAT', z));
      parts.push(chunk('IEND', new Uint8Array(0)));

      var total = 0;
      for (var p = 0; p < parts.length; p++) total += parts[p].length;
      var out = new Uint8Array(total);
      var off = 0;
      for (var q = 0; q < parts.length; q++) { out.set(parts[q], off); off += parts[q].length; }
      return out;
    });
  }

  // Mapas de dados precisam de RGB completo: quantizar normais distorce vetores.
  function encodeRGBAPNG(img, opts) {
    opts = opts || {};
    var w = img.width, h = img.height;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || img.data.length !== w * h * 4) {
      return Promise.reject(new Error('imagem RGBA inválida'));
    }
    var ihdr = new Uint8Array(13);
    ihdr.set(u32(w), 0); ihdr.set(u32(h), 4);
    ihdr[8] = 8; ihdr[9] = 6;
    var raw = new Uint8Array((w * 4 + 1) * h);
    for (var y = 0; y < h; y++) raw.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
    return Promise.resolve((opts.deflate || defaultDeflate)(raw)).then(function (z) {
      var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
      var out = new Uint8Array(parts.reduce(function (n, part) { return n + part.length; }, 0)), offset = 0;
      parts.forEach(function (part) { out.set(part, offset); offset += part.length; });
      return out;
    });
  }

  function scaleNearest(asset, factor) {
    var w = asset.width * factor, h = asset.height * factor;
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var sy = Math.floor(y / factor);
      for (var x = 0; x < w; x++) {
        out[y * w + x] = asset.indices[sy * asset.width + Math.floor(x / factor)];
      }
    }
    return {
      width: w, height: h, indices: out, palette: asset.palette,
      transparentIndex: asset.transparentIndex, outlineIndex: asset.outlineIndex
    };
  }

  function toRGBA(asset) {
    var out = new Uint8ClampedArray(asset.width * asset.height * 4);
    var p = asset.palette;
    for (var i = 0; i < asset.indices.length; i++) {
      var c = p[asset.indices[i]] || { r: 0, g: 0, b: 0, a: 0 };
      out[i * 4] = c.r; out[i * 4 + 1] = c.g; out[i * 4 + 2] = c.b; out[i * 4 + 3] = c.a;
    }
    return { width: asset.width, height: asset.height, data: out };
  }

  function toGPL(palette, name) {
    var lines = ['GIMP Palette', 'Name: ' + (name || 'Pixel Forge'), 'Columns: 8', '#'];
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i];
      if (c.a === 0) continue;
      var r = String(c.r), g = String(c.g), b = String(c.b);
      while (r.length < 3) r = ' ' + r;
      while (g.length < 3) g = ' ' + g;
      while (b.length < 3) b = ' ' + b;
      lines.push(r + ' ' + g + ' ' + b + '\t' + rgbToHex(c));
    }
    return lines.join('\n') + '\n';
  }

  return {
    VERSION: '1.5.1',
    PALETTE_DEFS: PALETTE_DEFS,
    palettes: resolvedPalettes,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    parsePalette: parsePalette,
    paletteFromHexList: paletteFromHexList,
    createImage: createImage,
    applyForegroundMask: applyForegroundMask,
    cloneImage: cloneImage,
    removeBackground: removeBackground,
    removeBlackWhite: removeBlackWhite,
    autoCrop: autoCrop,
    boundsOfOpaque: boundsOfOpaque,
    resample: resample,
    analyzeRegions: analyzeRegions,
    cleanRegionSpecks: cleanRegionSpecks,
    fitContain: fitContain,
    alphaThreshold: alphaThreshold,
    quantize: quantize,
    blueNoise: blueNoise,
    addOutline: addOutline,
    flattenSilhouette: flattenSilhouette,
    removeOrphans: removeOrphans,
    computeStats: computeStats,
    validate: validate,
    seamReport: seamReport,
    conform: conform,
    extractPalette: extractPalette,
    extractMedian: extractMedian,
    extractSpread: extractSpread,
    sortPaletteRamps: sortPaletteRamps,
    encodePNG: encodePNG,
    encodeRGBAPNG: encodeRGBAPNG,
    zlibDeflate: defaultDeflate,
    deflateStored: deflateStored,
    scaleNearest: scaleNearest,
    toRGBA: toRGBA,
    toGPL: toGPL
  };
});
