/* Filtros de imagem locais e independentes do DOM. */
(function (root) {
  'use strict';
  var PF = root.PF = root.PF || {};
  var PRESETS = [
    { id: 'none', label: 'Original' },
    { id: 'ps1', label: 'PS1 · cor reduzida' },
    { id: 'ps1-dither', label: 'PS1 · dither' },
    { id: 'gameboy', label: 'Game Boy · 4 tons' },
    { id: 'amber', label: 'Monitor âmbar' },
    { id: 'crt', label: 'CRT suave' }
  ];
  var bayer = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
  function quantize(v, levels, d) { return clamp(Math.round((v + d) / 255 * (levels - 1)) * 255 / (levels - 1)); }
  function pixelate(image, factor) {
    factor = Math.max(1, Number(factor) || 1);
    var out = new Uint8ClampedArray(image.data.length), w = image.width, h = image.height;
    for (var y = 0; y < h; y += factor) for (var x = 0; x < w; x += factor) {
      var p = (y * w + x) * 4;
      for (var yy = y; yy < Math.min(h, y + factor); yy++) for (var xx = x; xx < Math.min(w, x + factor); xx++) {
        var q = (yy * w + xx) * 4; out[q] = image.data[p]; out[q + 1] = image.data[p + 1]; out[q + 2] = image.data[p + 2]; out[q + 3] = image.data[p + 3];
      }
    }
    return { width: w, height: h, data: out };
  }
  function apply(image, options) {
    options = options || {}; var preset = options.preset || 'none', source = pixelate(image, options.pixelSize), out = new Uint8ClampedArray(source.data), dither = !!options.dither || preset === 'ps1-dither';
    for (var y = 0; y < source.height; y++) for (var x = 0; x < source.width; x++) {
      var i = (y * source.width + x) * 4, r = source.data[i], g = source.data[i + 1], b = source.data[i + 2], d = dither ? (bayer[y % 4][x % 4] - 7.5) * 4 : 0;
      if (preset === 'ps1' || preset === 'ps1-dither') { r = quantize(r, 32, d); g = quantize(g, 32, d); b = quantize(b, 32, d); }
      if (preset === 'gameboy') { var l = r * .299 + g * .587 + b * .114, levels = [28, 76, 138, 202], n = Math.max(0, Math.min(3, Math.round((l + d) / 255 * 3))); r = levels[n] * .55; g = levels[n] * .82; b = levels[n] * .43; }
      if (preset === 'amber') { var a = r * .299 + g * .587 + b * .114; r = a; g = a * .65; b = a * .12; }
      if (options.scanlines || preset === 'crt') { if (y % 2) { r *= .76; g *= .76; b *= .76; } }
      out[i] = clamp(r); out[i + 1] = clamp(g); out[i + 2] = clamp(b);
    }
    return { width: source.width, height: source.height, data: out };
  }
  PF.retroFilters = { presets: function () { return PRESETS.slice(); }, apply: apply };
})(typeof self !== 'undefined' ? self : this);
