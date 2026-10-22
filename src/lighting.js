/* Relevo e normais em espaço tangente. Não altera o sprite nem sua paleta. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else factory(root.PF);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function number(v, fallback, lo, hi) { return Number.isFinite(v) ? clamp(v, lo, hi) : fallback; }
  function settings(value) {
    var v = value || {};
    return {
      assetId: typeof v.assetId === 'string' ? v.assetId : 'editor',
      mode: v.mode === 'luminance' ? 'luminance' : 'silhouette',
      detail: number(v.detail, 0, 0, 1), strength: number(v.strength, 6, 0, 20),
      smooth: Math.round(number(v.smooth, 1, 0, 4)),
      invert: v.invert === true, flipY: v.flipY === true,
      azimuth: number(v.azimuth, 135, 0, 360), elevation: number(v.elevation, 45, 5, 90),
      ambient: number(v.ambient, 0.35, 0, 1), intensity: number(v.intensity, 0.9, 0, 2),
      specular: number(v.specular, 0.15, 0, 1),
      color: PF.hexToRgb(v.color) ? v.color : '#fff1d6',
      selfShadow: v.selfShadow !== false,
      view: ['lit', 'source', 'height', 'normal'].indexOf(v.view) >= 0 ? v.view : 'lit'
    };
  }

  // Distância à transparência, incluindo o exterior do quadro (chamfer 8 vizinhos).
  function distances(mask, w, h) {
    var stride = w + 2, d = new Float32Array(stride * (h + 2));
    var diagonal = Math.SQRT2;
    for (var y = 1; y <= h; y++) for (var x = 1; x <= w; x++) {
      var p = y * stride + x;
      if (mask[(y - 1) * w + x - 1]) d[p] = Math.min(
        d[p - 1] + 1, d[p - stride] + 1, d[p - stride - 1] + diagonal, d[p - stride + 1] + diagonal);
    }
    for (var by = h; by >= 1; by--) for (var bx = w; bx >= 1; bx--) {
      var bp = by * stride + bx;
      if (mask[(by - 1) * w + bx - 1]) d[bp] = Math.min(d[bp],
        d[bp + 1] + 1, d[bp + stride] + 1, d[bp + stride - 1] + diagonal, d[bp + stride + 1] + diagonal);
    }
    var out = new Float32Array(w * h), max = 1;
    for (var oy = 0; oy < h; oy++) for (var ox = 0; ox < w; ox++) {
      var i = oy * w + ox;
      out[i] = d[(oy + 1) * stride + ox + 1];
      max = Math.max(max, out[i]);
    }
    for (var k = 0; k < out.length; k++) out[k] /= max;
    return out;
  }

  function generate(asset, options) {
    var s = settings(options), source = PF.toRGBA(asset);
    var w = asset.width, h = asset.height, n = w * h;
    var mask = new Uint8Array(n), height = new Float32Array(n);
    for (var i = 0; i < n; i++) mask[i] = source.data[i * 4 + 3] > 0 ? 1 : 0;
    var volume = distances(mask, w, h);
    for (var p = 0; p < n; p++) {
      if (!mask[p]) continue;
      var rgb = p * 4;
      var luma = (0.2126 * source.data[rgb] + 0.7152 * source.data[rgb + 1] + 0.0722 * source.data[rgb + 2]) / 255;
      var dome = Math.sqrt(Math.max(0, 2 * volume[p] - volume[p] * volume[p]));
      var value = s.mode === 'luminance' ? luma : dome * (1 - s.detail) + luma * s.detail;
      height[p] = s.invert ? 1 - value : value;
    }
    // Blur separável, só entre pixels opacos: não expande a silhueta.
    for (var axis = 0; axis < 2 && s.smooth; axis++) {
      var smoothed = new Float32Array(n);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var pi = y * w + x;
        if (!mask[pi]) continue;
        var sum = 0, count = 0;
        for (var offset = -s.smooth; offset <= s.smooth; offset++) {
          var sx = x + (axis ? 0 : offset), sy = y + (axis ? offset : 0);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h || !mask[sy * w + sx]) continue;
          sum += height[sy * w + sx]; count++;
        }
        smoothed[pi] = count ? sum / count : height[pi];
      }
      height = smoothed;
    }
    var bump = PF.createImage(w, h), normal = PF.createImage(w, h), vectors = new Float32Array(n * 3);
    function sample(x, y) { return x < 0 || y < 0 || x >= w || y >= h ? 0 : height[y * w + x]; }
    for (var ny = 0; ny < h; ny++) for (var nx = 0; nx < w; nx++) {
      var np = ny * w + nx, o = np * 4, vo = np * 3;
      var dx = mask[np] ? (sample(nx + 1, ny) - sample(nx - 1, ny)) * s.strength / 2 : 0;
      var dy = mask[np] ? (sample(nx, ny + 1) - sample(nx, ny - 1)) * s.strength / 2 : 0;
      var length = Math.hypot(dx, dy, 1);
      // X direita, Y para cima, Z para o observador. A convenção só muda a exportação.
      vectors[vo] = -dx / length; vectors[vo + 1] = dy / length; vectors[vo + 2] = 1 / length;
      bump.data[o] = bump.data[o + 1] = bump.data[o + 2] = Math.round(height[np] * 255);
      bump.data[o + 3] = source.data[o + 3];
      normal.data[o] = Math.round((vectors[vo] * 0.5 + 0.5) * 255);
      normal.data[o + 1] = Math.round((vectors[vo + 1] * (s.flipY ? -1 : 1) * 0.5 + 0.5) * 255);
      normal.data[o + 2] = Math.round((vectors[vo + 2] * 0.5 + 0.5) * 255);
      normal.data[o + 3] = source.data[o + 3];
    }
    return { width: w, height: h, source: source, heights: height, mask: mask, bump: bump, normal: normal, vectors: vectors, strength: s.strength };
  }

  function illuminate(maps, options) {
    var s = settings(options), w = maps.width, h = maps.height;
    var out = PF.createImage(w, h), rad = Math.PI / 180;
    var a = s.azimuth * rad, e = s.elevation * rad;
    var lx = Math.cos(a) * Math.cos(e), ly = Math.sin(a) * Math.cos(e), lz = Math.sin(e);
    var hx = lx, hy = ly, hz = lz + 1, hl = Math.hypot(hx, hy, hz);
    hx /= hl; hy /= hl; hz /= hl;
    var color = PF.hexToRgb(s.color), channels = [color.r / 255, color.g / 255, color.b / 255];
    var steps = Math.min(32, Math.ceil(maps.strength / Math.tan(e)));
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = y * w + x, o = p * 4, v = p * 3;
      out.data[o + 3] = maps.source.data[o + 3];
      if (!maps.mask[p]) continue;
      var nx = maps.vectors[v], ny = maps.vectors[v + 1], nz = maps.vectors[v + 2];
      var visibility = 1;
      if (s.selfShadow && s.elevation < 89) {
        for (var step = 1; step <= steps; step++) {
          var sx = Math.round(x + Math.cos(a) * step), sy = Math.round(y - Math.sin(a) * step);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
          var sp = sy * w + sx;
          if (maps.mask[sp] && maps.heights[sp] * maps.strength > maps.heights[p] * maps.strength + step * Math.tan(e) + 0.03) {
            visibility = 0; break;
          }
        }
      }
      var diffuse = Math.max(0, nx * lx + ny * ly + nz * lz) * visibility * s.intensity;
      var shine = diffuse > 0 ? Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 24) * s.specular * s.intensity : 0;
      for (var c = 0; c < 3; c++) out.data[o + c] = clamp(Math.round(
        maps.source.data[o + c] * (s.ambient + diffuse * channels[c]) + 255 * shine * channels[c]), 0, 255);
    }
    return out;
  }
  PF.lighting = { settings: settings, generate: generate, illuminate: illuminate };
  return PF.lighting;
});
