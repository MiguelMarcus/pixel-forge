/*
 * Sombra automática: gera a projeção a partir da silhueta do sprite.
 *
 * A sombra é o único asset com alfa parcial neste app — ela precisa se
 * misturar com o chão. O PNG indexado suporta isso via tRNS, então o resto
 * do pipeline continua igual.
 *
 * `padBottom` abre linhas abaixo do sprite para a sombra aparecer: sprite
 * alinhado à base não tem espaço embaixo, e sem isso ela fica escondida.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else factory(root.PF);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function contentBox(asset) {
    var t = asset.transparentIndex, w = asset.width, h = asset.height;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (asset.indices[y * w + x] === t) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function shadowMask(sprite, opts) {
    opts = opts || {};
    var w = sprite.width;
    var pad = Math.max(0, Math.min(64, opts.padBottom | 0));
    var h = sprite.height + pad;
    var mask = new Uint8Array(w * h);
    var box = contentBox(sprite);
    if (!box) return mask;

    var t = sprite.transparentIndex;
    var shape = opts.shape || 'ellipse';
    var squash = clamp(opts.squash == null ? 0.35 : opts.squash, 0.1, 1);
    var scaleX = clamp(opts.widthScale == null ? 1 : opts.widthScale, 0.3, 3);
    var dx = Math.round(opts.offsetX || 0);
    var dy = Math.round(opts.offsetY || 0);

    var cx = box.x + box.w / 2;
    var feetY = box.y + box.h - 1;

    if (shape === 'ellipse') {
      var rx = Math.max(1, (box.w / 2) * scaleX);
      var ry = Math.max(1, rx * squash);
      var ecx = cx + dx;
      // não deixa a elipse sair do quadro: encosta na base quando falta espaço
      var ecy = Math.min(feetY + dy, h - 1 - ry);
      if (ecy < ry) ecy = Math.min(ry, h - 1);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var nx = (x + 0.5 - ecx) / rx;
          var ny = (y + 0.5 - ecy) / ry;
          if (nx * nx + ny * ny <= 1) mask[y * w + x] = 1;
        }
      }
      return mask;
    }

    /* silhueta achatada: mapeia cada pixel de saída de volta pra fonte */
    for (var oy = 0; oy < h; oy++) {
      var sy = feetY + (oy - dy - feetY) / squash;
      var syi = Math.round(sy);
      if (syi < 0 || syi >= sprite.height) continue;
      for (var ox = 0; ox < w; ox++) {
        var sx = cx + (ox - dx - cx) / scaleX;
        var sxi = Math.round(sx);
        if (sxi < 0 || sxi >= w) continue;
        if (sprite.indices[syi * w + sxi] !== t) mask[oy * w + ox] = 1;
      }
    }
    return mask;
  }

  function shadowColor(opts) {
    var hex = PF.hexToRgb(opts.color || '#000000') || { r: 0, g: 0, b: 0 };
    return {
      r: hex.r, g: hex.g, b: hex.b,
      a: Math.round(clamp(opts.alpha == null ? 0.45 : opts.alpha, 0, 1) * 255)
    };
  }

  function shadowAsset(sprite, opts) {
    opts = opts || {};
    var pad = Math.max(0, Math.min(64, opts.padBottom | 0));
    var h = sprite.height + pad;
    var mask = shadowMask(sprite, opts);
    var palette = [shadowColor(opts), { r: 0, g: 0, b: 0, a: 0 }];
    var idx = new Uint8Array(mask.length);
    for (var i = 0; i < mask.length; i++) idx[i] = mask[i] ? 0 : 1;
    return {
      width: sprite.width, height: h, indices: idx,
      palette: palette, transparentIndex: 1, outlineIndex: -1
    };
  }

  /* sprite na frente, sombra atrás: sem mistura de alfa, porque o sprite é opaco */
  function composite(sprite, opts) {
    opts = opts || {};
    var pad = Math.max(0, Math.min(64, opts.padBottom | 0));
    var w = sprite.width;
    var h = sprite.height + pad;
    var mask = shadowMask(sprite, opts);
    var palette = [shadowColor(opts)];
    var map = new Map();
    var t = sprite.transparentIndex;
    var used = new Set(sprite.indices);

    for (var i = 0; i < sprite.palette.length; i++) {
      var pc = sprite.palette[i];
      if (i === t || !pc || pc.a === 0 || !used.has(i)) { map.set(i, -1); continue; }
      map.set(i, palette.length);
      palette.push({ r: pc.r, g: pc.g, b: pc.b, a: 255 });
    }
    palette.push({ r: 0, g: 0, b: 0, a: 0 });
    if (palette.length > 256) throw new Error('a sombra precisa de espaço na paleta (máximo 254 cores do sprite)');
    var trans = palette.length - 1;

    var idx = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x;
        var m = -1;
        if (y < sprite.height) {
          m = map.get(sprite.indices[y * w + x]);
          if (m === undefined) m = -1;
        }
        if (m >= 0) idx[p] = m;
        else idx[p] = mask[p] ? 0 : trans;
      }
    }

    return {
      width: w, height: h, indices: idx,
      palette: palette, transparentIndex: trans, outlineIndex: -1
    };
  }

  if (PF) {
    PF.shadowMask = shadowMask;
    PF.shadowAsset = shadowAsset;
    PF.compositeShadow = composite;
  }

  return { shadowMask: shadowMask, shadowAsset: shadowAsset, composite: composite };
});
