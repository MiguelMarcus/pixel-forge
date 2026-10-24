/*
 * Abas Biblioteca e Folha.
 *
 * A biblioteca guarda a receita (fonte + params + contrato) e re-deriva o
 * sprite quando precisa. A folha monta por cima do resultado e valida o
 * conjunto — não por sprite.
 */
(function (root) {
  'use strict';

  var PF = root.PF;
  var $ = function (id) { return document.getElementById(id); };

  var deps = null;
  var items = [];
  var sheet = {
    mode: 'grid', width: 512, height: 512, cell: 32, baseline: 480,
    snap: true, placements: [], filter: { preset: 'none', brightness: 0, contrast: 0, normalize: 'off' }
  };
  var savedSheets = [];
  var currentSavedSheetId = null;
  var selected = null;
  var activeAssetId = null;
  var sheetZoom = 'fit';
  var appliedZoom = 1;
  var drag = null;
  var pendingTimer = null;
  var dirty = false;   // mudou desde o último .pfset salvo/aberto
  var storageFailed = false;
  var pendingWrites = [];
  var projectLoading = false;
  var anchorId = null; // sprite aprovado que serve de referência de estilo

  var shadow = {
    assetId: null, shape: 'ellipse', widthScale: 1, squash: 0.35,
    offsetX: 0, offsetY: 0, color: '#000000', opacity: 45, pad: 8
  };
  var shadowZoom = 'fit';
  var shadowAppliedZoom = 1;
  var shadowSaveTimer = null;

  /* ---------------------------------------------------------------- utils */

  function toast(msg) { if (deps && deps.toast) deps.toast(msg); }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function markDirty() {
    if (!deps) return;
    dirty = true;
    renderLibrary();
  }

  function prepareEditor(record) {
    if (!record) return Promise.resolve(null);
    return decodeDataURL(record.source).then(function (image) {
      var item = { name: record.name, profile: record.profile, params: record.params,
        contract: record.contract, source: image, sourceDataUrl: record.source };
      item.result = computeResult(item);
      return item;
    });
  }

  function persist(promise) {
    var tracked = promise.catch(function (e) {
      storageFailed = true;
      dirty = true;
      renderLibrary();
      toast('Falha ao gravar no navegador. Salve o .pfset: ' + e.message);
      return false;
    });
    pendingWrites.push(tracked);
    tracked.then(function () { pendingWrites = pendingWrites.filter(function (p) { return p !== tracked; }); });
    return tracked;
  }

  function findItem(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function hexToObj(hex) {
    return PF.hexToRgb(hex) || { r: 255, g: 255, b: 255 };
  }

  /* ---------------------------------------------------------------- receita */

  function computeResult(item) {
    var p = item.params;
    return PF.conform(item.source, {
      targetW: p.sizeW,
      targetH: p.sizeH,
      margin: (p.outline && !p.outlineInner)
        ? Math.max(p.margin || 0, Math.min(8, p.outlineRadius || 1))
        : (p.margin || 0),
      mode: p.mode,
      fit: p.fit,
      align: p.align,
      doAutoCrop: !!p.autoCrop,
      removeBg: !!p.removeBg,
      bgColor: hexToObj(p.bgColor || '#ffffff'),
      bgTolerance: p.bgTolerance == null ? 32 : p.bgTolerance,
      alphaThreshold: p.alpha,
      removeBlackWhite: !!p.removeBW,
      bwTolerance: p.bwTolerance == null ? 12 : p.bwTolerance,
      palette: PF.paletteFromHexList(p.palette),
      dither: p.dither,
      ditherAmount: (p.ditherAmount || 0) / 100,
      silhouette: p.silhouette || 'off',
      outline: !!p.outline,
      outlineRadius: p.outlineRadius || 1,
      outlineDiag: !!p.outlineDiag,
      outlineInner: !!p.outlineInner,
      outlineColor: p.outlineAuto === false ? p.outlineColor : null,
      orphanCleanup: !!p.orphanCleanup,
      contract: item.contract
    });
  }

  function serialize(item) {
    return {
      id: item.id,
      name: item.name,
      profile: item.profile,
      params: item.params,
      contract: item.contract,
      source: item.sourceDataUrl,
      createdAt: item.createdAt
    };
  }

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

  function decodeDataURL(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth > 8192 || img.naturalHeight > 8192 || img.naturalWidth * img.naturalHeight > 16777216) {
            throw new Error('imagem excede o limite de 16 megapixels ou 8192 px por lado');
          }
          var c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          var d = ctx.getImageData(0, 0, c.width, c.height);
          resolve({ width: c.width, height: c.height, data: d.data });
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /* canvas nativo por item, usado pra desenhar a folha sem recompor */
  function assetCanvas(item) {
    if (item._canvas && item._canvasVersion === item._version) return item._canvas;
    var a = item.result.asset;
    var c = document.createElement('canvas');
    c.width = a.width;
    c.height = a.height;
    var ctx = c.getContext('2d');
    var rgba = PF.toRGBA(a);
    var id = ctx.createImageData(a.width, a.height);
    id.data.set(rgba.data);
    ctx.putImageData(id, 0, 0);
    item._canvas = c;
    item._canvasVersion = item._version;
    return c;
  }

  function thumbURL(item) {
    if (item._thumb && item._thumbVersion === item._version) return item._thumb;
    var a = item.result.asset;
    var c = document.createElement('canvas');
    c.width = a.width;
    c.height = a.height;
    var ctx = c.getContext('2d');
    var rgba = PF.toRGBA(a);
    var id = ctx.createImageData(a.width, a.height);
    id.data.set(rgba.data);
    ctx.putImageData(id, 0, 0);
    item._thumb = c.toDataURL('image/png');
    item._thumbVersion = item._version;
    return item._thumb;
  }

  /* ---------------------------------------------------------------- abas */

  function switchTab(name) {
    var layout = $('tab-sprite') && $('tab-sprite').querySelector('.layout');
    if (name === 'treatment') {
      $('tab-sprite').classList.remove('hidden');
      if (layout) layout.classList.add('treatment-active');
      $('tab-treatment').classList.remove('hidden');
      ['library', 'sheet', 'shadow', 'lighting'].forEach(function (t) { $('tab-' + t).classList.add('hidden'); });
    } else {
      if (layout) layout.classList.remove('treatment-active');
      ['sprite', 'library', 'sheet', 'shadow', 'lighting', 'treatment'].forEach(function (t) {
      var el = $('tab-' + t);
      if (el) el.classList.toggle('hidden', t !== name);
      });
    }
    Array.prototype.forEach.call($('tabs').children, function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    if (name === 'sheet') {
      renderSheet();
      validateNow();
    }
    if (name === 'shadow') renderShadowTab();
    if (name === 'lighting') PF.lightingTab.render();
    if (name === 'treatment' && PF.treatmentTab) PF.treatmentTab.render();
  }

  /* ---------------------------------------------------------------- biblioteca */

  function itemPush(data) {
    var item = {
      id: PF.library.newId(),
      name: data.name || 'sprite',
      profile: data.profile,
      params: clone(data.params),
      contract: clone(data.contract),
      source: data.source,
      sourceDataUrl: data.sourceDataUrl || imageToDataURL(data.source),
      createdAt: new Date().toISOString(),
      _version: 1
    };
    item.result = computeResult(item);
    items.push(item);
    dirty = true;
    persist(deps.store.put(serialize(item)));
    renderAll();
    return item;
  }

  function itemRemove(id) {
    items = items.filter(function (it) { return it.id !== id; });
    sheet.placements = sheet.placements.filter(function (p) { return p.assetId !== id; });
    selected = null;
    dirty = true;
    if (anchorId === id) { anchorId = null; persist(deps.store.putMeta('anchor', null)); }
    persist(deps.store.remove(id));
    renderAll();
    saveSheet();
  }

  function itemRecompute(item) {
    item._version++;
    item.result = computeResult(item);
    dirty = true;
    persist(deps.store.put(serialize(item)));
  }

  function itemDuplicate(id) {
    var src = findItem(id);
    if (!src) return;
    var copy = {
      id: PF.library.newId(),
      name: src.name + '-2',
      profile: src.profile,
      params: clone(src.params),
      contract: clone(src.contract),
      source: src.source,
      sourceDataUrl: src.sourceDataUrl,
      createdAt: new Date().toISOString(),
      _version: 1
    };
    copy.result = computeResult(copy);
    items.push(copy);
    dirty = true;
    persist(deps.store.put(serialize(copy)));
    renderAll();
    toast('Variante criada: ' + copy.name + '.');
  }

  function renderLibrary() {
    var grid = $('libGrid');
    grid.innerHTML = '';
    $('libEmpty').classList.toggle('hidden', items.length > 0);

    if (anchorId && !findItem(anchorId)) anchorId = null;
    var anchorItem = anchorId ? findItem(anchorId) : null;

    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'lib-card';
      card.dataset.id = item.id;

      var thumb = document.createElement('div');
      thumb.className = 'lib-thumb';
      var img = document.createElement('img');
      img.src = thumbURL(item);
      img.alt = item.name;
      thumb.appendChild(img);

      var name = document.createElement('div');
      name.className = 'lib-name';
      name.textContent = item.name;
      name.title = item.name;

      var meta = document.createElement('div');
      meta.className = 'lib-meta';
      var dims = document.createElement('span');
      dims.textContent = item.result.asset.width + '×' + item.result.asset.height;
      var status = document.createElement('span');
      status.className = item.result.ok ? 'ok' : 'bad';
      status.textContent = item.result.ok ? 'conforme' : 'falha';
      meta.appendChild(dims);
      meta.appendChild(status);

      var badge = null;
      if (anchorItem && anchorItem.id !== item.id && anchorItem.result && item.result &&
        anchorItem.profile === item.profile && PF.scorePair) {
        var sc = PF.scorePair(anchorItem.result.asset, item.result.asset);
        if (sc) {
          badge = document.createElement('div');
          badge.className = 'lib-score ' + (sc.score >= 85 ? 'good' : (sc.score >= 70 ? 'mid' : 'bad'));
          badge.textContent = sc.score + ' · ' + sc.verdict;
          badge.title = 'pior eixo: ' + sc.worst.label;
        }
      }

      var row1 = document.createElement('div');
      row1.className = 'row';
      var bOpen = document.createElement('button');
      bOpen.type = 'button';
      bOpen.className = 'btn ghost';
      bOpen.textContent = 'abrir';
      bOpen.addEventListener('click', function () { deps.loadIntoEditor(item); });
      var bAdd = document.createElement('button');
      bAdd.type = 'button';
      bAdd.className = 'btn ghost';
      bAdd.textContent = 'folha';
      bAdd.addEventListener('click', function () { placeAsset(item.id); });
      row1.appendChild(bOpen);
      row1.appendChild(bAdd);

      var row2 = document.createElement('div');
      row2.className = 'row';
      var bAnchor = document.createElement('button');
      bAnchor.type = 'button';
      bAnchor.className = 'btn ghost' + (anchorId === item.id ? ' active' : '');
      bAnchor.textContent = anchorId === item.id ? 'âncora ✓' : 'âncora';
      bAnchor.title = 'referência de estilo para os outros sprites';
      bAnchor.addEventListener('click', function () { setAnchor(item.id); });
      var bDup = document.createElement('button');
      bDup.type = 'button';
      bDup.className = 'btn ghost';
      bDup.textContent = 'dup';
      bDup.title = 'duplicar como variante (para testar outro tamanho ou paleta)';
      bDup.addEventListener('click', function () { itemDuplicate(item.id); });
      var bDel = document.createElement('button');
      bDel.type = 'button';
      bDel.className = 'btn ghost';
      bDel.textContent = 'excluir';
      bDel.addEventListener('click', function () { itemRemove(item.id); });
      row2.appendChild(bAnchor);
      row2.appendChild(bDup);
      row2.appendChild(bDel);

      card.appendChild(thumb);
      card.appendChild(name);
      card.appendChild(meta);
      if (badge) card.appendChild(badge);
      card.appendChild(row1);
      card.appendChild(row2);
      grid.appendChild(card);
    });

    $('libCount').textContent = String(items.length);
    $('libTotal').textContent = items.length + (items.length === 1 ? ' asset' : ' assets') +
      ' · ' + (storageFailed ? 'falha de gravação — salve o .pfset'
        : (deps.store.kind() === 'indexeddb' ? 'armazenamento no navegador' : 'memória — salve o .pfset')) +
      (dirty ? ' · não salvo' : '') +
      (anchorItem ? ' · âncora: ' + anchorItem.name : '');
    $('projNote').textContent = items.length + (items.length === 1 ? ' asset salvo' : ' assets salvos');
    renderSavedSheets();
  }

  function sheetThumb(record) {
    var previous = sheet;
    try {
      sheet = record.sheet;
      var composed = PF.composeSheet(sheet.width, sheet.height, resolvePlacements());
      var c = document.createElement('canvas'); c.width = composed.width; c.height = composed.height;
      var ctx = c.getContext('2d'), image = ctx.createImageData(c.width, c.height), rgba = PF.toRGBA(composed);
      image.data.set(rgba.data); ctx.putImageData(image, 0, 0);
      return c.toDataURL('image/png');
    } catch (e) { return ''; } finally { sheet = previous; }
  }

  function persistSavedSheets() {
    dirty = true;
    persist(deps.store.putMeta('savedSheets', clone(savedSheets)));
  }

  function openSavedSheet(id) {
    var found = savedSheets.filter(function (entry) { return entry.id === id; })[0];
    if (!found) return;
    sheet = clone(found.sheet);
    currentSavedSheetId = found.id;
    sheet.placements = sheet.placements.filter(function (p) { return !!findItem(p.assetId); });
    selected = null;
    applySheetControls();
    saveSheet();
    switchTab('sheet');
    toast('Folha “' + found.name + '” aberta.');
  }

  function renderSavedSheets() {
    var grid = $('savedSheetsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    $('savedSheetsEmpty').classList.toggle('hidden', savedSheets.length > 0);
    $('savedSheetsTotal').textContent = savedSheets.length + (savedSheets.length === 1 ? ' folha' : ' folhas');
    savedSheets.forEach(function (entry) {
      var card = document.createElement('div'); card.className = 'saved-sheet-card';
      var img = document.createElement('img'); img.alt = 'Miniatura da folha ' + entry.name; img.src = sheetThumb(entry);
      var name = document.createElement('div'); name.className = 'lib-name'; name.textContent = entry.name; name.title = entry.name;
      var meta = document.createElement('div'); meta.className = 'lib-meta'; meta.textContent = entry.sheet.width + '×' + entry.sheet.height + ' · ' + entry.sheet.placements.length + ' sprites';
      var row = document.createElement('div'); row.className = 'row';
      var open = document.createElement('button'); open.type = 'button'; open.className = 'btn ghost'; open.textContent = 'abrir'; open.addEventListener('click', function () { openSavedSheet(entry.id); });
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn ghost'; remove.textContent = 'excluir'; remove.addEventListener('click', function () { savedSheets = savedSheets.filter(function (x) { return x.id !== entry.id; }); if (currentSavedSheetId === entry.id) currentSavedSheetId = null; persistSavedSheets(); renderLibrary(); applySheetSaveLabel(); });
      row.appendChild(open); row.appendChild(remove); card.appendChild(img); card.appendChild(name); card.appendChild(meta); card.appendChild(row); grid.appendChild(card);
    });
  }

  function saveCurrentSheet() {
    var out = validateNow();
    if (!out || !out.list.length) { toast('Adicione ao menos um sprite antes de salvar a folha.'); return; }
    var existing = currentSavedSheetId && savedSheets.filter(function (entry) { return entry.id === currentSavedSheetId; })[0];
    if (existing) {
      existing.sheet = clone(sheet);
      existing.updatedAt = new Date().toISOString();
      persistSavedSheets();
      renderLibrary();
      applySheetSaveLabel();
      toast('Folha “' + existing.name + '” atualizada na Biblioteca.');
      return;
    }
    var suggested = baseName();
    var name = typeof window.prompt === 'function' ? window.prompt('Nome da folha', suggested) : suggested;
    if (name === null) return;
    name = String(name || suggested).trim() || suggested;
    var entry = { id: PF.library.newId(), name: name, savedAt: new Date().toISOString(), sheet: clone(sheet) };
    savedSheets.push(entry);
    currentSavedSheetId = entry.id;
    persistSavedSheets();
    renderLibrary();
    toast('Folha salva na Biblioteca.');
  }

  function applySheetSaveLabel() {
    var button = $('sheetSaveLibrary');
    if (!button) return;
    var entry = currentSavedSheetId && savedSheets.filter(function (item) { return item.id === currentSavedSheetId; })[0];
    button.textContent = entry ? 'Salvar alterações' : 'Salvar na biblioteca';
    button.title = entry ? 'Atualiza a folha “' + entry.name + '” já aberta' : 'Cria uma nova folha na Biblioteca';
  }

  function setAnchor(id) {
    anchorId = anchorId === id ? null : id;
    dirty = true;
    if (deps) persist(deps.store.putMeta('anchor', anchorId));
    renderAll();
    toast(anchorId ? 'Âncora definida.' : 'Âncora removida.');
  }

  /* ---------------------------------------------------------------- folha */

  function resolvePlacements() {
    var out = [];
    for (var i = 0; i < sheet.placements.length; i++) {
      var p = sheet.placements[i];
      var it = findItem(p.assetId);
      if (!it || !it.result) continue;
      out.push({ asset: it.result.asset, x: p.x, y: p.y, assetId: p.assetId, name: it.name });
    }
    return out;
  }

  function firstFreeCell(w, h) {
    var cols = Math.max(1, Math.floor(sheet.width / sheet.cell));
    var rows = Math.max(1, Math.floor(sheet.height / sheet.cell));
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = c * sheet.cell, y = r * sheet.cell;
        if (x + w > sheet.width || y + h > sheet.height) continue;
        var free = true;
        for (var i = 0; i < sheet.placements.length; i++) {
          var p = sheet.placements[i];
          var it = findItem(p.assetId);
          var aw = it ? it.result.asset.width : sheet.cell;
          var ah = it ? it.result.asset.height : sheet.cell;
          if (x < p.x + aw && p.x < x + w && y < p.y + ah && p.y < y + h) { free = false; break; }
        }
        if (free) return { x: x, y: y };
      }
    }
    return null;
  }

  function placeAsset(id) {
    var it = findItem(id);
    if (!it) return;
    if (it.result.asset.width > sheet.width || it.result.asset.height > sheet.height) {
      toast('O sprite é maior que a folha. Aumente a folha ou reconforme o asset.'); return;
    }
    var pos;
    if (sheet.mode === 'grid') {
      pos = firstFreeCell(it.result.asset.width, it.result.asset.height);
      if (!pos) { toast('A folha está cheia. Aumente as dimensões ou remova um sprite.'); return; }
    } else {
      pos = {
        x: Math.round((sheet.width - it.result.asset.width) / 2),
        y: Math.max(0, sheet.baseline - it.result.asset.height)
      };
    }
    sheet.placements.push({ assetId: id, x: pos.x, y: pos.y });
    selected = sheet.placements.length - 1;
    renderAll();
    saveSheet();
  }

  function clamped(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function sheetFilter() {
    if (!sheet.filter) sheet.filter = { preset: 'none', brightness: 0, contrast: 0, normalize: 'off' };
    if (!sheet.filter.normalize) sheet.filter.normalize = 'off';
    return sheet.filter;
  }

  function filteredColor(c) {
    if (!c || c.a === 0) return c;
    var f = sheetFilter(), r = c.r, g = c.g, b = c.b;
    if (f.preset === 'grayscale') { var gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114); r = g = b = gray; }
    if (f.preset === 'sepia') { var or = r, og = g, ob = b; r = or * .393 + og * .769 + ob * .189; g = or * .349 + og * .686 + ob * .168; b = or * .272 + og * .534 + ob * .131; }
    if (f.preset === 'invert') { r = 255 - r; g = 255 - g; b = 255 - b; }
    var bright = Number(f.brightness) || 0, contrast = 1 + (Number(f.contrast) || 0) / 100;
    r = clamped(Math.round((r - 128) * contrast + 128 + bright), 0, 255);
    g = clamped(Math.round((g - 128) * contrast + 128 + bright), 0, 255);
    b = clamped(Math.round((b - 128) * contrast + 128 + bright), 0, 255);
    if (f.normalize !== 'off') {
      var levels = f.normalize === 'bw' ? 2 : parseInt(f.normalize, 10) || 4;
      var neutral = clamped(Math.round((r * .299 + g * .587 + b * .114) / 255 * (levels - 1)) * 255 / (levels - 1));
      r = g = b = neutral;
    }
    return { r: r, g: g, b: b, a: c.a };
  }

  function applyPreviewFilter(ctx, width, height) {
    var f = sheetFilter();
    if (f.preset === 'none' && !f.brightness && !f.contrast && f.normalize === 'off') return;
    var data = ctx.getImageData(0, 0, width, height);
    for (var i = 0; i < data.data.length; i += 4) {
      if (!data.data[i + 3]) continue;
      var c = filteredColor({ r: data.data[i], g: data.data[i + 1], b: data.data[i + 2], a: data.data[i + 3] });
      data.data[i] = c.r; data.data[i + 1] = c.g; data.data[i + 2] = c.b;
    }
    ctx.putImageData(data, 0, 0);
  }

  function filteredCompose(composed) {
    var palette = [], map = new Map(), remap = [], indices = new Uint8Array(composed.indices.length);
    composed.palette.forEach(function (color, index) {
      var c = filteredColor(color), key = c.r + ',' + c.g + ',' + c.b + ',' + c.a, next = map.get(key);
      if (next === undefined) { next = palette.length; palette.push(c); map.set(key, next); }
      remap[index] = next;
    });
    for (var i = 0; i < indices.length; i++) indices[i] = remap[composed.indices[i]];
    return { width: composed.width, height: composed.height, indices: indices, transparentIndex: remap[composed.transparentIndex], outlineIndex: -1, palette: palette };
  }

  function snapValue(v, isY) {
    if (!sheet.snap) return Math.round(v);
    if (sheet.mode === 'grid') return Math.round(v / sheet.cell) * sheet.cell;
    return Math.round(v / 8) * 8;
  }

  function renderSheet() {
    if (!deps) return;
    var canvas = $('sheetCanvas');
    if (!canvas) return;

    var body = $('sheetBody');
    var availW = Math.max(80, body.clientWidth - 48);
    var availH = Math.max(80, body.clientHeight - 48);
    var z = sheetZoom === 'fit'
      ? Math.max(1, Math.floor(Math.min(availW / sheet.width, availH / sheet.height)))
      : sheetZoom;
    z = clamped(z || 1, 1, 8);
    appliedZoom = z;

    var dw = sheet.width * z, dh = sheet.height * z;
    canvas.width = dw;
    canvas.height = dh;
    canvas.style.width = dw + 'px';
    canvas.style.height = dh + 'px';

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, dw, dh);
    ctx.imageSmoothingEnabled = false;

    var list = resolvePlacements();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var c = assetCanvas(findItem(p.assetId));
      ctx.drawImage(c, p.x * z, p.y * z, c.width * z, c.height * z);
    }
    applyPreviewFilter(ctx, dw, dh);

    if (sheet.mode === 'grid') {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (var x = 0; x <= sheet.width; x += sheet.cell) {
        ctx.beginPath(); ctx.moveTo(x * z + 0.5, 0); ctx.lineTo(x * z + 0.5, dh); ctx.stroke();
      }
      for (var y = 0; y <= sheet.height; y += sheet.cell) {
        ctx.beginPath(); ctx.moveTo(0, y * z + 0.5); ctx.lineTo(dw, y * z + 0.5); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = 'rgba(125,240,192,0.55)';
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(0, sheet.baseline * z + 0.5);
      ctx.lineTo(dw, sheet.baseline * z + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (selected != null && sheet.placements[selected]) {
      var sel = sheet.placements[selected];
      var it = findItem(sel.assetId);
      if (it) {
        ctx.strokeStyle = '#7df0c0';
        ctx.lineWidth = 2;
        ctx.strokeRect(sel.x * z + 1, sel.y * z + 1,
          it.result.asset.width * z - 2, it.result.asset.height * z - 2);
      }
    }

    $('sheetEmpty').classList.toggle('hidden', sheet.placements.length > 0);
    $('sheetZoomLabel').textContent = z + '×';
    $('sheetDims').textContent = sheet.width + '×' + sheet.height;
    $('sheetInfo').textContent = sheet.mode === 'grid'
      ? sheet.cell + 'px · ' + Math.floor(sheet.width / sheet.cell) + '×' + Math.floor(sheet.height / sheet.cell) + ' células'
      : 'régua · base em ' + sheet.baseline;
    $('sheetFoot').textContent = sheet.placements.length + ' sprites';
    renderSheetSel();
  }

  function renderSheetAssets() {
    var host = $('sheetAssets');
    host.innerHTML = '';
    items.forEach(function (item) {
      var el = document.createElement('div');
      el.className = 'asset-item';
      el.draggable = true;
      el.dataset.id = item.id;

      var img = document.createElement('img');
      img.src = thumbURL(item);
      img.alt = item.name;

      var name = document.createElement('span');
      name.className = 'an';
      name.textContent = item.name;

      var size = document.createElement('span');
      size.className = 'as';
      size.textContent = item.result.asset.width + 'px';

      el.appendChild(img);
      el.appendChild(name);
      el.appendChild(size);

      el.addEventListener('dragstart', function (e) {
        activeAssetId = item.id;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', item.id);
          e.dataTransfer.effectAllowed = 'copy';
        }
      });
      el.addEventListener('click', function () {
        activeAssetId = item.id;
        toast('Clique (ou arraste) na folha para colocar.');
      });

      host.appendChild(el);
    });
    $('sheetAssetCount').textContent = items.length ? '· ' + items.length : '—';
  }

  function renderSheetSel() {
    var host = $('sheetSel');
    host.innerHTML = '';
    var p = selected != null ? sheet.placements[selected] : null;
    var it = p ? findItem(p.assetId) : null;

    function add(k, v) {
      var row = document.createElement('div');
      row.className = 'stat';
      var kk = document.createElement('span'); kk.className = 'k'; kk.textContent = k;
      var vv = document.createElement('span'); vv.className = 'v'; vv.textContent = v;
      row.appendChild(kk); row.appendChild(vv);
      host.appendChild(row);
    }

    if (!it) {
      add('seleção', 'nenhuma');
    } else {
      add('asset', it.name);
      add('tamanho', it.result.asset.width + '×' + it.result.asset.height);
      add('posição', p.x + ', ' + p.y);
    }

    $('sheetReform').disabled = !it;
    $('sheetRemove').disabled = !it;
    if (it) $('sheetReformSize').value = it.result.asset.width;
  }

  function validateNow() {
    if (!deps) return;
    var list = resolvePlacements();
    var composed;
    try {
      composed = filteredCompose(PF.composeSheet(sheet.width, sheet.height, list));
    } catch (e) {
      $('sheetVerdict').textContent = 'ERRO';
      $('sheetVerdict').className = 'verdict fail';
      $('sheetChecks').textContent = e.message;
      return;
    }

    var res = PF.validateSheet({
      mode: sheet.mode, width: sheet.width, height: sheet.height,
      cell: sheet.cell, baseline: sheet.baseline,
      placements: list, sheet: composed,
      maxColors: deps.getContract ? deps.getContract().maxColors : 64
    });

    var host = $('sheetChecks');
    host.innerHTML = '';
    var bad = 0;
    res.checks.forEach(function (c) {
      if (!c.ok) bad++;
      var row = document.createElement('div');
      row.className = 'check-row ' + (c.ok ? 'ok' : 'bad');
      var ic = document.createElement('span');
      ic.className = 'ci';
      ic.textContent = c.ok ? '✓' : '✕';
      var wrap = document.createElement('div');
      var l = document.createElement('div'); l.className = 'cl'; l.textContent = c.label;
      var d = document.createElement('div'); d.className = 'cd'; d.textContent = c.detail;
      wrap.appendChild(l); wrap.appendChild(d);
      row.appendChild(ic); row.appendChild(wrap);
      host.appendChild(row);
    });

    var v = $('sheetVerdict');
    if (!list.length) {
      v.textContent = '—';
      v.className = 'verdict';
    } else if (bad === 0) {
      v.textContent = 'CONFORME';
      v.className = 'verdict pass';
    } else {
      v.textContent = bad + (bad === 1 ? ' FALHA' : ' FALHAS');
      v.className = 'verdict fail';
    }

    $('sheetExportPng').disabled = !list.length;
    $('sheetExportJson').disabled = !list.length;
    $('sheetExportAseprite').disabled = !list.length;
    $('sheetSaveLibrary').disabled = !list.length;
    $('sheetNote').textContent = list.length
      ? (composed.palette.length - 1) + ' cores na união · ' + list.length + ' sprites'
      : 'A folha tem paleta única (união das paletas) e sai indexada, como os sprites.';

    return { res: res, composed: composed, list: list };
  }

  function scheduleValidate() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { renderSheet(); validateNow(); }, 40);
  }

  function saveSheet() {
    if (!deps) return;
    dirty = true;
    persist(deps.store.putMeta('sheet', clone(sheet)));
  }

  function renderAll() {
    renderLibrary();
    renderSheetAssets();
    renderSheet();
    renderShadowTab();
    PF.lightingTab.render();
    validateNow();
    scheduleValidate();
  }

  /* ---------------------------------------------------------------- sombra */

  function shadowOpts() {
    return {
      shape: shadow.shape,
      widthScale: shadow.widthScale,
      squash: shadow.squash,
      offsetX: shadow.offsetX,
      offsetY: shadow.offsetY,
      padBottom: shadow.pad,
      color: shadow.color,
      alpha: shadow.opacity / 100
    };
  }

  function saveShadowState() {
    if (!deps) return;
    dirty = true;
    renderLibrary();
    clearTimeout(shadowSaveTimer);
    shadowSaveTimer = setTimeout(function () {
      persist(deps.store.putMeta('shadow', clone(shadow)));
    }, 300);
  }

  function applyShadowControls() {
    $('shadowShape').value = shadow.shape;
    $('shadowWidth').value = Math.round(shadow.widthScale * 100);
    $('shadowWidthVal').textContent = Math.round(shadow.widthScale * 100) + '%';
    $('shadowSquash').value = Math.round(shadow.squash * 100);
    $('shadowSquashVal').textContent = Math.round(shadow.squash * 100) + '%';
    $('shadowOpacity').value = shadow.opacity;
    $('shadowOpacityVal').textContent = shadow.opacity + '%';
    $('shadowPad').value = shadow.pad;
    $('shadowPadVal').textContent = shadow.pad;
    $('shadowColor').value = shadow.color;
    $('shadowDX').value = shadow.offsetX;
    $('shadowDY').value = shadow.offsetY;
  }

  function shadowItem() {
    if (!items.length) return null;
    var it = shadow.assetId ? findItem(shadow.assetId) : null;
    if (!it) { it = items[0]; shadow.assetId = it.id; }
    return it;
  }

  function shadowName(suffix) {
    var it = shadowItem();
    return (it ? it.name : 'sprite') + '-' + suffix;
  }

  function renderShadowTab() {
    var sel = $('shadowAsset');
    sel.innerHTML = '';
    items.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.id;
      o.textContent = it.name;
      sel.appendChild(o);
    });

    var has = items.length > 0;
    $('shadowEmpty').classList.toggle('hidden', has);
    if (!has) {
      $('shadowDims').textContent = '—';
      $('shadowInfo').textContent = '';
      ['shadowExportComposite', 'shadowExportOnly', 'shadowExportAseprite'].forEach(function (id) {
        $(id).disabled = true;
      });
      var c = $('shadowCanvas');
      c.width = 1;
      c.height = 1;
      return;
    }

    var it = shadowItem();
    sel.value = it.id;
    if ($('tab-shadow').classList.contains('hidden')) return;
    drawShadowPreview();
  }

  function drawShadowPreview() {
    var it = shadowItem();
    if (!it || !it.result) return;
    var asset;
    try {
      asset = PF.compositeShadow(it.result.asset, shadowOpts());
    } catch (e) {
      $('shadowInfo').textContent = e.message;
      ['shadowExportComposite', 'shadowExportOnly', 'shadowExportAseprite'].forEach(function (id) { $(id).disabled = true; });
      return;
    }

    var body = $('shadowBody');
    var availW = Math.max(80, body.clientWidth - 48);
    var availH = Math.max(80, body.clientHeight - 48);
    var z = shadowZoom === 'fit'
      ? Math.floor(Math.min(availW / asset.width, availH / asset.height))
      : shadowZoom;
    z = Math.max(1, Math.min(32, z || 1));
    shadowAppliedZoom = z;

    var canvas = $('shadowCanvas');
    canvas.width = asset.width * z;
    canvas.height = asset.height * z;
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';

    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var rgba = PF.toRGBA(asset);
    var tmp = document.createElement('canvas');
    tmp.width = asset.width;
    tmp.height = asset.height;
    var tctx = tmp.getContext('2d');
    var id = tctx.createImageData(asset.width, asset.height);
    id.data.set(rgba.data);
    tctx.putImageData(id, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);

    $('shadowDims').textContent = asset.width + '×' + asset.height;
    $('shadowInfo').textContent = shadow.shape === 'ellipse' ? 'elipse' : 'silhueta achatada';
    $('shadowZoomLabel').textContent = z + '×';
    $('shadowFoot').textContent = shadow.opacity + '% · ' + shadow.color;
    ['shadowExportComposite', 'shadowExportOnly', 'shadowExportAseprite'].forEach(function (id2) {
      $(id2).disabled = false;
    });
  }

  function shadowExport(kind) {    var it = shadowItem();
    if (!it || !it.result) { toast('Escolha um sprite.'); return; }
    var sprite = it.result.asset;

    if (kind === 'only') {
      var a = PF.shadowAsset(sprite, shadowOpts());
      PF.encodePNG(a).then(function (bytes) {
        return saveWith(bytes, shadowName('sombra') + '.png', 'image/png');
      }).then(function () { toast('Sombra exportada.'); })
        .catch(function (e) { toast('Falha: ' + e.message); });
      return;
    }

    var composed = PF.compositeShadow(sprite, shadowOpts());
    if (kind === 'aseprite') {
      PF.encodeAseprite(composed, { layerName: shadowName('sombra'), colorDepth: 'rgba' })
        .then(function (bytes) {
          return saveWith(bytes, shadowName('sombra') + '.aseprite', 'application/octet-stream');
        }).then(function () { toast('.aseprite com sombra exportado.'); })
        .catch(function (e) { toast('Falha: ' + e.message); });
      return;
    }

    PF.encodePNG(composed).then(function (bytes) {
      return saveWith(bytes, shadowName('com-sombra') + '.png', 'image/png');
    }).then(function () { toast('PNG com sombra exportado.'); })
      .catch(function (e) { toast('Falha: ' + e.message); });
  }

  function bindShadow() {
    $('shadowAsset').addEventListener('change', function (e) {
      shadow.assetId = e.target.value;
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowShape').addEventListener('change', function (e) {
      shadow.shape = e.target.value;
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowWidth').addEventListener('input', function (e) {
      shadow.widthScale = parseInt(e.target.value, 10) / 100;
      $('shadowWidthVal').textContent = e.target.value + '%';
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowSquash').addEventListener('input', function (e) {
      shadow.squash = parseInt(e.target.value, 10) / 100;
      $('shadowSquashVal').textContent = e.target.value + '%';
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowOpacity').addEventListener('input', function (e) {
      shadow.opacity = parseInt(e.target.value, 10);
      $('shadowOpacityVal').textContent = e.target.value + '%';
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowColor').addEventListener('input', function (e) {
      shadow.color = e.target.value;
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowPad').addEventListener('input', function (e) {
      shadow.pad = parseInt(e.target.value, 10) || 0;
      $('shadowPadVal').textContent = e.target.value;
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowDX').addEventListener('input', function (e) {
      shadow.offsetX = parseInt(e.target.value, 10) || 0;
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowDY').addEventListener('input', function (e) {
      shadow.offsetY = parseInt(e.target.value, 10) || 0;
      saveShadowState();
      drawShadowPreview();
    });
    $('shadowZoomIn').addEventListener('click', function () {
      shadowZoom = Math.min(32, shadowAppliedZoom + 1);
      drawShadowPreview();
    });
    $('shadowZoomOut').addEventListener('click', function () {
      shadowZoom = Math.max(1, shadowAppliedZoom - 1);
      drawShadowPreview();
    });
    $('shadowFit').addEventListener('click', function () {
      shadowZoom = 'fit';
      drawShadowPreview();
    });
    $('shadowExportComposite').addEventListener('click', function () { shadowExport('composite'); });
    $('shadowExportOnly').addEventListener('click', function () { shadowExport('only'); });
    $('shadowExportAseprite').addEventListener('click', function () { shadowExport('aseprite'); });
  }

  /* ---------------------------------------------------------------- interface */

  function pointToSheet(e) {
    var canvas = $('sheetCanvas');
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * sheet.width,
      y: (e.clientY - r.top) / r.height * sheet.height
    };
  }

  function hitTest(x, y) {
    for (var i = sheet.placements.length - 1; i >= 0; i--) {
      var p = sheet.placements[i];
      var it = findItem(p.assetId);
      if (!it) continue;
      if (x >= p.x && x < p.x + it.result.asset.width && y >= p.y && y < p.y + it.result.asset.height) return i;
    }
    return -1;
  }

  function bindSheet() {
    var canvas = $('sheetCanvas');

    canvas.addEventListener('dragover', function (e) { e.preventDefault(); });
    canvas.addEventListener('drop', function (e) {
      e.preventDefault();
      var id = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      var it = findItem(id);
      if (!it) return;
      var pt = pointToSheet(e);
      var x = snapValue(pt.x - it.result.asset.width / 2);
      var y = snapValue(pt.y - it.result.asset.height / 2);
      sheet.placements.push({
        assetId: id,
        x: clamped(x, 0, sheet.width - it.result.asset.width),
        y: clamped(y, 0, sheet.height - it.result.asset.height)
      });
      selected = sheet.placements.length - 1;
      renderAll();
      saveSheet();
    });

    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var pt = pointToSheet(e);
      var i = hitTest(pt.x, pt.y);
      if (i < 0) return;
      sheet.placements.splice(i, 1);
      selected = null;
      renderAll();
      saveSheet();
    });

    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var pt = pointToSheet(e);
      var i = hitTest(pt.x, pt.y);

      if (i < 0) {
        if (activeAssetId) {
          var it = findItem(activeAssetId);
          if (it) {
            sheet.placements.push({
              assetId: activeAssetId,
              x: clamped(snapValue(pt.x - it.result.asset.width / 2), 0, sheet.width - it.result.asset.width),
              y: clamped(snapValue(pt.y - it.result.asset.height / 2), 0, sheet.height - it.result.asset.height)
            });
            selected = sheet.placements.length - 1;
            renderAll();
            saveSheet();
          }
        } else {
          selected = null;
          renderSheet();
          renderSheetSel();
        }
        return;
      }

      selected = i;
      var p = sheet.placements[i];
      var it2 = findItem(p.assetId);
      drag = { index: i, dx: pt.x - p.x, dy: pt.y - p.y };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      renderSheet();
      renderSheetSel();
      if (it2) $('sheetReformSize').value = it2.result.asset.width;
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var pt = pointToSheet(e);
      var p = sheet.placements[drag.index];
      var it = findItem(p.assetId);
      if (!it) return;
      p.x = clamped(snapValue(pt.x - drag.dx), 0, sheet.width - it.result.asset.width);
      p.y = clamped(snapValue(pt.y - drag.dy), 0, sheet.height - it.result.asset.height);
      renderSheet();
    });

    canvas.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      saveSheet();
      scheduleValidate();
    });
    canvas.addEventListener('pointercancel', function () { drag = null; });

    // roda do mouse = zoom na folha
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dir = e.deltaY > 0 ? -1 : 1;
      sheetZoom = clamped(appliedZoom + dir, 1, 8);
      renderSheet();
    }, { passive: false });
  }

  /* ---------------------------------------------------------------- export */

  function baseName() {
    var first = sheet.placements[0];
    var it = first ? findItem(first.assetId) : null;
    return it ? it.name + '-folha' : 'folha';
  }

  function saveWith(bytes, name, mime) {
    if (deps.saveBytes) return deps.saveBytes(bytes, name, mime);
    deps.download(bytes, name, mime);
    return Promise.resolve('anchor');
  }

  function exportSheetPng() {
    var out = validateNow();
    if (!out || !out.list.length) { toast('A folha está vazia.'); return; }
    var name = baseName() + '-' + sheet.width + 'x' + sheet.height + '.png';
    PF.encodePNG(out.composed).then(function (bytes) {
      return saveWith(bytes, name, 'image/png');
    }).then(function () {
      toast('Folha exportada.');
    }).catch(function (e) {
      console.error(e);
      toast('Falha ao exportar a folha: ' + e.message);
    });
  }

  function exportSheetJson() {
    var out = validateNow();
    if (!out || !out.list.length) { toast('A folha está vazia.'); return; }
    var frames = PF.sheetFrames(out.list, sheet.mode, sheet.baseline);
    var data = {
      generator: 'pixel-forge sheet',
      mode: sheet.mode,
      size: [sheet.width, sheet.height],
      cell: sheet.mode === 'grid' ? sheet.cell : null,
      baseline: sheet.mode === 'ruler' ? sheet.baseline : null,
      palette: out.composed.palette.map(PF.rgbToHex),
      frames: frames,
      checks: out.res.checks
    };
    var name = baseName() + '.frames.json';
    saveWith(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name, 'application/json')
      .then(function () {
        toast('Frames exportados.');
      })
      .catch(function (e) { toast('Falha ao exportar: ' + e.message); });
  }

  function exportSheetAseprite() {
    var out = validateNow();
    if (!out || !out.list.length) { toast('A folha está vazia.'); return; }
    var name = baseName() + '.aseprite';
    PF.encodeAseprite(out.composed, { layerName: 'folha', colorDepth: 'rgba' }).then(function (bytes) {
      return saveWith(bytes, name, 'application/octet-stream');
    }).then(function () {
      toast('.aseprite da folha exportado.');
    }).catch(function (e) {
      console.error(e);
      toast('Falha ao exportar a folha: ' + e.message);
    });
  }

  /* ---------------------------------------------------------------- persistência */

  function loadFromStore() {
    projectLoading = true;
    document.body.inert = true;
    return deps.store.ready.then(function () { return deps.store.all(); }).then(function (records) {
      if (!records || !records.length) { renderAll(); return; }
      var chain = Promise.resolve();
      records.forEach(function (rec) {
        chain = chain.then(function () {
          return decodeDataURL(rec.source).then(function (img) {
            var item = {
              id: rec.id,
              name: rec.name,
              profile: rec.profile,
              params: rec.params,
              contract: rec.contract,
              source: img,
              sourceDataUrl: rec.source,
              createdAt: rec.createdAt,
              _version: 1
            };
            item.result = computeResult(item);
            items.push(item);
          }).catch(function () { /* item ilegível: ignora */ });
        });
      });
      return chain;
    }).then(function () {
      return deps.store.getMeta('project');
    }).then(function (settings) {
      if (settings && deps.restoreProject) deps.restoreProject(settings);
      return deps.store.getMeta('editor');
    }).then(function (record) {
      if (record) return prepareEditor(record).then(deps.restoreEditor);
    }).then(function () {
      return deps.store.getMeta('lighting');
    }).then(function (savedLighting) {
      PF.lightingTab.restore(savedLighting);
      return deps.store.getMeta('shadow');
    }).then(function (savedShadow) {
      if (savedShadow) {
        for (var k in savedShadow) {
          if (Object.prototype.hasOwnProperty.call(savedShadow, k)) shadow[k] = savedShadow[k];
        }
        applyShadowControls();
      }
      return deps.store.getMeta('anchor');
    }).then(function (savedAnchor) {
      anchorId = savedAnchor || null;
      return deps.store.getMeta('savedSheets');
    }).then(function (storedSheets) {
      savedSheets = Array.isArray(storedSheets) ? storedSheets.filter(function (entry) {
        return entry && entry.id && entry.name && entry.sheet && Array.isArray(entry.sheet.placements) &&
          entry.sheet.placements.every(function (p) { return findItem(p.assetId); });
      }) : [];
      return deps.store.getMeta('sheet');
    }).then(function (saved) {
      if (saved && saved.placements) sheet = saved;
      // descarta posicionamentos órfãos (asset que não voltou)
      sheet.placements = (sheet.placements || []).filter(function (p) { return !!findItem(p.assetId); });
      applySheetControls();
      dirty = false;
      renderAll();
    }).catch(function (e) {
      storageFailed = true;
      renderAll();
      toast('Falha ao carregar o acervo: ' + e.message);
    }).finally(function () {
      projectLoading = false;
      document.body.inert = false;
    });
  }

  function applySheetControls() {
    $('sheetW').value = sheet.width;
    $('sheetH').value = sheet.height;
    $('sheetCell').value = sheet.cell;
    $('sheetBaseline').value = sheet.baseline;
    $('sheetSnap').checked = !!sheet.snap;
    var filter = sheetFilter();
    $('sheetFilterPreset').value = filter.preset;
    $('sheetNormalize').value = filter.normalize;
    $('sheetBrightness').value = filter.brightness;
    $('sheetContrast').value = filter.contrast;
    $('sheetBrightnessVal').textContent = filter.brightness;
    $('sheetContrastVal').textContent = filter.contrast;
    Array.prototype.forEach.call($('sheetMode').children, function (b) {
      b.classList.toggle('active', b.dataset.mode === sheet.mode);
    });
    $('cellRow').classList.toggle('hidden', sheet.mode !== 'grid');
    $('baselineRow').classList.toggle('hidden', sheet.mode !== 'ruler');
    applySheetSaveLabel();
  }

  /* ---------------------------------------------------------------- bind */

  function bind() {
    // em file:// o IndexedDB costuma falhar: avisa antes de fechar com trabalho não salvo
    window.addEventListener('beforeunload', function (e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });

    Array.prototype.forEach.call($('tabs').children, function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    $('libClear').addEventListener('click', function () {
      if (!items.length) return;
      if (typeof window.confirm === 'function' &&
        !window.confirm('Esvaziar a biblioteca? Não dá para recuperar.')) return;
      items = [];
      sheet.placements = [];
      savedSheets = [];
      currentSavedSheetId = null;
      selected = null;
      persist(deps.store.clear());
      persist(deps.store.putMeta('savedSheets', []));
      saveSheet();
      dirty = true;
      renderAll();
      toast('Biblioteca esvaziada.');
    });

    $('libSaveFile').addEventListener('click', async function () {
      var editor = await deps.getEditorSnapshot();
      var data = PF.library.toSetFile({
        profile: deps.getProfile(),
        contract: deps.getContract(),
        sheet: sheet,
        sheets: savedSheets,
        anchorId: anchorId,
        shadow: shadow,
        lighting: PF.lightingTab.settings(),
        editor: editor,
        items: items.map(function (it) {
          return {
            id: it.id, name: it.name, profile: it.profile,
            params: it.params, contract: it.contract,
            sourceDataUrl: it.sourceDataUrl, createdAt: it.createdAt
          };
        })
      });
      saveWith(new Blob([data], { type: 'application/json' }), 'projeto.pfset', 'application/json')
        .then(function () {
          dirty = false;
          renderLibrary();
          toast('Projeto salvo.');
        })
        .catch(function (e) { toast('Falha ao salvar: ' + e.message); });
    });

    /* O contrato é o padrão do projeto: reaplicar re-deriva os assets deste
     * perfil em vez de deixar cada um congelado no contrato de quando nasceu. */
    $('libReapply').addEventListener('click', function () {
      var contract = deps.getContract();
      var profile = deps.getProfile();
      var n = 0;
      items.forEach(function (it) {
        if (it.profile !== profile) return;
        it.contract = clone(contract);
        itemRecompute(it);
        n++;
      });
      renderAll();
      toast(n
        ? n + (n === 1 ? ' asset reavaliado' : ' assets reavaliados') + ' com o contrato atual.'
        : 'Nenhum asset do perfil atual na biblioteca.');
    });

    $('libOpenFile').addEventListener('click', function () { $('libFileInput').click(); });
    $('libFileInput').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = PF.library.fromSetFile(reader.result);
          loadSet(data).catch(function (err) { toast('Não foi possível abrir o projeto: ' + err.message); });
        } catch (err) {
          toast('Arquivo inválido: ' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    Array.prototype.forEach.call($('sheetMode').children, function (b) {
      b.addEventListener('click', function () {
        sheet.mode = b.dataset.mode;
        applySheetControls();
        renderAll();
        saveSheet();
      });
    });

    ['sheetW', 'sheetH', 'sheetCell', 'sheetBaseline'].forEach(function (id) {
      $(id).addEventListener('input', function (e) {
        var v = parseInt(e.target.value, 10);
        if (!isFinite(v) || v < (id === 'sheetBaseline' ? 0 : 1)) return;
        if (id === 'sheetW') sheet.width = clamped(v, 16, 2048);
        if (id === 'sheetH') sheet.height = clamped(v, 16, 2048);
        if (id === 'sheetCell') sheet.cell = clamped(v, 8, 256);
        if (id === 'sheetBaseline') sheet.baseline = clamped(v, 0, 2048);
        scheduleValidate();
        saveSheet();
      });
    });

    $('sheetSnap').addEventListener('change', function (e) { sheet.snap = e.target.checked; saveSheet(); });
    $('sheetFilterPreset').addEventListener('change', function (e) {
      sheetFilter().preset = e.target.value;
      renderAll(); saveSheet();
    });
    $('sheetNormalize').addEventListener('change', function (e) {
      sheetFilter().normalize = e.target.value;
      renderAll(); saveSheet();
    });
    ['sheetBrightness', 'sheetContrast'].forEach(function (id) {
      $(id).addEventListener('input', function (e) {
        var key = id === 'sheetBrightness' ? 'brightness' : 'contrast';
        sheetFilter()[key] = clamped(parseInt(e.target.value, 10) || 0, -100, 100);
        $('sheetBrightnessVal').textContent = sheetFilter().brightness;
        $('sheetContrastVal').textContent = sheetFilter().contrast;
        renderSheet(); validateNow(); saveSheet();
      });
    });
    $('sheetClear').addEventListener('click', function () {
      sheet.placements = [];
      selected = null;
      renderAll();
      saveSheet();
    });

    $('sheetZoomIn').addEventListener('click', function () {
      sheetZoom = clamped(appliedZoom + 1, 1, 8);
      renderSheet();
    });
    $('sheetZoomOut').addEventListener('click', function () {
      sheetZoom = clamped(appliedZoom - 1, 1, 8);
      renderSheet();
    });
    $('sheetFit').addEventListener('click', function () { sheetZoom = 'fit'; renderSheet(); });

    $('sheetRemove').addEventListener('click', function () {
      if (selected == null) return;
      sheet.placements.splice(selected, 1);
      selected = null;
      renderAll();
      saveSheet();
    });

    $('sheetReform').addEventListener('click', function () {
      if (selected == null) return;
      var p = sheet.placements[selected];
      var it = findItem(p.assetId);
      if (!it) return;
      var n = clamped(parseInt($('sheetReformSize').value, 10) || 32, 8, 256);
      it.params.sizeW = n;
      it.params.sizeH = n;
      itemRecompute(it);
      renderAll();
      toast(it.name + ' reconformado em ' + n + 'px.');
    });

    $('sheetExportPng').addEventListener('click', exportSheetPng);
    $('sheetExportJson').addEventListener('click', exportSheetJson);
    $('sheetExportAseprite').addEventListener('click', exportSheetAseprite);
    $('sheetSaveLibrary').addEventListener('click', saveCurrentSheet);

    window.addEventListener('resize', function () {
      clearTimeout(window.__pfResizeAll);
      window.__pfResizeAll = setTimeout(function () {
        if (!$('tab-sheet').classList.contains('hidden')) renderSheet();
        if (!$('tab-shadow').classList.contains('hidden')) drawShadowPreview();
      }, 120);
    });
  }

  function loadSet(data) {
    if (projectLoading) return Promise.reject(new Error('já há um projeto sendo aberto'));
    projectLoading = true;
    document.body.inert = true;
    var incoming = [];
    var incomingSheet = clone(data.sheet || { mode: 'grid', width: 512, height: 512, cell: 32, baseline: 480, snap: true, placements: [] });
    var incomingShadow = clone(data.shadow || { assetId: null, shape: 'ellipse', widthScale: 1, squash: 0.35, offsetX: 0, offsetY: 0, color: '#000000', opacity: 45, pad: 8 });
    var incomingLighting = PF.lighting.settings(data.lighting);
    var incomingEditor = null;
    var settings = { profile: data.profile, contract: clone(data.contract) };
    var chain = Promise.resolve();
    (data.items || []).forEach(function (rec) {
      chain = chain.then(function () {
        return decodeDataURL(rec.source).then(function (img) {
          var item = {
            id: rec.id || PF.library.newId(),
            name: rec.name,
            profile: rec.profile,
            params: rec.params,
            contract: rec.contract,
            source: img,
            sourceDataUrl: rec.source,
            createdAt: rec.createdAt,
            _version: 1
          };
          item.result = computeResult(item);
          incoming.push(item);
        }).catch(function (e) { throw new Error((rec.name || rec.id) + ': imagem ou receita inválida (' + (e.message || 'falha na leitura') + ')'); });
      });
    });
    return chain.then(function () {
      return prepareEditor(data.editor).then(function (editor) { incomingEditor = editor; });
    }).then(function () {
      // Nenhuma alteração no acervo anterior até todas as fontes serem válidas.
      clearTimeout(shadowSaveTimer);
      clearTimeout(pendingTimer);
      return Promise.all(pendingWrites.slice());
    }).then(function () {
      return deps.store.replace(incoming.map(serialize), {
        sheet: incomingSheet, savedSheets: data.sheets || [], shadow: incomingShadow, lighting: incomingLighting, editor: data.editor || null,
        anchor: data.anchorId || null, project: settings
      });
    }).then(function () {
      items = incoming;
      sheet = incomingSheet;
      savedSheets = data.sheets || [];
      currentSavedSheetId = null;
      shadow = incomingShadow;
      anchorId = data.anchorId || null;
      selected = null;
      activeAssetId = null;
      drag = null;
      storageFailed = false;
      if (deps.restoreProject) deps.restoreProject(settings);
      if (data.editor) deps.restoreEditor(incomingEditor);
      else deps.restoreEditor(null);
      PF.lightingTab.restore(incomingLighting);
      applySheetControls();
      applyShadowControls();
      dirty = false;
      renderAll();
      toast(items.length + ' assets carregados.');
    }).finally(function () {
      projectLoading = false;
      document.body.inert = false;
    });
  }

  /* ---------------------------------------------------------------- init */

  function init(d) {
    deps = d;
    PF.lightingTab.init({
      getItems: function () { return items; },
      getEditor: deps.getEditor,
      toast: toast,
      saveBytes: deps.saveBytes,
      flushEditor: deps.flushEditor,
      changed: function (value) {
        dirty = true;
        persist(deps.store.putMeta('lighting', clone(value)));
        renderLibrary();
      }
    });
    bind();
    bindSheet();
    bindShadow();
    applySheetControls();
    applyShadowControls();
    return loadFromStore();
  }

  root.PF.tabs = {
    init: init,
    addItem: itemPush,
    switchTab: switchTab,
    setAnchor: setAnchor,
    anchorId: function () { return anchorId; },
    render: function () { renderAll(); },
    markDirty: markDirty,
    state: function () { return { items: items, sheet: sheet, sheets: savedSheets }; }
  };
})(typeof self !== 'undefined' ? self : this);
