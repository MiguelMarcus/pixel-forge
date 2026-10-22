(function (root) {
  'use strict';
  var PF = root.PF, $ = function (id) { return document.getElementById(id); };
  var deps, state = PF.lighting.settings(), maps = null, cachedAsset = null, cachedRecipe = '';
  var zoom = 'fit', appliedZoom = 1, timer = null, dragging = false;
  var controls = {
    lightMode: ['mode', 'select'], lightDetail: ['detail', 100], lightStrength: ['strength', 1],
    lightSmooth: ['smooth', 1], lightInvert: ['invert', 'check'], lightFlipY: ['flipY', 'check'],
    lightAzimuth: ['azimuth', 1], lightElevation: ['elevation', 1], lightAmbient: ['ambient', 100],
    lightIntensity: ['intensity', 100], lightSpecular: ['specular', 100], lightColor: ['color', 'select'],
    lightSelfShadow: ['selfShadow', 'check'], lightView: ['view', 'select']
  };

  function sources() {
    var list = deps.getItems().map(function (item) { return { id: item.id, name: item.name, asset: item.result.asset }; });
    var current = deps.getEditor();
    if (current) list.unshift({ id: 'editor', name: 'Sprite em edição · ' + current.name, asset: current.asset });
    return list;
  }

  function syncControls() {
    Object.keys(controls).forEach(function (id) {
      var spec = controls[id], value = state[spec[0]];
      if (spec[1] === 'check') $(id).checked = value;
      else $(id).value = typeof spec[1] === 'number' ? value * spec[1] : value;
      var label = $(id + 'Val');
      if (label) label.textContent = typeof spec[1] === 'number'
        ? (id === 'lightStrength' ? value : Math.round(value * spec[1])) + (spec[1] === 100 ? '%' : (id === 'lightAzimuth' || id === 'lightElevation' ? '°' : ''))
        : value;
    });
    $('lightDetailRow').classList.toggle('hidden', state.mode !== 'silhouette');
  }

  function active() { return sources().find(function (item) { return item.id === state.assetId; }); }
  function updateMaps(item) {
    var recipe = JSON.stringify([state.mode, state.detail, state.strength, state.smooth, state.invert, state.flipY]);
    if (cachedAsset !== item.asset || cachedRecipe !== recipe) {
      maps = PF.lighting.generate(item.asset, state);
      cachedAsset = item.asset; cachedRecipe = recipe;
    }
    return maps;
  }

  function draw() {
    var item = active();
    if (!item) return;
    var m = updateMaps(item), image;
    if (state.view === 'normal') image = m.normal;
    else if (state.view === 'height') image = m.bump;
    else if (state.view === 'source') image = m.source;
    else image = PF.lighting.illuminate(m, state);
    var body = $('lightBody');
    var fit = Math.floor(Math.min(Math.max(80, body.clientWidth - 48) / image.width, Math.max(80, body.clientHeight - 48) / image.height));
    appliedZoom = Math.max(1, Math.min(32, zoom === 'fit' ? fit : zoom));
    var canvas = $('lightCanvas'), ctx = canvas.getContext('2d'), tmp = document.createElement('canvas');
    tmp.width = image.width; tmp.height = image.height;
    var tctx = tmp.getContext('2d'), pixels = tctx.createImageData(image.width, image.height);
    pixels.data.set(image.data); tctx.putImageData(pixels, 0, 0);
    canvas.width = image.width * appliedZoom; canvas.height = image.height * appliedZoom;
    canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    $('lightDims').textContent = image.width + '×' + image.height;
    $('lightZoomLabel').textContent = appliedZoom + '×';
    $('lightInfo').textContent = { lit: 'prévia com luz', height: 'bump · altura', normal: 'normal map', source: 'cor original' }[state.view];
    $('lightFoot').textContent = item.name + ' · ' + (state.flipY ? 'Y−' : 'Y+');
  }

  function render() {
    if (!deps) return;
    var list = sources(), select = $('lightAsset');
    select.innerHTML = '';
    list.forEach(function (item) {
      var option = document.createElement('option'); option.value = item.id; option.textContent = item.name; select.appendChild(option);
    });
    if (!list.some(function (item) { return item.id === state.assetId; })) state.assetId = list.length ? list[0].id : 'editor';
    select.value = state.assetId;
    $('lightEmpty').classList.toggle('hidden', list.length > 0);
    ['lightExportNormal', 'lightExportBump', 'lightExportLit', 'lightExportSource'].forEach(function (id) { $(id).disabled = !list.length; });
    if (!list.length) {
      maps = null; cachedAsset = null;
      $('lightCanvas').width = $('lightCanvas').height = 1;
      $('lightDims').textContent = '—'; $('lightInfo').textContent = '';
      return;
    }
    if (!$('tab-lighting').classList.contains('hidden')) draw();
  }

  function changed() {
    state = PF.lighting.settings(state);
    syncControls();
    deps.changed(PF.lighting.settings(state));
    clearTimeout(timer);
    timer = setTimeout(draw, 35);
  }

  function placeLight(e) {
    var r = $('lightCanvas').getBoundingClientRect();
    var dx = (e.clientX - r.left) / r.width - 0.5;
    var dy = 0.5 - (e.clientY - r.top) / r.height;
    state.azimuth = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    changed();
  }

  function exportMap(kind) {
    var item = active();
    if (!item) { deps.toast('Abra um sprite ou salve um asset na biblioteca.'); return; }
    var m = updateMaps(item);
    var img = kind === 'normal' ? m.normal : (kind === 'bump' ? m.bump : (kind === 'source' ? m.source : PF.lighting.illuminate(m, state)));
    var suffix = kind === 'normal' ? 'normal-' + (state.flipY ? 'y-minus' : 'y-plus') : kind;
    var name = String(item.name || 'sprite').replace(/[^\w-]+/g, '-') + '-' + suffix + '.png';
    return PF.encodeRGBAPNG(img).then(function (bytes) {
      return deps.saveBytes(bytes, name, 'image/png');
    }).then(function () { deps.toast('PNG ' + suffix + ' exportado.'); })
      .catch(function (e) { deps.toast('Falha ao exportar: ' + e.message); });
  }

  function restore(value) {
    state = PF.lighting.settings(value); cachedAsset = null;
    syncControls(); render();
  }
  function init(d) {
    deps = d;
    Object.keys(controls).forEach(function (id) {
      var spec = controls[id];
      $(id).addEventListener(spec[1] === 'check' || spec[1] === 'select' ? 'change' : 'input', function (e) {
        state[spec[0]] = spec[1] === 'check' ? e.target.checked :
          (typeof spec[1] === 'number' ? parseFloat(e.target.value) / spec[1] : e.target.value);
        changed();
      });
    });
    $('lightAsset').addEventListener('change', function (e) { state.assetId = e.target.value; changed(); });
    $('lightZoomIn').addEventListener('click', function () { zoom = Math.min(32, appliedZoom + 1); draw(); });
    $('lightZoomOut').addEventListener('click', function () { zoom = Math.max(1, appliedZoom - 1); draw(); });
    $('lightFit').addEventListener('click', function () { zoom = 'fit'; draw(); });
    $('lightCanvas').addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || state.view !== 'lit') return;
      dragging = true; try { $('lightCanvas').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      placeLight(e);
    });
    $('lightCanvas').addEventListener('pointermove', function (e) { if (dragging) placeLight(e); });
    ['pointerup', 'pointercancel'].forEach(function (event) { $('lightCanvas').addEventListener(event, function () { dragging = false; }); });
    ['Normal', 'Bump', 'Lit', 'Source'].forEach(function (kind) {
      $('lightExport' + kind).addEventListener('click', function () { exportMap(kind.toLowerCase()); });
    });
    window.addEventListener('resize', function () { if (!$('tab-lighting').classList.contains('hidden')) draw(); });
    syncControls(); render();
  }
  PF.lightingTab = { init: init, render: render, restore: restore, settings: function () { return PF.lighting.settings(state); } };
})(typeof self !== 'undefined' ? self : this);
