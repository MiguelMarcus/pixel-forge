/* Preparação de texturas locais e independente do DOM. */
(function (root) {
  'use strict';
  var PF = root.PF = root.PF || {};
  var PRESETS = [
    { id: 'none', label: 'Textura base · preservar cores' },
    { id: 'ps1', label: 'PS1 · albedo reduzido' },
    { id: 'ps1-dither', label: 'PS1 · albedo com dither' },
    { id: 'low-color', label: 'Low poly · cores simplificadas' }
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
  function mapOutput(image, type) {
    if (type === 'base') return image;
    var out = new Uint8ClampedArray(image.data), w = image.width, h = image.height;
    function luma(x, y) { var i = ((y * w + x) * 4); return out[i] * .299 + out[i + 1] * .587 + out[i + 2] * .114; }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4, l = luma(x, y);
      if (type === 'height' || type === 'roughness') { var v = clamp(l); out[i] = out[i + 1] = out[i + 2] = v; continue; }
      if (type === 'normal') {
        var left = luma((x - 1 + w) % w, y), right = luma((x + 1) % w, y), up = luma(x, (y - 1 + h) % h), down = luma(x, (y + 1) % h);
        out[i] = clamp(128 + (left - right) * .65); out[i + 1] = clamp(128 + (up - down) * .65); out[i + 2] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }
  function apply(image, options) {
    options = options || {}; var preset = options.preset || 'none', source = pixelate(image, options.pixelSize), out = new Uint8ClampedArray(source.data), dither = !!options.dither || preset === 'ps1-dither';
    for (var y = 0; y < source.height; y++) for (var x = 0; x < source.width; x++) {
      var i = (y * source.width + x) * 4, r = source.data[i], g = source.data[i + 1], b = source.data[i + 2], d = dither ? (bayer[y % 4][x % 4] - 7.5) * 4 : 0;
      if (preset === 'ps1' || preset === 'ps1-dither') { r = quantize(r, 32, d); g = quantize(g, 32, d); b = quantize(b, 32, d); }
      if (preset === 'low-color') { r = quantize(r, 8, d); g = quantize(g, 8, d); b = quantize(b, 8, d); }
      out[i] = clamp(r); out[i + 1] = clamp(g); out[i + 2] = clamp(b);
    }
    return mapOutput({ width: source.width, height: source.height, data: out }, options.map || 'base');
  }
  PF.textureFilters = { presets: function () { return PRESETS.slice(); }, apply: apply };
  PF.retroFilters = PF.textureFilters;
})(typeof self !== 'undefined' ? self : this);
