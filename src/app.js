/* Pixel Forge — UI e orquestração */
(function () {
  'use strict';

  var PF = window.PF;
  var $ = function (id) { return document.getElementById(id); };
  var PALETTES = PF.palettes();
  var MAX_SOURCE = 1024;
  var PROFILE_LIST = PF.profileList();
  var STORE = PF.library.createStore();

  var INITIAL_PARAMS = PF.profileParams('character');
  INITIAL_PARAMS.bgColor = '#ffffff';

  var state = {
    source: null,
    sourceName: '',
    result: null,
    profile: 'character',
    paletteMode: INITIAL_PARAMS.palette || 'sweetie16',
    customPalette: '',
    extracted: null,
    extractMode: INITIAL_PARAMS.extractMode || 'dominant',
    eyedropper: false,
    zoom: 'fit',
    appliedZoom: 1,
    showGrid: true,
    compare: true,
    split: 0.5,
    params: INITIAL_PARAMS,
    contract: PF.profileContract('character')
  };

  /* ---------------------------------------------------------------- utils */

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  function hexToObj(hex) {
    return PF.hexToRgb(hex) || { r: 255, g: 255, b: 255 };
  }

  function toBlob(bytes, mime) {
    return bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  /* Se o navegador bloquear o download, o link fica ali: dá pra clicar com o
   * botão direito e "salvar link como", que não passa pela política de download. */
  var saveBarUrl = null;
  var saveBarTimer = null;

  function showSaveBar(url, name, size) {
    if (saveBarUrl) URL.revokeObjectURL(saveBarUrl);
    saveBarUrl = url;
    $('saveBarText').textContent = name + ' · ' + (size / 1024).toFixed(1) + ' KB';
    $('saveBarLink').href = url;
    $('saveBarLink').download = name;
    $('saveBar').classList.remove('hidden');
    clearTimeout(saveBarTimer);
    saveBarTimer = setTimeout(hideSaveBar, 45000);
  }

  function hideSaveBar() {
    $('saveBar').classList.add('hidden');
    if (saveBarUrl) { URL.revokeObjectURL(saveBarUrl); saveBarUrl = null; }
    clearTimeout(saveBarTimer);
  }

  /* Download por âncora: funciona em http e na maioria dos casos de file://. */
  function anchorDownload(bytes, name, mime) {
    var blob = toBlob(bytes, mime);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    showSaveBar(url, name, blob.size);
    return 'anchor';
  }

  /* Caminho único de gravação: download por âncora, com a URL do blob viva
   * enquanto a barra estiver na tela (revogar cedo trunca o arquivo). */
  function saveBytes(bytes, name, mime) {
    var blob = toBlob(bytes, mime);
    if (!blob.size) return Promise.reject(new Error('gerou 0 bytes'));
    return Promise.resolve(anchorDownload(blob, name, mime));
  }

  /* compat: usado por quem só tem o blob na mão */
  function download(bytes, name, mime) {
    anchorDownload(bytes, name, mime);
  }

  function slugOf(name) {
    var base = String(name || 'sprite').replace(/\.[^.]+$/, '');
    base = base.normalize ? base.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : base;
    return (base.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()) || 'sprite';
  }

  function safeName() {
    return slugOf(state.sourceName);
  }

  /* ---------------------------------------------------------------- receita */

  function imageToDataURL(img) {
    var c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    var ctx = c.getContext('2d');
    var id = ctx.createImageData(img.width, img.height);
    id.data.set(img.data);
    ctx.putImageData(id, 0, 0);
    return c.toDataURL('image/png');
  }

  /* Tudo o que é preciso pra reproduzir este sprite depois, sem o resultado. */
  function snapshotFor(image, name) {
    var p = state.params;
    var pal = getPalette()
      .filter(function (c) { return c.a > 0; })
      .map(PF.rgbToHex);

    return {
      name: slugOf(name || state.sourceName),
      profile: state.profile,
      source: image,
      sourceDataUrl: imageToDataURL(image),
      params: {
        sizeW: p.sizeW, sizeH: p.sizeH,
        mode: p.mode, fit: p.fit, align: p.align, margin: p.margin,
        autoCrop: !!p.autoCrop, removeBg: !!p.removeBg,
        bgColor: p.bgColor, bgTolerance: p.bgTolerance, alpha: p.alpha,
        dither: p.dither, ditherAmount: p.ditherAmount,
        outline: !!p.outline, outlineRadius: p.outlineRadius, outlineDiag: !!p.outlineDiag,
        outlineColor: p.outlineColor, outlineAuto: p.outlineAuto !== false,
        outlineInner: !!p.outlineInner,
        removeBW: !!p.removeBW, bwTolerance: p.bwTolerance,
        silhouette: p.silhouette || 'off',
        orphanCleanup: !!p.orphanCleanup,
        palette: pal,
        scrollFactor: p.scrollFactor
      },
      contract: {
        maxColors: state.contract.maxColors,
        minDistance: state.contract.minDistance,
        requireOutline: !!state.contract.requireOutline,
        requireMargin: !!state.contract.requireMargin,
        maxOrphans: state.contract.maxOrphans,
        rules: (state.contract.rules || []).slice()
      }
    };
  }

  function currentSnapshot() {
    return snapshotFor(state.source, state.sourceName);
  }

  function saveToLibrary() {
    if (!state.result || !state.source) return;
    try {
      PF.tabs.addItem(currentSnapshot());
      toast('Salvo na biblioteca.');
    } catch (e) {
      console.error(e);
      toast('Não consegui salvar: ' + e.message);
    }
  }

  function loadItem(item) {
    state.source = item.source;
    state.sourceName = item.name;
    state.profile = item.profile || state.profile;
    state.params = JSON.parse(JSON.stringify(item.params));
    state.contract = JSON.parse(JSON.stringify(item.contract));
    state.extracted = null;
    state.paletteMode = 'custom';
    state.customPalette = (item.params.palette || []).join(' ');
    $('paletteCustom').value = state.customPalette;
    buildPaletteSelect();
    $('palettePreset').value = 'custom';
    syncControls();
    recompute();
    PF.tabs.switchTab('sprite');
    toast('“' + item.name + '” carregado no editor.');
  }

  function dominantBorderColor(img) {
    var w = img.width, h = img.height, d = img.data;
    var counts = {}, best = null, bestN = 0;
    function add(x, y) {
      var i = (y * w + x) * 4;
      var key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      var e = counts[key] || (counts[key] = { n: 0, r: 0, g: 0, b: 0 });
      e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
      if (e.n > bestN) { bestN = e.n; best = e; }
    }
    for (var x = 0; x < w; x++) { add(x, 0); if (h > 1) add(x, h - 1); }
    for (var y = 0; y < h; y++) { add(0, y); if (w > 1) add(w - 1, y); }
    if (!best) return { r: 255, g: 255, b: 255 };
    return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
  }

  /* ---------------------------------------------------------------- paleta */

  function buildPaletteSelect() {
    var sel = $('palettePreset');
    sel.innerHTML = '';
    Object.keys(PALETTES).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = PALETTES[k].name + ' · ' + PALETTES[k].colors.length;
      sel.appendChild(o);
    });
    if (state.extracted && state.extracted.length) {
      var oe = document.createElement('option');
      oe.value = 'extracted';
      oe.textContent = 'extraída · ' + state.extracted.length;
      sel.appendChild(oe);
    }
    var oc = document.createElement('option');
    oc.value = 'custom';
    oc.textContent = 'custom (hex)';
    sel.appendChild(oc);
    sel.value = state.paletteMode;
  }

  function getPalette() {
    if (state.paletteMode === 'custom') {
      var p = PF.parsePalette(state.customPalette);
      if (p.length) return p;
      return PALETTES.pico8.colors;
    }
    if (state.paletteMode === 'extracted' && state.extracted && state.extracted.length) return state.extracted;
    var e = PALETTES[state.paletteMode];
    return e ? e.colors : PALETTES.pico8.colors;
  }

  /* ---------------------------------------------------------------- conta-gotas */

  function setEyedropper(on) {
    state.eyedropper = !!on;
    var btn = $('pickColor');
    btn.classList.toggle('active', state.eyedropper);
    btn.textContent = state.eyedropper ? 'clique numa cor da imagem' : '+ cor da imagem';
    $('srcCanvas').style.cursor = state.eyedropper ? 'crosshair' : '';
  }

  function addPaletteColor(hex) {
    var cur = getPalette().filter(function (c) { return c.a > 0; });
    for (var i = 0; i < cur.length; i++) {
      if (PF.rgbToHex(cur[i]) === hex) { toast(hex + ' já está na paleta.'); return; }
    }
    if (cur.length >= 64) { toast('Paleta cheia (64 cores).'); return; }

    var c = PF.hexToRgb(hex);
    var next = cur.map(function (x) { return { r: x.r, g: x.g, b: x.b, a: 255 }; });
    next.push({ r: c.r, g: c.g, b: c.b, a: 255 });

    state.extracted = next;
    state.paletteMode = 'extracted';
    buildPaletteSelect();
    $('palettePreset').value = 'extracted';
    syncBgOpts();
    recompute();
    toast(hex + ' preservada na paleta.');
  }

  function pickSourceColor(e) {
    if (!state.prepared) return;
    var canvas = $('srcCanvas');
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;

    var fx = (e.clientX - r.left) / r.width;
    var fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;

    var img = state.prepared;
    var x = Math.max(0, Math.min(img.width - 1, Math.floor(fx * img.width)));
    var y = Math.max(0, Math.min(img.height - 1, Math.floor(fy * img.height)));
    var i = (y * img.width + x) * 4;

    if (img.data[i + 3] < 128) { toast('Ponto transparente — clique numa cor.'); return; }
    addPaletteColor(PF.rgbToHex({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }));
  }

  /* ---------------------------------------------------------------- prepare */

  function prepare() {
    if (!state.source) return null;
    var img = state.source;
    if (state.params.removeBg) {
      img = PF.removeBackground(img, hexToObj(state.params.bgColor), state.params.bgTolerance);
    }
    // o mesmo limiar que o conform aplica: mantém a receita reproduzível
    if (state.params.alpha != null) {
      img = PF.alphaThreshold(img, state.params.alpha);
    }
    if (state.params.removeBW) {
      img = PF.removeBlackWhite(img, state.params.bwTolerance == null ? 12 : state.params.bwTolerance);
    }
    if (state.params.autoCrop) {
      img = PF.autoCrop(img).image;
    }
    return img;
  }

  /* ---------------------------------------------------------------- pipeline */

  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(recompute, 80);
  }

  function recompute() {
    if (!state.source) return;
    var prepared = prepare();
    if (!prepared) return;

    var palette = getPalette();
    if (!palette.length) { toast('Paleta vazia.'); return; }

    var p = state.params;
    var result;
    try {
      result = PF.conform(prepared, {
        targetW: p.sizeW,
        targetH: p.sizeH,
        margin: (p.outline && !p.outlineInner)
          ? Math.max(p.margin || 0, Math.min(8, p.outlineRadius || 1))
          : (p.margin || 0),
        mode: p.mode,
        fit: p.fit,
        align: p.align,
        doAutoCrop: false,
        removeBg: false,
        alphaThreshold: p.alpha,
        removeBlackWhite: !!p.removeBW,
        bwTolerance: p.bwTolerance == null ? 12 : p.bwTolerance,
        palette: palette,
        dither: p.dither,
        ditherAmount: p.ditherAmount / 100,
        silhouette: p.silhouette || 'off',
        outline: p.outline,
        outlineRadius: p.outlineRadius,
        outlineDiag: p.outlineDiag,
        outlineInner: !!p.outlineInner,
        outlineColor: p.outlineAuto === false ? p.outlineColor : null,
        orphanCleanup: p.orphanCleanup,
        contract: state.contract
      });
    } catch (err) {
      console.error(err);
      state.result = null;
      updateExportEnabled();
      toast('Erro no pipeline: ' + err.message);
      return;
    }

    state.result = result;
    state.prepared = prepared;

    $('emptyState').classList.add('hidden');
    $('compare').classList.remove('hidden');

    drawOutput(result.asset);
    renderChecks(result);
    renderStats(result);
    renderSwatches(result.asset);
    applyZoom();
    updateExportEnabled();
    if (PF.lightingTab) PF.lightingTab.render();
  }

  /* ---------------------------------------------------------------- render */

  function drawOutput(asset) {
    var canvas = $('outCanvas');
    canvas.width = asset.width;
    canvas.height = asset.height;
    var ctx = canvas.getContext('2d');
    var rgba = PF.toRGBA(asset);
    var imgData = ctx.createImageData(asset.width, asset.height);
    imgData.data.set(rgba.data);
    ctx.putImageData(imgData, 0, 0);

    $('stageDims').textContent = asset.width + '×' + asset.height;
    var src = state.source;
    $('stageInfo').textContent = src
      ? src.width + '×' + src.height + ' → ' + state.params.sizeW + '×' + state.params.sizeH
      : '';
    $('footRight').textContent = asset.width * asset.height + ' células · ' +
      (state.result ? state.result.stats.colorsUsed : 0) + ' cores';
  }

  function drawSource(dw, dh) {
    if (!state.prepared) return;
    var canvas = $('srcCanvas');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(dw * dpr));
    canvas.height = Math.max(1, Math.round(dh * dpr));
    canvas.style.width = dw + 'px';
    canvas.style.height = dh + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    var tmp = document.createElement('canvas');
    tmp.width = state.prepared.width;
    tmp.height = state.prepared.height;
    var tctx = tmp.getContext('2d');
    var id = tctx.createImageData(state.prepared.width, state.prepared.height);
    id.data.set(state.prepared.data);
    tctx.putImageData(id, 0, 0);
    ctx.drawImage(tmp, 0, 0, dw, dh);
  }

  function applyZoom() {
    if (!state.result) return;
    var a = state.result.asset;
    var body = $('stageBody');
    var availW = Math.max(80, body.clientWidth - 56);
    var availH = Math.max(80, body.clientHeight - 56);

    var z;
    if (state.zoom === 'fit') {
      z = Math.floor(Math.min(availW / a.width, availH / a.height));
    } else {
      z = state.zoom;
    }
    z = Math.max(1, Math.min(24, z || 1));
    state.appliedZoom = z;

    var dw = a.width * z;
    var dh = a.height * z;
    var wrap = $('canvasWrap');
    wrap.style.width = dw + 'px';
    wrap.style.height = dh + 'px';

    var out = $('outCanvas');
    out.style.width = dw + 'px';
    out.style.height = dh + 'px';

    $('zoomLabel').textContent = z + '×';
    $('gridOverlay').style.backgroundSize = z + 'px ' + z + 'px';
    $('gridOverlay').classList.toggle('off', !state.showGrid || z < 4);

    drawSource(dw, dh);
    setSplit(state.split);
  }

  function setSplit(v) {
    state.split = Math.max(0, Math.min(1, v));
    $('divider').style.left = (state.split * 100) + '%';
    $('srcClip').style.width = (state.split * 100) + '%';
  }

  function setCompare(on) {
    state.compare = on;
    $('srcClip').classList.toggle('hidden', !on);
    $('divider').classList.toggle('hidden-div', !on);
    var bl = $('badgeL'), br = $('badgeR');
    if (bl) bl.classList.toggle('hidden', !on);
    if (br) br.classList.toggle('hidden', !on);
    $('compareToggle').classList.toggle('active', on);
  }

  function renderChecks(result) {
    var box = $('checks');
    box.innerHTML = '';
    var bad = 0;
    result.checks.forEach(function (c) {
      if (!c.ok) bad++;
      var row = document.createElement('div');
      row.className = 'check-row ' + (c.ok ? 'ok' : 'bad');
      var ic = document.createElement('span');
      ic.className = 'ci';
      ic.textContent = c.ok ? '✓' : '✕';
      var wrap = document.createElement('div');
      var l = document.createElement('div');
      l.className = 'cl';
      l.textContent = c.label;
      var d = document.createElement('div');
      d.className = 'cd';
      d.textContent = c.detail;
      wrap.appendChild(l);
      wrap.appendChild(d);
      row.appendChild(ic);
      row.appendChild(wrap);
      box.appendChild(row);
    });

    var v = $('verdict');
    if (bad === 0) {
      v.textContent = 'CONFORME';
      v.className = 'verdict pass';
    } else {
      v.textContent = bad + (bad === 1 ? ' FALHA' : ' FALHAS');
      v.className = 'verdict fail';
    }
  }

  function renderStats(result) {
    var a = result.asset, s = result.stats;
    var host = $('stats');
    host.innerHTML = '';

    function add(k, v) {
      var row = document.createElement('div');
      row.className = 'stat';
      var kk = document.createElement('span');
      kk.className = 'k';
      kk.textContent = k;
      var vv = document.createElement('span');
      vv.className = 'v';
      vv.textContent = v;
      row.appendChild(kk);
      row.appendChild(vv);
      host.appendChild(row);
    }

    add('resolução', a.width + '×' + a.height);
    add('cores em uso', s.colorsUsed + ' / ' + a.palette.filter(function (c) { return c.a > 0; }).length);
    add('cobertura', (s.coverage * 100).toFixed(1) + '%');
    add('pixels órfãos', String(s.orphans));
    add('limpos', String(s.removedOrphans || 0));
    add('bounding box', s.bbox ? s.bbox.w + '×' + s.bbox.h : '—');
    add('formato', 'indexado 8-bit');
  }

  function renderSwatches(asset) {
    var host = $('swatches');
    host.innerHTML = '';
    var usage = state.result ? state.result.stats.usage : new Map();
    var shown = 0;
    for (var i = 0; i < asset.palette.length && shown < 32; i++) {
      var c = asset.palette[i];
      if (c.a === 0) continue;
      shown++;
      var n = usage.get(i) || 0;
      var sw = document.createElement('div');
      sw.className = 'swatch ' + (n > 0 ? 'used' : 'unused');
      sw.style.background = PF.rgbToHex(c);
      sw.title = PF.rgbToHex(c) + ' · ' + n + ' px';
      host.appendChild(sw);
    }
    var meta = asset.palette.filter(function (x) { return x.a > 0; }).length + ' cores · ' +
      (state.result ? state.result.stats.colorsUsed : 0) + ' em uso';
    if (state.paletteMode === 'custom' && !PF.parsePalette(state.customPalette).length) {
      meta = 'hex vazio/inválido — usando PICO-8';
    }
    $('paletteMeta').textContent = meta;
  }

  function updateExportEnabled() {
    var on = !!state.result;
    ['exportPng', 'exportPng8', 'exportAseprite', 'exportGpl', 'exportJson', 'copyPalette', 'saveToLibrary'].forEach(function (id) {
      $(id).disabled = !on;
    });
  }

  /* ---------------------------------------------------------------- source */

  function setSource(image, name) {
    var maxDim = Math.max(image.width, image.height);
    if (maxDim > MAX_SOURCE) {
      var s = MAX_SOURCE / maxDim;
      image = PF.resample(image, Math.max(1, Math.round(image.width * s)), Math.max(1, Math.round(image.height * s)), 'box');
    }

    state.source = image;
    state.sourceName = name || 'imagem';
    state.extracted = null;
    if (state.paletteMode === 'extracted') state.paletteMode = 'pico8';
    buildPaletteSelect();

    var hasAlpha = false;
    for (var i = 3; i < image.data.length; i += 4) {
      if (image.data[i] < 250) { hasAlpha = true; break; }
    }

    if (!hasAlpha) {
      var c = dominantBorderColor(image);
      var hex = PF.rgbToHex(c);
      state.params.bgColor = hex;
      $('bgColor').value = hex;
      // fundo/parallax não tem sujeito pra recortar: nunca liga sozinho
      if (currentProfile().autoBg) state.params.removeBg = true;
    }

    $('bgRemove').checked = !!state.params.removeBg;

    $('fileName').textContent = state.sourceName + ' · ' + image.width + '×' + image.height;
    setEyedropper(false);
    syncBgOpts();
    recompute();
  }

  function decodeDataURLToImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        var d = ctx.getImageData(0, 0, c.width, c.height);
        resolve({ width: c.width, height: c.height, data: d.data });
      };
      img.onerror = function () { reject(new Error('imagem ilegível')); };
      img.src = url;
    });
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('leitura falhou')); };
      reader.readAsDataURL(file);
    });
  }

  function capSource(image) {
    var maxDim = Math.max(image.width, image.height);
    if (maxDim <= MAX_SOURCE) return image;
    var s = MAX_SOURCE / maxDim;
    return PF.resample(
      image,
      Math.max(1, Math.round(image.width * s)),
      Math.max(1, Math.round(image.height * s)),
      'box'
    );
  }

  function loadDataURL(url, name) {
    decodeDataURLToImage(url).then(function (image) {
      setSource(capSource(image), name);
    }).catch(function () {
      toast('Não consegui ler essa imagem.');
    });
  }

  /* 1 arquivo abre no editor; 2+ viram lote direto pra biblioteca. */
  function loadFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && /^image\//.test(f.type || '');
    });
    if (!list.length) { toast('Nenhuma imagem válida.'); return; }
    if (list.length === 1) {
      var one = list[0];
      readFileAsDataURL(one).then(function (url) {
        loadDataURL(url, one.name);
      }).catch(function () {
        toast('Não consegui ler essa imagem.');
      });
      return;
    }
    batchFiles(list);
  }

  function batchFiles(list) {
    var i = 0, ok = 0, fail = 0;

    function step() {
      if (i >= list.length) {
        toast(ok + (ok === 1 ? ' asset salvo' : ' assets salvos') + ' na biblioteca' +
          (fail ? ' · ' + fail + ' falharam' : '') + '.');
        PF.tabs.switchTab('library');
        return;
      }
      var file = list[i++];
      toast('Processando ' + i + '/' + list.length + '…');
      readFileAsDataURL(file)
        .then(function (url) { return decodeDataURLToImage(url); })
        .then(function (image) {
          PF.tabs.addItem(snapshotFor(capSource(image), file.name));
          ok++;
        })
        .catch(function (e) {
          fail++;
          console.warn('[pixel-forge] lote falhou em ' + file.name + ':', e);
        })
        .then(function () { setTimeout(step, 0); });
    }

    step();
  }

  /* ---------------------------------------------------------------- amostras */

  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function samplePotion() {
    var S = 512;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');

    var glow = g.createRadialGradient(S * 0.5, S * 0.6, 20, S * 0.5, S * 0.6, S * 0.44);
    glow.addColorStop(0, 'rgba(255,86,120,0.30)');
    glow.addColorStop(1, 'rgba(255,86,120,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, S, S);

    g.save();
    g.filter = 'blur(16px)';
    g.fillStyle = 'rgba(12,6,24,0.55)';
    g.beginPath();
    g.ellipse(S * 0.5, S * 0.9, S * 0.2, S * 0.04, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    var cx = S * 0.5, cy = S * 0.63, r = S * 0.2, nw = S * 0.062;

    var glass = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    glass.addColorStop(0, '#f6f9ff');
    glass.addColorStop(0.45, '#dbe4fb');
    glass.addColorStop(1, '#9fafd8');
    g.fillStyle = glass;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    rrect(g, cx - nw, cy - r * 1.95, nw * 2, r * 1.2, 16);
    g.fill();

    g.save();
    g.beginPath();
    g.arc(cx, cy, r - 9, 0, Math.PI * 2);
    g.clip();
    var liq = g.createLinearGradient(cx, cy - 10, cx, cy + r);
    liq.addColorStop(0, '#ff6a86');
    liq.addColorStop(0.5, '#c22052');
    liq.addColorStop(1, '#6d0b33');
    g.fillStyle = liq;
    g.beginPath();
    g.moveTo(cx - r, cy + 12);
    g.bezierCurveTo(cx - r * 0.35, cy - 26, cx + r * 0.35, cy - 4, cx + r, cy + 10);
    g.lineTo(cx + r, cy + r);
    g.lineTo(cx - r, cy + r);
    g.closePath();
    g.fill();

    g.fillStyle = 'rgba(255,255,255,0.30)';
    [[-0.42, 0.30, 9], [-0.10, 0.52, 6], [0.24, 0.34, 7], [0.40, 0.62, 5], [-0.28, 0.68, 4]]
      .forEach(function (b) {
        g.beginPath();
        g.arc(cx + r * b[0], cy + r * b[1], b[2], 0, Math.PI * 2);
        g.fill();
      });
    g.restore();

    g.save();
    g.globalAlpha = 0.7;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(cx - r * 0.46, cy - r * 0.36, 17, 40, -0.55, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    g.globalAlpha = 0.45;
    g.fillStyle = '#ffffff';
    rrect(g, cx - nw * 0.55, cy - r * 1.85, nw * 0.42, r * 0.9, 8);
    g.fill();
    g.restore();

    var cork = g.createLinearGradient(cx, cy - r * 2.4, cx, cy - r * 2.0);
    cork.addColorStop(0, '#d09a63');
    cork.addColorStop(1, '#8b5427');
    g.fillStyle = cork;
    rrect(g, cx - nw - 7, cy - r * 2.02 - 36, nw * 2 + 14, 40, 11);
    g.fill();

    g.strokeStyle = 'rgba(60,30,70,0.25)';
    g.lineWidth = 2;
    rrect(g, cx - nw - 7, cy - r * 2.02 - 36, nw * 2 + 14, 40, 11);
    g.stroke();

    return { image: toPFImage(c), name: 'exemplo-pocao' };
  }

  function sampleSlime() {
    var S = 512;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');

    g.fillStyle = '#dfe8f4';
    g.fillRect(0, 0, S, S);

    g.save();
    g.filter = 'blur(18px)';
    g.fillStyle = 'rgba(30,50,60,0.35)';
    g.beginPath();
    g.ellipse(S * 0.5, S * 0.79, S * 0.19, S * 0.035, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    var cx = S * 0.5;
    g.beginPath();
    g.moveTo(cx - S * 0.29, S * 0.77);
    g.bezierCurveTo(cx - S * 0.37, S * 0.59, cx - S * 0.30, S * 0.37, cx, S * 0.365);
    g.bezierCurveTo(cx + S * 0.30, S * 0.37, cx + S * 0.37, S * 0.59, cx + S * 0.29, S * 0.77);
    g.bezierCurveTo(cx + S * 0.16, S * 0.81, cx - S * 0.16, S * 0.81, cx - S * 0.29, S * 0.77);
    g.closePath();

    var body = g.createLinearGradient(cx, S * 0.36, cx, S * 0.8);
    body.addColorStop(0, '#b6f58a');
    body.addColorStop(0.45, '#6ede6f');
    body.addColorStop(1, '#2f9c55');
    g.fillStyle = body;
    g.fill();

    g.save();
    g.clip();
    var shade = g.createLinearGradient(cx, S * 0.62, cx, S * 0.82);
    shade.addColorStop(0, 'rgba(18,70,50,0)');
    shade.addColorStop(1, 'rgba(18,70,50,0.40)');
    g.fillStyle = shade;
    g.fillRect(0, S * 0.6, S, S * 0.25);
    g.restore();

    g.save();
    g.globalAlpha = 0.55;
    g.filter = 'blur(6px)';
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(cx - S * 0.12, S * 0.45, S * 0.055, S * 0.032, -0.35, 0, Math.PI * 2);
    g.fill();
    g.restore();

    [[-0.075, 0.53], [0.075, 0.53]].forEach(function (e) {
      g.fillStyle = '#f6fbff';
      g.beginPath();
      g.ellipse(cx + S * e[0], S * e[1], S * 0.048, S * 0.056, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#132029';
      g.beginPath();
      g.arc(cx + S * e[0] + 2, S * e[1] + 4, S * 0.022, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.arc(cx + S * e[0] + 12, S * e[1] - 8, S * 0.006, 0, Math.PI * 2);
      g.fill();
    });

    g.strokeStyle = '#16362c';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(cx, S * 0.60, S * 0.045, 0.35, Math.PI - 0.35);
    g.stroke();

    return { image: toPFImage(c), name: 'exemplo-slime' };
  }

  function toPFImage(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: d.data };
  }

  /* ---------------------------------------------------------------- export */

  function sizeTag() {
    return state.params.sizeW + 'x' + state.params.sizeH;
  }

  /* Um funil só: gera os bytes e entrega pelo download. */
  function runExport(opts) {
    toast('Gerando ' + opts.label + '…');
    Promise.resolve()
      .then(opts.build)
      .then(function (bytes) {
        var size = bytes && bytes.size != null ? bytes.size : (bytes ? bytes.length : 0);
        return saveBytes(bytes, opts.name, opts.mime).then(function () {
          toast(opts.label + ' salvo · ' + (size / 1024).toFixed(1) + ' KB');
        });
      })
      .catch(function (e) {
        console.error('[pixel-forge] export falhou:', e);
        toast('Falha ao exportar ' + opts.label + ': ' + (e && e.message ? e.message : e));
      });
  }

  function exportPNG(scale) {
    if (!state.result) return;
    var asset = state.result.asset;
    var tagged = scale > 1 ? PF.scaleNearest(asset, scale) : asset;
    runExport({
      label: 'PNG ' + (scale > 1 ? scale + '×' : '1×'),
      name: safeName() + '-' + sizeTag() + 'px' + (scale > 1 ? '@' + scale + 'x' : '') + '.png',
      mime: 'image/png',
      build: function () { return PF.encodePNG(tagged); }
    });
  }

  function exportAseprite() {
    if (!state.result) return;
    if (typeof PF.encodeAseprite !== 'function') {
      toast('O encoder .aseprite não carregou (src/aseprite.js).');
      return;
    }
    runExport({
      label: '.aseprite',
      name: safeName() + '-' + sizeTag() + 'px.aseprite',
      mime: 'application/octet-stream',
      build: function () {
        return PF.encodeAseprite(state.result.asset, {
          layerName: safeName(),
          colorDepth: 'rgba'
        });
      }
    });
  }

  function exportGPL() {
    if (!state.result) return;
    runExport({
      label: '.gpl',
      name: safeName() + '.gpl',
      mime: 'text/plain',
      build: function () {
        return new Blob([PF.toGPL(state.result.asset.palette, 'Pixel Forge — ' + safeName())], { type: 'text/plain' });
      }
    });
  }

  function exportJSON() {
    if (!state.result) return;
    runExport({
      label: 'manifesto',
      name: safeName() + '.asset.json',
      mime: 'application/json',
      build: function () {
        var r = state.result;
        var manifest = {
          generator: 'pixel-forge ' + PF.VERSION,
          created: new Date().toISOString(),
          source: state.sourceName,
          profile: state.profile,
          size: [r.asset.width, r.asset.height],
          pivot: PF.profilePivot(state.profile, r.asset.width, r.asset.height),
          parallax: state.profile === 'background'
            ? { scrollFactor: state.params.scrollFactor, tileX: true, tileY: false }
            : null,
          contract: state.contract,
          params: {
            resample: state.params.mode,
            fit: state.params.fit,
            align: state.params.align,
            margin: state.params.margin,
            autoCrop: state.params.autoCrop,
            removeBg: state.params.removeBg,
            bgColor: state.params.bgColor,
            bgTolerance: state.params.bgTolerance,
            alphaThreshold: state.params.alpha,
            dither: state.params.dither,
            ditherAmount: state.params.ditherAmount,
            outline: state.params.outline,
            outlineRadius: state.params.outlineRadius,
            outlineDiag: state.params.outlineDiag,
            orphanCleanup: state.params.orphanCleanup
          },
          palette: r.asset.palette.map(PF.rgbToHex),
          checks: r.checks,
          conform: r.ok,
          stats: {
            colorsUsed: r.stats.colorsUsed,
            coverage: +r.stats.coverage.toFixed(4),
            opaquePixels: r.stats.opaque,
            orphans: r.stats.orphans,
            bbox: r.stats.bbox
          }
        };
        return new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      }
    });
  }

  function copyPalette() {
    if (!state.result) return;
    var txt = state.result.asset.palette
      .filter(function (c) { return c.a > 0; })
      .map(PF.rgbToHex)
      .join(', ');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        toast('Cores copiadas.');
      }).catch(function () { fallbackCopy(txt); });
    } else {
      fallbackCopy(txt);
    }
  }

  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Cores copiadas.'); }
    catch (e) { toast('Não consegui copiar.'); }
    document.body.removeChild(ta);
  }

  /* ---------------------------------------------------------------- bind */

  function syncBgOpts() {
    $('bgOpts').classList.toggle('hidden', !state.params.removeBg);
    $('outlineOpts').classList.toggle('hidden', !state.params.outline);
    $('outlineColorRow').classList.toggle('hidden', state.params.outlineAuto !== false);
    $('ditherAmountWrap').classList.toggle('hidden', state.params.dither === 'none');
    $('customWrap').classList.toggle('hidden', state.paletteMode !== 'custom');
    $('parallaxOpts').classList.toggle('hidden', state.profile !== 'background');
    $('killBWOpts').classList.toggle('hidden', !state.params.removeBW);
  }

  function currentProfile() { return PF.profileGet(state.profile); }

  function setSquareSize(n, syncInput) {
    n = Math.max(4, Math.min(256, n | 0));
    state.params.sizeW = n;
    state.params.sizeH = n;
    if (syncInput !== false) $('sizeCustom').value = n;
    Array.prototype.forEach.call($('sizeSeg').children, function (b) {
      b.classList.toggle('active', parseInt(b.dataset.size, 10) === n);
    });
  }

  function setRectSize(w, h, syncInput) {
    w = Math.max(8, Math.min(1024, w | 0));
    h = Math.max(8, Math.min(1024, h | 0));
    state.params.sizeW = w;
    state.params.sizeH = h;
    if (syncInput !== false) { $('sizeW').value = w; $('sizeH').value = h; }
    syncBgPreset();
  }

  function syncBgPreset() {
    var w = state.params.sizeW, h = state.params.sizeH;
    var value = 'custom';
    currentProfile().sizes.forEach(function (s) {
      if (s[0] === w && s[1] === h) value = s[0] + 'x' + s[1];
    });
    $('bgPreset').value = value;
  }

  function renderProfiles() {
    var host = $('profiles');
    if (!host.children.length) {
      PROFILE_LIST.forEach(function (p) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'profile';
        b.dataset.id = p.id;
        var name = document.createElement('span');
        name.className = 'p-name';
        name.textContent = p.name;
        var hint = document.createElement('span');
        hint.className = 'p-hint';
        hint.textContent = p.hint;
        b.appendChild(name);
        b.appendChild(hint);
        b.addEventListener('click', function () { applyProfile(p.id); });
        host.appendChild(b);
      });
    }
    Array.prototype.forEach.call(host.children, function (b) {
      b.classList.toggle('active', b.dataset.id === state.profile);
    });
  }

  function renderProfileNote() {
    var rules = state.contract.rules || [];
    var pivot = PF.profilePivot(state.profile, state.params.sizeW, state.params.sizeH);
    var bits = [pivot ? 'pivô (' + pivot.x + ', ' + pivot.y + ')' : 'sem pivô'];
    if (rules.length) bits.push(rules.length + ' regra(s) extra(s)');
    $('profileNote').textContent = bits.join(' · ');
  }

  function applyProfile(id) {
    var keepBg = state.params.bgColor;
    state.profile = id;
    state.params = PF.profileParams(id);
    state.params.bgColor = keepBg || '#ffffff';
    state.contract = PF.profileContract(id);
    state.paletteMode = state.params.palette || 'pico8';
    if (!PALETTES[state.paletteMode]) state.paletteMode = 'pico8';
    state.extractMode = state.params.extractMode || 'dominant';
    buildPaletteSelect();
    syncControls();
    if (state.source) recompute();
    if (id === 'background' && state.source) {
      $('extractCount').value = 32;
      setTimeout(function () {
        toast('Fundo: extraia 32–48 cores da imagem para preservar os gradientes.');
      }, 400);
    }
  }

  function restoreProject(settings) {
    applyProfile(settings.profile);
    state.contract = JSON.parse(JSON.stringify(settings.contract));
    syncControls();
    recompute();
  }

  function syncControls() {
    var p = state.params;
    var prof = currentProfile();

    renderProfiles();

    $('sizeSquare').classList.toggle('hidden', prof.sizeMode !== 'square');
    $('sizeRect').classList.toggle('hidden', prof.sizeMode !== 'rect');
    if (prof.sizeMode === 'square') {
      setSquareSize(p.sizeW, true);
    } else {
      $('sizeW').value = p.sizeW;
      $('sizeH').value = p.sizeH;
      syncBgPreset();
    }

    $('resampleMode').value = p.mode;
    $('fitMode').value = p.fit;
    $('autoCrop').checked = !!p.autoCrop;

    $('bgRemove').checked = !!p.removeBg;
    $('bgColor').value = p.bgColor || '#ffffff';
    $('bgTol').value = p.bgTolerance;
    $('bgTolVal').textContent = p.bgTolerance;

    $('alphaThresh').value = p.alpha;
    $('alphaVal').textContent = p.alpha;
    $('ditherMode').value = p.dither;
    $('ditherAmount').value = p.ditherAmount;
    $('ditherVal').textContent = p.ditherAmount + '%';
    $('outlineOn').checked = !!p.outline;
    $('silhouette').value = p.silhouette || 'off';
    $('outlineWidth').value = p.outlineRadius || 1;
    $('outlineAuto').checked = p.outlineAuto !== false;
    $('outlineColor').value = p.outlineColor || '#101018';
    $('outlineDiag').checked = !!p.outlineDiag;
    $('outlineInner').checked = !!p.outlineInner;
    $('orphanCleanup').checked = !!p.orphanCleanup;
    $('killBW').checked = !!p.removeBW;
    $('killBWTol').value = p.bwTolerance == null ? 12 : p.bwTolerance;
    $('killBWVal').textContent = p.bwTolerance == null ? 12 : p.bwTolerance;

    $('scrollFactor').value = p.scrollFactor == null ? 1 : p.scrollFactor;
    $('scrollVal').textContent = Number(p.scrollFactor == null ? 1 : p.scrollFactor).toFixed(2);

    $('contractColors').value = state.contract.maxColors;
    $('contractDistance').value = state.contract.minDistance;
    $('contractOrphans').value = state.contract.maxOrphans;
    $('contractOutline').checked = !!state.contract.requireOutline;
    $('contractMargin').checked = !!state.contract.requireMargin;

    $('palettePreset').value = state.paletteMode;
    $('extractMode').value = state.extractMode;

    syncBgOpts();
    renderProfileNote();
  }

  function bind() {
    $('fileInput').addEventListener('change', function (e) {
      if (e.target.files && e.target.files.length) loadFiles(e.target.files);
    });

    var dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();                     // evita carregar duas vezes
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
    });

    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
    });

    window.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          loadFiles([items[i].getAsFile()]);
          e.preventDefault();
          return;
        }
      }
    });

    $('samplePotion').addEventListener('click', function () {
      var s = samplePotion();
      setSource(s.image, s.name);
    });
    $('sampleSlime').addEventListener('click', function () {
      var s = sampleSlime();
      setSource(s.image, s.name);
    });

    $('bgRemove').addEventListener('change', function (e) {
      state.params.removeBg = e.target.checked;
      syncBgOpts();
      schedule();
    });
    $('bgColor').addEventListener('input', function (e) {
      state.params.bgColor = e.target.value;
      schedule();
    });
    $('bgTol').addEventListener('input', function (e) {
      state.params.bgTolerance = parseInt(e.target.value, 10);
      $('bgTolVal').textContent = e.target.value;
      schedule();
    });

    Array.prototype.forEach.call($('sizeSeg').children, function (b) {
      b.addEventListener('click', function () {
        setSquareSize(parseInt(b.dataset.size, 10));
        schedule();
      });
    });
    $('sizeCustom').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!isFinite(v) || v < 1) return;      // deixa o campo livre enquanto digita
      setSquareSize(Math.min(256, v), false);
      schedule();
    });
    $('sizeCustom').addEventListener('blur', function () {
      setSquareSize(state.params.sizeW, true); // normaliza só ao sair do campo
    });

    $('bgPreset').addEventListener('change', function (e) {
      var v = e.target.value;
      if (v === 'custom') { $('sizeW').focus(); return; }
      var parts = v.split('x');
      setRectSize(parseInt(parts[0], 10), parseInt(parts[1], 10), true);
      renderProfileNote();
      schedule();
    });
    $('sizeW').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!isFinite(v) || v < 1) return;
      state.params.sizeW = Math.max(8, Math.min(1024, v));
      syncBgPreset();
      renderProfileNote();
      schedule();
    });
    $('sizeH').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!isFinite(v) || v < 1) return;
      state.params.sizeH = Math.max(8, Math.min(1024, v));
      syncBgPreset();
      renderProfileNote();
      schedule();
    });

    $('fitMode').addEventListener('change', function (e) {
      state.params.fit = e.target.value;
      schedule();
    });
    $('resampleMode').addEventListener('change', function (e) {
      state.params.mode = e.target.value;
      schedule();
    });
    $('autoCrop').addEventListener('change', function (e) {
      state.params.autoCrop = e.target.checked;
      schedule();
    });

    $('palettePreset').addEventListener('change', function (e) {
      state.paletteMode = e.target.value;
      syncBgOpts();
      schedule();
    });
    $('paletteCustom').addEventListener('input', function (e) {
      state.customPalette = e.target.value;
      state.paletteMode = 'custom';
      $('palettePreset').value = 'custom';
      syncBgOpts();
      schedule();
    });
    $('extractMode').addEventListener('change', function (e) {
      state.extractMode = e.target.value;
    });
    $('pickColor').addEventListener('click', function () {
      if (!state.prepared) { toast('Carregue uma imagem primeiro.'); return; }
      setEyedropper(!state.eyedropper);
      if (state.eyedropper) toast('Clique na metade original para preservar uma cor.');
    });
    $('srcCanvas').addEventListener('pointerdown', function (e) {
      if (!state.eyedropper) return;
      e.preventDefault();
      e.stopPropagation();
      pickSourceColor(e);
    });
    $('extractBtn').addEventListener('click', function () {
      var prep = prepare();
      if (!prep) { toast('Carregue uma imagem primeiro.'); return; }
      var n = Math.max(2, Math.min(64, parseInt($('extractCount').value, 10) || 12));
      var cols = PF.extractPalette(prep, n, state.extractMode);
      if (!cols.length) { toast('Não encontrei pixels opacos.'); return; }
      state.extracted = cols;
      state.paletteMode = 'extracted';
      buildPaletteSelect();
      $('palettePreset').value = 'extracted';
      syncBgOpts();
      recompute();
      toast(cols.length + ' cores extraídas · ' +
        (state.extractMode === 'spread' ? 'distribuída' : 'dominante') + '.');
    });

    $('ditherMode').addEventListener('change', function (e) {
      state.params.dither = e.target.value;
      syncBgOpts();
      schedule();
    });
    $('ditherAmount').addEventListener('input', function (e) {
      state.params.ditherAmount = parseInt(e.target.value, 10);
      $('ditherVal').textContent = e.target.value + '%';
      schedule();
    });
    $('alphaThresh').addEventListener('input', function (e) {
      state.params.alpha = parseInt(e.target.value, 10);
      $('alphaVal').textContent = e.target.value;
      schedule();
    });

    $('outlineOn').addEventListener('change', function (e) {
      state.params.outline = e.target.checked;
      syncBgOpts();
      schedule();
    });
    $('silhouette').addEventListener('change', function (e) {
      state.params.silhouette = e.target.value;
      schedule();
    });
    $('outlineWidth').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!isFinite(v) || v < 1) return;
      state.params.outlineRadius = Math.max(1, Math.min(8, v));
      schedule();
    });
    $('outlineAuto').addEventListener('change', function (e) {
      state.params.outlineAuto = e.target.checked;
      syncBgOpts();
      schedule();
    });
    $('outlineColor').addEventListener('input', function (e) {
      state.params.outlineColor = e.target.value;
      state.params.outlineAuto = false;
      $('outlineAuto').checked = false;
      syncBgOpts();
      schedule();
    });
    $('outlineDiag').addEventListener('change', function (e) {
      state.params.outlineDiag = e.target.checked;
      schedule();
    });
    $('outlineInner').addEventListener('change', function (e) {
      state.params.outlineInner = e.target.checked;
      schedule();
    });
    $('orphanCleanup').addEventListener('change', function (e) {
      state.params.orphanCleanup = e.target.checked;
      schedule();
    });
    $('killBW').addEventListener('change', function (e) {
      state.params.removeBW = e.target.checked;
      syncBgOpts();
      schedule();
    });
    $('killBWTol').addEventListener('input', function (e) {
      state.params.bwTolerance = parseInt(e.target.value, 10);
      $('killBWVal').textContent = e.target.value;
      schedule();
    });
    $('scrollFactor').addEventListener('input', function (e) {
      state.params.scrollFactor = parseFloat(e.target.value);
      $('scrollVal').textContent = Number(state.params.scrollFactor).toFixed(2);
      schedule();
    });

    $('contractColors').addEventListener('input', function (e) {
      state.contract.maxColors = Math.max(1, parseInt(e.target.value, 10) || 1);
      schedule();
    });
    $('contractDistance').addEventListener('input', function (e) {
      state.contract.minDistance = Math.max(0, parseInt(e.target.value, 10) || 0);
      schedule();
    });
    $('contractOrphans').addEventListener('input', function (e) {
      state.contract.maxOrphans = Math.max(0, parseInt(e.target.value, 10) || 0);
      schedule();
    });
    $('contractOutline').addEventListener('change', function (e) {
      state.contract.requireOutline = e.target.checked;
      schedule();
    });
    $('contractMargin').addEventListener('change', function (e) {
      state.contract.requireMargin = e.target.checked;
      schedule();
    });

    $('zoomIn').addEventListener('click', function () {
      state.zoom = Math.min(24, (state.appliedZoom || 1) + 1);
      applyZoom();
    });
    $('zoomOut').addEventListener('click', function () {
      state.zoom = Math.max(1, (state.appliedZoom || 1) - 1);
      applyZoom();
    });
    $('zoomFit').addEventListener('click', function () {
      state.zoom = 'fit';
      applyZoom();
    });

    // roda do mouse = zoom no preview (não mexe na rolagem dos painéis)
    $('canvasWrap').addEventListener('wheel', function (e) {
      if (!state.result) return;
      e.preventDefault();
      var dir = e.deltaY > 0 ? -1 : 1;
      state.zoom = Math.max(1, Math.min(24, (state.appliedZoom || 1) + dir));
      applyZoom();
    }, { passive: false });
    $('gridToggle').addEventListener('click', function () {
      state.showGrid = !state.showGrid;
      $('gridToggle').classList.toggle('active', state.showGrid);
      applyZoom();
    });
    $('compareToggle').addEventListener('click', function () {
      setCompare(!state.compare);
    });

    var wrap = $('canvasWrap');
    var dragging = false;
    function fromEvent(e) {
      var rect = wrap.getBoundingClientRect();
      setSplit((e.clientX - rect.left) / rect.width);
    }
    wrap.addEventListener('pointerdown', function (e) {
      dragging = true;
      try { wrap.setPointerCapture(e.pointerId); } catch (_) { }
      fromEvent(e);
    });
    wrap.addEventListener('pointermove', function (e) {
      if (dragging) fromEvent(e);
    });
    wrap.addEventListener('pointerup', function () { dragging = false; });
    wrap.addEventListener('pointercancel', function () { dragging = false; });

    $('exportPng').addEventListener('click', function () { exportPNG(1); });
    $('exportPng8').addEventListener('click', function () { exportPNG(8); });
    $('exportAseprite').addEventListener('click', exportAseprite);
    $('exportGpl').addEventListener('click', exportGPL);
    $('saveToLibrary').addEventListener('click', saveToLibrary);
    $('saveBarClose').addEventListener('click', hideSaveBar);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.eyedropper) setEyedropper(false);
    });
    $('exportJson').addEventListener('click', exportJSON);
    $('copyPalette').addEventListener('click', copyPalette);

    window.addEventListener('resize', function () {
      clearTimeout(window.__pfResize);
      window.__pfResize = setTimeout(function () {
        if (state.result) applyZoom();
      }, 120);
    });
  }

  /* ---------------------------------------------------------------- start */

  function init() {
    // qualquer falha silenciosa vira aviso visível
    window.addEventListener('error', function (e) {
      toast('Erro: ' + (e.message || 'desconhecido'));
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e.reason;
      toast('Erro: ' + (r && r.message ? r.message : String(r)));
    });

    buildPaletteSelect();
    bind();
    renderProfiles();
    syncControls();

    PF.tabs.init({
      store: STORE,
      toast: toast,
      download: download,
      saveBytes: saveBytes,
      loadIntoEditor: loadItem,
      getProfile: function () { return state.profile; },
      getEditor: function () { return state.result ? { asset: state.result.asset, name: safeName() } : null; },
      getContract: function () { return state.contract; },
      restoreProject: restoreProject
    });

    $('gridToggle').classList.add('active');
    $('compareToggle').classList.add('active');

    // dentro de iframe/pré-visualização o navegador costuma bloquear download
    var inFrame = false;
    try { inFrame = window.top !== window.self; } catch (e) { inFrame = true; }
    if (inFrame) {
      setTimeout(function () {
        toast('Abra o index.html direto no navegador: em pré-visualização o download pode ser bloqueado.');
      }, 1200);
    }

    var wrap = $('canvasWrap');
    var bl = document.createElement('span');
    bl.className = 'compare-badge left';
    bl.id = 'badgeL';
    bl.textContent = 'ORIGINAL';
    var br = document.createElement('span');
    br.className = 'compare-badge right';
    br.id = 'badgeR';
    br.textContent = 'RESULTADO';
    wrap.appendChild(bl);
    wrap.appendChild(br);

    setCompare(true);
    updateExportEnabled();

    $('fileName').textContent = 'nenhuma imagem';
    setTimeout(function () { $('stageBody').focus(); }, 0);

    // atalho de demonstração: index.html?demo=pocao | ?demo=slime
    try {
      var qp = new URLSearchParams(window.location.search);
      var demo = qp.get('demo') || qp.get('sample');
      if (demo) {
        setTimeout(function () {
          var s = demo === 'slime' ? sampleSlime() : samplePotion();
          setSource(s.image, s.name);
        }, 0);
      }
    } catch (_) { /* sem URLSearchParams: ignora */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
