/*
 * Score contra a âncora: o quanto um sprite "parece do mesmo jogo" que o
 * aprovado. Não conserta nada — serve para triar uma pilha de candidatos.
 *
 * Mede seis coisas que juntas respondem "mesma mão?":
 *   paleta, distribuição de valor, peso de linha, outline, silhueta e escala.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else factory(root.PF);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';

  function usedColors(asset) {
    var t = asset.transparentIndex;
    var seen = new Set();
    var out = [];
    for (var i = 0; i < asset.indices.length; i++) {
      var v = asset.indices[i];
      if (v === t || seen.has(v)) continue;
      seen.add(v);
      var c = asset.palette[v];
      if (c && c.a > 0) out.push(c);
    }
    return out;
  }

  function luminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

  function valueHistogram(asset) {
    var bands = new Float64Array(5);
    var t = asset.transparentIndex;
    var n = 0;
    for (var i = 0; i < asset.indices.length; i++) {
      var v = asset.indices[i];
      if (v === t) continue;
      var c = asset.palette[v];
      if (!c || c.a === 0) continue;
      var b = Math.min(4, Math.floor(luminance(c) / 51.2));
      bands[b]++;
      n++;
    }
    if (!n) return bands;
    for (var k = 0; k < 5; k++) bands[k] /= n;
    return bands;
  }

  function boxOf(asset) {
    var t = asset.transparentIndex, w = asset.width, h = asset.height;
    var minX = w, minY = h, maxX = -1, maxY = -1, opaque = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (asset.indices[y * w + x] === t) continue;
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, opaque: opaque };
  }

  function edgeStats(asset) {
    var t = asset.transparentIndex, w = asset.width, h = asset.height, idx = asset.indices;
    var edges = 0, opaque = 0, boundary = 0, outlined = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x;
        var v = idx[p];
        if (v === t) continue;
        opaque++;
        var isBoundary = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        if (!isBoundary) {
          if (idx[p - 1] === t || idx[p + 1] === t || idx[p - w] === t || idx[p + w] === t) isBoundary = true;
        }
        if (isBoundary) {
          boundary++;
          if (asset.outlineIndex >= 0 && v === asset.outlineIndex) outlined++;
        }
        var differs = false;
        if (x > 0 && idx[p - 1] !== v) differs = true;
        else if (x < w - 1 && idx[p + 1] !== v) differs = true;
        else if (y > 0 && idx[p - w] !== v) differs = true;
        else if (y < h - 1 && idx[p + w] !== v) differs = true;
        if (differs) edges++;
      }
    }
    return {
      density: opaque ? edges / opaque : 0,
      outlineCoverage: boundary ? outlined / boundary : 0
    };
  }

  function metrics(asset) {
    var box = boxOf(asset);
    var hist = valueHistogram(asset);
    var e = edgeStats(asset);
    var cols = usedColors(asset);
    return {
      colors: cols,
      histogram: hist,
      density: e.density,
      outlineCoverage: e.outlineCoverage,
      box: box,
      fill: box ? box.opaque / (box.w * box.h) : 0,
      aspect: box ? box.w / box.h : 1,
      relativeHeight: box ? box.h / asset.height : 0
    };
  }

  function colorDistance(a, b) {
    var dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function nearestPaletteDistance(c, palette) {
    var best = Infinity;
    for (var i = 0; i < palette.length; i++) {
      var d = colorDistance(c, palette[i]);
      if (d < best) best = d;
    }
    return best;
  }

  function rel(a, b) {
    var m = Math.max(a, b);
    return m <= 0 ? 0 : Math.abs(a - b) / m;
  }

  var WEIGHTS = {
    palette: 0.30,
    value: 0.25,
    density: 0.15,
    outline: 0.10,
    fill: 0.10,
    aspect: 0.05,
    scale: 0.05
  };

  function scorePair(anchor, candidate) {
    if (!anchor || !candidate || !anchor.indices || !candidate.indices) return null;

    var a = metrics(anchor);
    var b = metrics(candidate);

    var paletteMiss = 0, paletteCoverage = 0;
    if (a.colors.length) {
      var sum = 0, inside = 0;
      for (var i = 0; i < b.colors.length; i++) {
        var d = nearestPaletteDistance(b.colors[i], a.colors);
        sum += d;
        if (d <= 40) inside++;
      }
      paletteMiss = b.colors.length ? Math.min(1, (sum / b.colors.length) / 441) : 1;
      paletteCoverage = b.colors.length ? inside / b.colors.length : 0;
    } else {
      paletteMiss = 1;
    }

    var valueDistance = 0;
    for (var k = 0; k < 5; k++) valueDistance += Math.abs(a.histogram[k] - b.histogram[k]);
    valueDistance = Math.min(1, valueDistance / 2);

    var densityDiff = rel(a.density, b.density);
    var outlineDiff = Math.abs(a.outlineCoverage - b.outlineCoverage);
    var fillDiff = Math.abs(a.fill - b.fill);
    var aspectDiff = rel(a.aspect, b.aspect);
    var scaleDiff = rel(a.relativeHeight, b.relativeHeight);

    var total =
      WEIGHTS.palette * paletteMiss +
      WEIGHTS.value * valueDistance +
      WEIGHTS.density * densityDiff +
      WEIGHTS.outline * outlineDiff +
      WEIGHTS.fill * fillDiff +
      WEIGHTS.aspect * aspectDiff +
      WEIGHTS.scale * scaleDiff;

    var score = Math.round(100 * Math.max(0, Math.min(1, 1 - total)));
    var verdict = score >= 85 ? 'aceitar' : (score >= 70 ? 'ajustar' : 're-gerar');

    return {
      score: score,
      verdict: verdict,
      metrics: {
        paletteMiss: paletteMiss,
        paletteCoverage: paletteCoverage,
        valueDistance: valueDistance,
        densityDiff: densityDiff,
        outlineDiff: outlineDiff,
        fillDiff: fillDiff,
        aspectDiff: aspectDiff,
        scaleDiff: scaleDiff
      },
      worst: worstMetric({
        palette: paletteMiss, value: valueDistance, density: densityDiff,
        outline: outlineDiff, fill: fillDiff, aspect: aspectDiff, scale: scaleDiff
      })
    };
  }

  var LABELS = {
    palette: 'paleta',
    value: 'distribuição de valor',
    density: 'peso de linha',
    outline: 'outline',
    fill: 'preenchimento da silhueta',
    aspect: 'proporção da silhueta',
    scale: 'escala'
  };

  function worstMetric(m) {
    var best = null, bestVal = -1;
    for (var k in m) {
      if (!Object.prototype.hasOwnProperty.call(m, k)) continue;
      if (m[k] > bestVal) { bestVal = m[k]; best = k; }
    }
    return { key: best, label: LABELS[best] || best, value: bestVal };
  }

  if (PF) {
    PF.scorePair = scorePair;
    PF.scoreMetrics = metrics;
  }

  return { scorePair: scorePair, metrics: metrics };
});
