/*
 * Composição e validação de folha de sprites.
 *
 * A folha é um asset indexado como qualquer outro: paleta única (união das
 * paletas dos sprites), um buffer de índices do tamanho da folha. Isso é o que
 * permite exportar um PNG indexado de verdade em vez de RGB colado.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else factory(root.PF);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';

  function colorKey(c) { return ((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255); }

  function contentBox(asset) {
    var t = asset.transparentIndex, w = asset.width, h = asset.height, idx = asset.indices;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (idx[y * w + x] === t) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /* placements: [{ asset, x, y }] — x/y em pixels da folha (canto superior esquerdo). */
  function composeSheet(width, height, placements) {
    var palette = [{ r: 0, g: 0, b: 0, a: 0 }]; // índice 0 = transparente
    var map = new Map();
    var indices = new Uint8Array(width * height);
    var list = placements || [];

    for (var i = 0; i < list.length; i++) {
      var pl = list[i], asset = pl.asset;
      var t = asset.transparentIndex;

      for (var y = 0; y < asset.height; y++) {
        var sy = pl.y + y;
        if (sy < 0 || sy >= height) continue;
        for (var x = 0; x < asset.width; x++) {
          var sx = pl.x + x;
          if (sx < 0 || sx >= width) continue;

          var v = asset.indices[y * asset.width + x];
          if (v === t) continue;

          var c = asset.palette[v];
          if (!c || c.a === 0) continue;

          var k = colorKey(c);
          var ui = map.get(k);
          if (ui === undefined) {
            if (palette.length >= 256) throw new Error('a folha passou de 256 cores');
            ui = palette.length;
            palette.push({ r: c.r, g: c.g, b: c.b, a: 255 });
            map.set(k, ui);
          }
          indices[sy * width + sx] = ui;
        }
      }
    }

    return {
      width: width,
      height: height,
      indices: indices,
      palette: palette,
      transparentIndex: 0,
      outlineIndex: -1
    };
  }

  /* Compara a ARTE, não os índices: dois sprites iguais com paletas
   * diferentes têm índices diferentes e ainda assim são o mesmo desenho. */
  function sameArt(a, b) {
    if (a.width !== b.width || a.height !== b.height) return false;
    var ta = a.transparentIndex, tb = b.transparentIndex;
    for (var i = 0; i < a.indices.length; i++) {
      var va = a.indices[i], vb = b.indices[i];
      var ea = va === ta, eb = vb === tb;
      if (ea !== eb) return false;
      if (ea) continue;
      var ca = a.palette[va], cb = b.palette[vb];
      if (!ca || !cb) return false;
      if (ca.r !== cb.r || ca.g !== cb.g || ca.b !== cb.b) return false;
    }
    return true;
  }

  function spread(values) {
    if (!values.length) return 0;
    var min = values[0], max = values[0];
    for (var i = 1; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    return max - min;
  }

  /* mode: 'grid' (animação, célula uniforme) | 'ruler' (elenco, posição livre) */
  function validateSheet(o) {
    var placements = o.placements || [];
    var mode = o.mode || 'grid';
    var checks = [];

    var outside = 0;
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      if (p.x < 0 || p.y < 0 || p.x + p.asset.width > o.width || p.y + p.asset.height > o.height) outside++;
    }
    checks.push({
      id: 'bounds', label: 'Dentro da folha',
      ok: outside === 0, detail: outside ? outside + ' fora' : placements.length + ' sprites'
    });

    if (mode === 'ruler') {
      var overlaps = 0;
      for (var a = 0; a < placements.length; a++) {
        for (var b = a + 1; b < placements.length; b++) {
          var pa = placements[a], pb = placements[b];
          if (pa.x < pb.x + pb.asset.width && pb.x < pa.x + pa.asset.width &&
            pa.y < pb.y + pb.asset.height && pb.y < pa.y + pa.asset.height) overlaps++;
        }
      }
      checks.push({
        id: 'overlap', label: 'Sem sobreposição',
        ok: overlaps === 0, detail: overlaps + ' par(es)'
      });
    }

    if (mode === 'grid') {
      var wrong = 0;
      for (var c = 0; c < placements.length; c++) {
        var pl = placements[c];
        if (pl.asset.width !== o.cell || pl.asset.height !== o.cell) wrong++;
      }
      checks.push({
        id: 'cellFit', label: 'Todos no tamanho da célula',
        ok: wrong === 0, detail: wrong ? wrong + ' fora de ' + o.cell + 'px' : o.cell + '×' + o.cell
      });
    }

    var bottoms = [], heights = [];
    for (var d = 0; d < placements.length; d++) {
      var box = contentBox(placements[d].asset);
      if (!box) continue;
      heights.push(box.h);
      bottoms.push(mode === 'ruler'
        ? placements[d].y + box.y + box.h
        : box.y + box.h);
    }

    var bSpread = spread(bottoms);
    var baselineOffset = mode === 'ruler' && o.baseline != null
      ? bottoms.reduce(function (max, bottom) { return Math.max(max, Math.abs(bottom - o.baseline)); }, 0)
      : 0;
    checks.push({
      id: 'baseline',
      label: mode === 'ruler' ? 'Linha de base comum' : 'Linha de base na célula',
      ok: bSpread <= 1 && baselineOffset <= 1,
      detail: mode === 'ruler' && o.baseline != null
        ? baselineOffset + ' px da régua · ' + bSpread + ' px de variação'
        : (bottoms.length < 2 ? 'poucos sprites' : bSpread + ' px de variação')
    });

    var colors = o.sheet ? o.sheet.palette.length - 1 : 0;
    var maxColors = o.maxColors || 64;
    checks.push({
      id: 'palette', label: 'Paleta do conjunto',
      ok: colors <= maxColors, detail: colors + ' / ' + maxColors
    });

    var dups = 0;
    for (var e = 0; e < placements.length; e++) {
      for (var f = e + 1; f < placements.length; f++) {
        if (sameArt(placements[e].asset, placements[f].asset)) dups++;
      }
    }
    checks.push({
      id: 'duplicates', label: 'Sem sprites repetidos',
      ok: dups === 0, detail: dups ? dups + ' par(es)' : 'ok'
    });

    var empty = 0;
    for (var g = 0; g < placements.length; g++) {
      if (!contentBox(placements[g].asset)) empty++;
    }
    checks.push({
      id: 'empty', label: 'Sem frames vazios',
      ok: empty === 0, detail: empty ? empty + ' vazio(s)' : 'ok'
    });

    if (mode === 'grid') {
      var dh = spread(heights);
      var limit = Math.max(2, Math.round((o.cell || 32) * 0.15));
      checks.push({
        id: 'drift', label: 'Altura estável entre frames',
        ok: dh <= limit, detail: dh + ' px (limite ' + limit + ')'
      });
    }

    var ok = true;
    for (var h = 0; h < checks.length; h++) if (!checks[h].ok) ok = false;
    return { checks: checks, ok: ok };
  }

  /* Metadados de export: um frame por placement, com bbox e pivô. */
  function sheetFrames(placements, mode, baseline) {
    var out = [];
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      var box = contentBox(p.asset);
      var pivot = box
        ? { x: p.x + Math.floor(box.x + box.w / 2), y: p.y + box.y + box.h - 1 }
        : { x: p.x + Math.floor(p.asset.width / 2), y: p.y + p.asset.height - 1 };
      out.push({
        index: i,
        assetId: p.assetId,
        name: p.name || ('frame-' + i),
        x: p.x,
        y: p.y,
        w: p.asset.width,
        h: p.asset.height,
        bbox: box,
        pivot: pivot
      });
    }
    return out;
  }

  if (PF) {
    PF.composeSheet = composeSheet;
    PF.validateSheet = validateSheet;
    PF.sheetFrames = sheetFrames;
    PF.sheetContentBox = contentBox;
  }

  return {
    composeSheet: composeSheet,
    validateSheet: validateSheet,
    sheetFrames: sheetFrames,
    contentBox: contentBox
  };
});
