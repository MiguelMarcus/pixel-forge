/*
 * Teste de integração da UI sem navegador.
 *
 * Monta um DOM mínimo, carrega src/app.js de verdade e dispara o fluxo
 * de arquivo -> pipeline -> render. Se algum id estiver errado, ou se
 * renderChecks/renderStats estourar, este teste falha.
 *
 *   node tests/test-ui.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const PF = require('../src/core.js');
require('../src/aseprite.js');
require('../src/profiles.js');
require('../src/score.js');
require('../src/sheet.js');
require('../src/shadow.js');
require('../src/lighting.js');
require('../src/library.js');

globalThis.self = globalThis;
globalThis.PF = PF;
require('../src/lighting-tab.js');
require('../src/tabs.js');

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, '..');

let failures = 0, passes = 0;
function ok(cond, label, extra) {
  if (cond) { passes++; console.log('  ok   ' + label + (extra ? '  [' + extra + ']' : '')); }
  else { failures++; console.log('  FAIL ' + label + (extra ? '  [' + extra + ']' : '')); }
}

/* ------------------------------------------------- 1. ids batem com o HTML */

console.log('\n== 1. ids referenciados vs. ids no HTML ==');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appjs = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8') +
  fs.readFileSync(path.join(ROOT, 'src', 'tabs.js'), 'utf8') +
  fs.readFileSync(path.join(ROOT, 'src', 'lighting-tab.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...appjs.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const dynamic = new Set(['badgeL', 'badgeR']); // criados em runtime

const missing = [...usedIds].filter((id) => !htmlIds.has(id) && !dynamic.has(id));
ok(missing.length === 0, 'todo $() tem elemento no HTML', missing.join(', ') || 'ok');
const unused = [...htmlIds].filter((id) => !usedIds.has(id) && id !== 'fileInput' && id !== 'outCanvas' && id !== 'srcCanvas' && id !== 'divider' && id !== 'checker' && id !== 'gridOverlay' && id !== 'srcClip');
console.log('  info ids no HTML não usados por $(): ' + (unused.join(', ') || 'nenhum'));

/* ------------------------------------------------- 2. shim de DOM */

function makeClassList() {
  const s = new Set();
  return {
    add: (c) => s.add(c),
    remove: (c) => s.delete(c),
    contains: (c) => s.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !s.has(c) : !!force;
      if (on) s.add(c); else s.delete(c);
      return on;
    },
    _set: s
  };
}

function makeCtx(canvas) {
  const objs = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: () => ({ width: 200, height: 200, data: SYNTH.data })
  };
  const target = { canvas };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in objs) return objs[prop];
      if (prop in t) return t[prop];
      if (prop === 'then') return undefined;
      return () => ({ addColorStop() { } });
    },
    set(t, prop, val) { t[prop] = val; return true; }
  });
}

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: makeClassList(),
    _l: {},
    _html: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    width: 0,
    height: 0,
    addEventListener(t, f) { (el._l[t] = el._l[t] || []).push(f); },
    removeEventListener() { },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); return c; },
    setAttribute() { },
    getAttribute() { return null; },
    focus() { },
    select() { },
    click() { },
    setPointerCapture() { },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; },
    get clientWidth() { return 800; },
    get clientHeight() { return 600; },
    querySelector() { return null; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = v; if (v === '') el.children = []; }
  });
  if (el.tagName === 'CANVAS') {
    el.getContext = () => makeCtx(el);
    el.toDataURL = () => 'data:image/png;base64,AA==';
    Object.defineProperty(el, 'naturalWidth', { value: 200 });
    Object.defineProperty(el, 'naturalHeight', { value: 200 });
  }
  el.dispatch = (type, ev) => (el._l[type] || []).forEach((f) => f(ev || {}));
  return el;
}

/* sprite sintético 200x200 */
const SYNTH = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4) };
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 200; x++) {
    const i = (y * 200 + x) * 4;
    const inside = Math.abs(x - 100) < 60 && Math.abs(y - 105) < 70;
    SYNTH.data[i] = inside ? 210 : 255;
    SYNTH.data[i + 1] = inside ? 70 + (y % 40) : 255;
    SYNTH.data[i + 2] = inside ? 120 : 255;
    SYNTH.data[i + 3] = 255;
  }
}

const registry = new Map();
const document = {
  readyState: 'complete',
  body: makeEl('body'),
  getElementById(id) {
    if (!registry.has(id)) {
      registry.set(id, makeEl(/canvas$/i.test(id) ? 'canvas' : 'div'));
    }
    return registry.get(id);
  },
  createElement(tag) {
    if (tag === 'canvas') return makeEl('canvas');
    return makeEl(tag);
  },
  addEventListener() { },
  execCommand() { return true; }
};

const windowEvents = {};
let testStore;
const originalCreateStore = PF.library.createStore;
PF.library.createStore = function () { testStore = originalCreateStore(); return testStore; };
const windowStub = {
  PF: require('../src/core.js'),
  devicePixelRatio: 1,
  location: { search: '' },
  addEventListener(t, f) { (windowEvents[t] ||= []).push(f); },
  URLSearchParams: URLSearchParams
};

class FileReaderStub {
  readAsDataURL() { this.result = 'data:image/png;base64,AA=='; if (this.onload) this.onload({}); }
  readAsText(file) { this.result = file.content; if (this.onload) this.onload({}); }
}
class ImageStub {
  constructor() { this.naturalWidth = 200; this.naturalHeight = 200; }
  set src(_v) {
    if (String(_v).includes('BROKEN')) { if (this.onerror) this.onerror(new Error('imagem inválida')); }
    else if (this.onload) this.onload();
  }
  get src() { return ''; }
}

globalThis.window = windowStub;
globalThis.document = document;
globalThis.FileReader = FileReaderStub;
globalThis.Image = ImageStub;
globalThis.URL = globalThis.URL || class { };
const savedBlobs = [];
globalThis.URL.createObjectURL = function (blob) { savedBlobs.push(blob); return 'blob:test'; };
globalThis.URL.revokeObjectURL = function () { };

/* ------------------------------------------------- 3. roda o app */
console.log('\n== 2. init + fluxo de carregamento ==');
let bootError = null;
try {
  require('../src/app.js');
} catch (e) {
  bootError = e;
}
ok(!bootError, 'app.js inicializa sem exceção', bootError ? bootError.message : 'ok');
if (bootError) { console.log(bootError.stack); process.exit(1); }

const fileInput = document.getElementById('fileInput');
ok(fileInput._l.change && fileInput._l.change.length === 1, 'listener de arquivo registrado');

let loadError = null;
try {
  fileInput.dispatch('change', { target: { files: [{ type: 'image/png', name: 'teste.png' }] } });
} catch (e) {
  loadError = e;
}
await new Promise((r) => setTimeout(r, 150));
ok(!loadError, 'carregar imagem roda o pipeline sem exceção', loadError ? loadError.message : 'ok');
if (loadError) { console.log(loadError.stack); }

const g = (id) => document.getElementById(id);

console.log('\n== 3. interface reflete o resultado ==');
ok(g('stageDims').textContent === '64×64', 'dimensão na barra', g('stageDims').textContent);
ok(/\d+×\d+ → \d+×\d+/.test(g('stageInfo').textContent), 'info da fonte', g('stageInfo').textContent);
ok(g('checks').children.length === 11, '11 checagens (9 base + 2 do perfil)', String(g('checks').children.length));
ok(g('stats').children.length === 7, '7 estatísticas', String(g('stats').children.length));
ok(g('swatches').children.length > 0, 'swatches de paleta', String(g('swatches').children.length));
ok(/CONFORME|FALHA/.test(g('verdict').textContent), 'veredito definido', g('verdict').textContent);
ok(!g('emptyState').classList.contains('hidden') === false, 'empty state escondido');
ok(!g('compare').classList.contains('hidden'), 'área de preview visível');
ok(g('exportPng').disabled === false, 'export habilitado');
ok(g('exportAseprite').disabled === false, 'export .aseprite habilitado');
ok(typeof windowStub.PF.encodeAseprite === 'function', 'encoder .aseprite carregado');
ok(g('gridOverlay').style.backgroundSize === '8px 8px', 'grade acompanha o zoom', g('gridOverlay').style.backgroundSize);

console.log('\n== 4. controles reprocessam ==');
let ctrlError = null;
try {
  g('sizeCustom').dispatch('input', { target: { value: '32' } });
  g('alphaThresh').value = '200';
  g('alphaThresh').dispatch('input', { target: { value: '200' } });
  g('contractColors').dispatch('input', { target: { value: '4' } });
  g('outlineOn').checked = false;
  g('outlineOn').dispatch('change', { target: { checked: false } });
} catch (e) {
  ctrlError = e;
}
ok(!ctrlError, 'controles disparam recompute', ctrlError ? ctrlError.message : 'ok');
if (ctrlError) console.log(ctrlError.stack);

// espera o debounce (80ms) + folga
await new Promise((r) => setTimeout(r, 260));

ok(g('stageDims').textContent === '32×32', 'novo tamanho aplicado', g('stageDims').textContent);
ok(g('verdict').textContent.length > 0 && g('verdict').textContent !== '—', 'veredito atualizado', g('verdict').textContent);

const zoomBefore = g('zoomLabel').textContent;
g('canvasWrap').dispatch('wheel', { deltaY: -1, preventDefault() { } });
ok(g('zoomLabel').textContent !== zoomBefore, 'roda amplia o preview',
  zoomBefore + ' → ' + g('zoomLabel').textContent);
g('canvasWrap').dispatch('wheel', { deltaY: 1, preventDefault() { } });
ok(g('zoomLabel').textContent === zoomBefore, 'roda reduz de volta', g('zoomLabel').textContent);

g('exportAseprite').dispatch('click');
await new Promise((r) => setTimeout(r, 200));
ok(/salvo|Falha|Erro/i.test(g('toast').textContent), 'export .aseprite executa',
  g('toast').textContent);
ok(!g('saveBar').classList.contains('hidden'), 'barra de download aparece',
  g('saveBarText').textContent);

g('exportPng').dispatch('click');
await new Promise((r) => setTimeout(r, 200));
ok(/salvo|Falha|Erro/i.test(g('toast').textContent), 'export PNG executa', g('toast').textContent);

console.log('\n----------------------------------------');
console.log('== 4b. perfis de aplicação ==');
const profilesHost = g('profiles');
ok(profilesHost.children.length === 3, '3 perfis renderizados', String(profilesHost.children.length));

let btnBg = null;
profilesHost.children.forEach(function (b) { if (b.dataset.id === 'background') btnBg = b; });
ok(!!btnBg, 'perfil de fundo existe');
if (btnBg) {
  btnBg.dispatch('click');
  await new Promise((r) => setTimeout(r, 260));
  ok(g('stageDims').textContent === '320×180', 'fundo vira 320×180', g('stageDims').textContent);
  ok(!g('sizeRect').classList.contains('hidden'), 'controle retangular visível');
  ok(g('sizeSquare').classList.contains('hidden'), 'controle quadrado escondido');
  ok(!g('parallaxOpts').classList.contains('hidden'), 'parallax visível');
  ok(/pivô|sem pivô/.test(g('profileNote').textContent), 'nota do perfil', g('profileNote').textContent);
}

console.log('\n== 5. biblioteca e folha ==');
let btnChar = null;
profilesHost.children.forEach(function (b) { if (b.dataset.id === 'character') btnChar = b; });
btnChar.dispatch('click');
await new Promise((r) => setTimeout(r, 260));
g('sizeCustom').dispatch('input', { target: { value: '32' } });
await new Promise((r) => setTimeout(r, 140));

g('saveToLibrary').disabled = false;
g('saveToLibrary').dispatch('click');
await new Promise((r) => setTimeout(r, 60));

ok(g('libCount').textContent === '1', 'salvou 1 asset', g('libCount').textContent);
ok(g('libGrid').children.length === 1, 'card renderizado na biblioteca', String(g('libGrid').children.length));

PF.tabs.switchTab('sheet');
await new Promise((r) => setTimeout(r, 40));

ok(g('sheetAssets').children.length === 1, 'asset listado na folha', String(g('sheetAssets').children.length));

g('sheetCell').dispatch('input', { target: { value: '32' } });
g('sheetAssets').children[0].dispatch('click');
g('sheetCanvas').dispatch('pointerdown', { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
await new Promise((r) => setTimeout(r, 60));

ok(PF.tabs.state().sheet.placements.length === 1, 'sprite colocado na folha',
  String(PF.tabs.state().sheet.placements.length));
ok(g('sheetChecks').children.length >= 6, 'validação da folha rodou', String(g('sheetChecks').children.length));
ok(g('sheetVerdict').textContent === 'CONFORME', 'folha conforme', g('sheetVerdict').textContent);
ok(g('sheetExportPng').disabled === false, 'export da folha habilitado');
ok(g('sheetDims').textContent === '512×512', 'dimensões da folha', g('sheetDims').textContent);

const sheetZoomBefore = g('sheetZoomLabel').textContent;
g('sheetCanvas').dispatch('wheel', { deltaY: -1, preventDefault() { } });
ok(g('sheetZoomLabel').textContent !== sheetZoomBefore, 'roda amplia a folha',
  sheetZoomBefore + ' → ' + g('sheetZoomLabel').textContent);

g('sheetExportAseprite').dispatch('click');
await new Promise((r) => setTimeout(r, 250));
ok(/exportado|Falha|Erro/i.test(g('toast').textContent), 'export .aseprite da folha executa',
  g('toast').textContent);

console.log('\n== 6. reaplicar contrato ==');
g('contractColors').dispatch('input', { target: { value: '6' } });
await new Promise((r) => setTimeout(r, 220));
g('libReapply').dispatch('click');
await new Promise((r) => setTimeout(r, 150));

const libState = PF.tabs.state();
ok(libState.items.length === 1 && libState.items[0].contract.maxColors === 6,
  'contrato reaplicado ao acervo',
  libState.items[0] ? 'máx ' + libState.items[0].contract.maxColors : 'sem item');
ok(/reavaliado/.test(g('toast').textContent), 'toast confirma a reavaliação', g('toast').textContent);

console.log('\n== 7. extração distribuída ==');
g('extractMode').value = 'spread';
g('extractMode').dispatch('change', { target: { value: 'spread' } });
g('extractBtn').dispatch('click');
await new Promise((r) => setTimeout(r, 220));
ok(/cores extraídas/.test(g('toast').textContent), 'extração roda no modo distribuída',
  g('toast').textContent);
ok(/distribuída/.test(g('toast').textContent), 'toast nomeia o modo', g('toast').textContent);

console.log('\n== 8. conta-gotas ==');
g('paletteCustom').value = '#000000';
g('paletteCustom').dispatch('input', { target: { value: '#000000' } });
await new Promise((r) => setTimeout(r, 220));
const swBefore = g('swatches').children.length;
ok(swBefore === 1, 'paleta custom com 1 cor', String(swBefore));

g('pickColor').dispatch('click');
g('srcCanvas').dispatch('pointerdown', {
  clientX: 400, clientY: 300,
  preventDefault() { }, stopPropagation() { }
});
await new Promise((r) => setTimeout(r, 220));

ok(/preservada/.test(g('toast').textContent), 'conta-gotas adiciona a cor', g('toast').textContent);
ok(g('swatches').children.length === 2, 'paleta cresceu para 2', String(g('swatches').children.length));
ok(g('pickColor').classList.contains('active'), 'modo conta-gotas continua ativo');

console.log('\n== 9. borda configurável e remoção de preto/branco ==');
g('outlineWidth').dispatch('input', { target: { value: '5' } });
g('outlineColor').dispatch('input', { target: { value: '#ff00ff' } });
g('killBW').dispatch('change', { target: { checked: true } });
g('killBWTol').dispatch('input', { target: { value: '20' } });
await new Promise((r) => setTimeout(r, 260));

ok(!g('killBWOpts').classList.contains('hidden'), 'opções de preto/branco aparecem');
ok(!g('outlineColorRow').classList.contains('hidden'), 'linha de cor da borda aparece');

g('saveToLibrary').dispatch('click');
await new Promise((r) => setTimeout(r, 200));
const saved = PF.tabs.state().items.slice(-1)[0];
ok(saved.params.outlineRadius === 5, 'receita guarda largura 5', String(saved.params.outlineRadius));
ok(saved.params.outlineColor === '#ff00ff', 'receita guarda a cor da borda', saved.params.outlineColor);
ok(saved.params.outlineAuto === false, 'cor automática desligada');
ok(saved.params.removeBW === true && saved.params.bwTolerance === 20,
  'receita guarda a remoção de preto/branco', saved.params.bwTolerance);

console.log('\n== 10. lote e âncora ==');
const beforeBatch = PF.tabs.state().items.length;
g('fileInput').dispatch('change', {
  target: {
    files: [
      { type: 'image/png', name: 'lote-a.png' },
      { type: 'image/png', name: 'lote-b.png' }
    ]
  }
});
await new Promise((r) => setTimeout(r, 800));

ok(PF.tabs.state().items.length === beforeBatch + 2, 'lote salva 2 assets',
  beforeBatch + ' → ' + PF.tabs.state().items.length);

const list = PF.tabs.state().items;
PF.tabs.setAnchor(list[0].id);
await new Promise((r) => setTimeout(r, 120));
ok(PF.tabs.anchorId() === list[0].id, 'âncora definida');

const card2 = g('libGrid').children[1];
let badge = null;
card2.children.forEach(function (c) {
  if ((c.className || '').indexOf('lib-score') >= 0) badge = c;
});
ok(badge && /aceitar|ajustar|re-gerar/.test(badge.textContent), 'card mostra score contra a âncora',
  badge ? badge.textContent : 'sem badge');

console.log('\n== 11. duplicar variante ==');
const beforeDup = PF.tabs.state().items.length;
const card0 = g('libGrid').children[0];
let dupBtn = null;
card0.children.forEach(function (row) {
  (row.children || []).forEach(function (b) {
    if (b.textContent === 'dup') dupBtn = b;
  });
});
ok(!!dupBtn, 'botão dup existe no card');
if (dupBtn) {
  dupBtn.dispatch('click');
  await new Promise((r) => setTimeout(r, 220));
  ok(PF.tabs.state().items.length === beforeDup + 1, 'duplicar cria variante',
    beforeDup + ' → ' + PF.tabs.state().items.length);
}

console.log('\n== 12. silhueta ==');
g('silhouette').value = 'white';
g('silhouette').dispatch('change', { target: { value: 'white' } });
await new Promise((r) => setTimeout(r, 260));
g('saveToLibrary').dispatch('click');
await new Promise((r) => setTimeout(r, 220));

const silItem = PF.tabs.state().items.slice(-1)[0];
ok(silItem.params.silhouette === 'white', 'receita guarda a silhueta', silItem.params.silhouette);
ok(PF.computeStats(silItem.result.asset).usage.size === 2,
  'silhueta branca + borda = 2 tons', String(PF.computeStats(silItem.result.asset).usage.size));

console.log('\n== 13. aba sombra ==');
PF.tabs.switchTab('shadow');
await new Promise((r) => setTimeout(r, 200));

ok(g('shadowCanvas').width > 1, 'preview da sombra renderiza', String(g('shadowCanvas').width));
ok(/^32×\d+$/.test(g('shadowDims').textContent), 'dimensões da sombra', g('shadowDims').textContent);
ok(g('shadowExportComposite').disabled === false, 'export com sombra habilitado');
ok(g('shadowAsset').children.length >= 1, 'seletor de sprite populado',
  String(g('shadowAsset').children.length));

g('shadowOpacity').dispatch('input', { target: { value: '70' } });
await new Promise((r) => setTimeout(r, 80));
ok(g('shadowOpacityVal').textContent === '70%', 'opacidade atualiza', g('shadowOpacityVal').textContent);

g('shadowPad').dispatch('input', { target: { value: '16' } });
await new Promise((r) => setTimeout(r, 80));
ok(/^32×48$/.test(g('shadowDims').textContent), 'folga abaixo aumenta o quadro',
  g('shadowDims').textContent);

g('shadowExportComposite').dispatch('click');
await new Promise((r) => setTimeout(r, 300));
ok(/exportado|Falha|Erro/i.test(g('toast').textContent), 'export com sombra executa',
  g('toast').textContent);

console.log('\n== 14. regressões de backup, importação e armazenamento ==');
async function saveBackup() {
  g('libSaveFile').dispatch('click');
  await new Promise(r => setTimeout(r, 20));
  return JSON.parse(await savedBlobs.at(-1).text());
}
function closeWarns() {
  let warned = false;
  (windowEvents.beforeunload || []).forEach(fn => fn({ preventDefault() { warned = true; } }));
  return warned;
}
async function openBackup(data) {
  g('libFileInput').dispatch('change', { target: { files: [{ content: JSON.stringify(data) }], value: 'test.pfset' } });
  await new Promise(r => setTimeout(r, 100));
}
const originalBackup = await saveBackup();
ok(!closeWarns(), 'backup recém-salvo não tem alterações pendentes');
PF.tabs.setAnchor(PF.tabs.state().items[1].id);
ok(closeWarns(), 'troca de âncora ativa aviso de fechamento');
await saveBackup();
g('shadowOpacity').dispatch('input', { target: { value: '27' } });
ok(closeWarns(), 'mudança de sombra ativa aviso de fechamento');
await saveBackup();
PF.tabs.switchTab('shadow');
ok(!closeWarns(), 'apenas abrir preview da sombra não altera o projeto');
const beforeIds = PF.tabs.state().items.map(it => it.id).join(',');
const broken = structuredClone(originalBackup);
broken.items[0].source = 'data:image/png;base64,BROKEN';
await openBackup(broken);
ok(PF.tabs.state().items.map(it => it.id).join(',') === beforeIds, 'imagem ilegível na importação preserva o acervo');
ok((await testStore.all()).length === originalBackup.items.length, 'importação inválida preserva armazenamento');
ok(/Não foi possível abrir/.test(g('toast').textContent), 'erro de importação é informado');
ok(document.body.inert === false, 'interface é liberada depois da falha');
const invalidRecipe = structuredClone(originalBackup);
delete invalidRecipe.items[0].params;
await openBackup(invalidRecipe);
ok(PF.tabs.state().items.map(it => it.id).join(',') === beforeIds, 'receita inválida preserva o acervo');
const importedBackup = structuredClone(originalBackup);
importedBackup.profile = 'background';
importedBackup.contract = PF.profileContract('background');
importedBackup.anchorId = importedBackup.items[2].id;
await openBackup(importedBackup);
ok(!closeWarns(), 'projeto importado começa sem alterações pendentes');
ok(PF.tabs.anchorId() === importedBackup.anchorId, 'âncora importada é aplicada');
ok(await testStore.getMeta('anchor') === importedBackup.anchorId, 'âncora importada é persistida');
const roundtripBackup = await saveBackup();
ok(roundtripBackup.profile === 'background' && roundtripBackup.contract.maxColors === 64, 'perfil e contrato globais sobrevivem ao roundtrip');
ok(g('contractColors').value === 64, 'editor reflete contrato importado');
ok((await testStore.getMeta('project')).profile === 'background', 'padrão do projeto é persistido');
const originalReplace = testStore.replace;
testStore.replace = () => Promise.reject(new Error('quota excedida'));
await openBackup(originalBackup);
ok(PF.tabs.anchorId() === importedBackup.anchorId && PF.tabs.state().items.length === originalBackup.items.length, 'falha de gravação na importação preserva projeto ativo');
ok(/quota excedida/.test(g('toast').textContent), 'falha transacional é informada');
testStore.replace = originalReplace;
const originalPutMeta = testStore.putMeta;
testStore.putMeta = () => Promise.reject(new Error('falha de escrita'));
PF.tabs.setAnchor(PF.tabs.state().items[1].id);
await new Promise(r => setTimeout(r, 20));
ok(/Falha ao gravar/.test(g('toast').textContent), 'erro de gravação de metadados é visível');
ok(/falha de gravação/.test(g('libTotal').textContent), 'biblioteca não afirma que tudo foi salvo');
testStore.putMeta = originalPutMeta;

console.log('\n== 15. relevo, normais, iluminação e backup ==');
async function exportAndWait(action, filename) {
  const before = savedBlobs.length;
  action();
  const deadline = Date.now() + 5000;
  while ((savedBlobs.length === before || (filename && !filename.test(g('saveBarText').textContent))) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  if (savedBlobs.length === before || (filename && !filename.test(g('saveBarText').textContent))) throw new Error('exportação não gerou o arquivo esperado: ' + g('saveBarText').textContent);
  const blob = savedBlobs.at(-1);
  // O feedback de sucesso roda depois da entrega do blob, na mesma cadeia de promessas.
  await new Promise(r => setTimeout(r, 0));
  return blob;
}
PF.tabs.switchTab('lighting');
ok(!g('tab-lighting').classList.contains('hidden') && g('tab-shadow').classList.contains('hidden'), 'nova aba alterna sem sobrepor as outras');
ok(g('lightAsset').children.some(option => option.value === 'editor'), 'sprite atual pode ser usado sem salvar na biblioteca');
const lightItem = PF.tabs.state().items[0];
g('lightAsset').dispatch('change', { target: { value: lightItem.id } });
await new Promise(r => setTimeout(r, 80));
ok(g('lightDims').textContent === lightItem.result.asset.width + '×' + lightItem.result.asset.height, 'mapas usam a resolução exata do sprite escolhido');
ok(g('lightCanvas').width > 1 && !g('lightExportNormal').disabled, 'preview e exportação de normal map habilitados');
g('lightStrength').dispatch('input', { target: { value: '3.5' } });
g('lightFlipY').dispatch('change', { target: { checked: true } });
g('lightView').dispatch('change', { target: { value: 'normal' } });
await new Promise(r => setTimeout(r, 80));
ok(g('lightInfo').textContent === 'normal map', 'visualização de normais funciona');
ok(PF.lightingTab.settings().strength === 3.5 && PF.lightingTab.settings().flipY, 'controles atualizam força e convenção Y');
for (const kind of ['Normal', 'Bump', 'Source', 'Lit']) {
  const blob = await exportAndWait(() => g('lightExport' + kind).dispatch('click'), new RegExp('-' + kind.toLowerCase()));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  ok(bytes[25] === 6, 'export ' + kind + ' produz PNG RGBA', 'colorType=' + bytes[25]);
}
const lightBackup = await saveBackup();
ok(lightBackup.lighting.strength === 3.5 && lightBackup.lighting.flipY, 'backup inclui receita de relevo e luz');
ok(!closeWarns(), 'salvar backup limpa alterações de iluminação');
PF.tabs.switchTab('lighting');
ok(!closeWarns(), 'abrir a aba de iluminação não altera o projeto');
g('lightStrength').dispatch('input', { target: { value: '12' } });
ok(closeWarns(), 'mudança de relevo marca backup pendente');
await openBackup(lightBackup);
ok(PF.lightingTab.settings().strength === 3.5 && g('lightFlipY').checked, 'importação restaura controles e receita');
ok((await testStore.getMeta('lighting')).strength === 3.5, 'receita de relevo é persistida junto ao projeto');
g('lightView').dispatch('change', { target: { value: 'lit' } });
g('lightCanvas').dispatch('pointerdown', { button: 0, clientX: 700, clientY: 300, pointerId: 4 });
g('lightCanvas').dispatch('pointerup');
await new Promise(r => setTimeout(r, 80));
ok(PF.lightingTab.settings().azimuth === 0, 'arrastar na prévia move a direção da luz');
const sourceAssetBefore = JSON.stringify(lightItem.result.asset);
g('lightMode').dispatch('change', { target: { value: 'luminance' } });
await new Promise(r => setTimeout(r, 80));
ok(g('lightDetailRow').classList.contains('hidden'), 'modo luminosidade oculta mistura de silhueta');
ok(JSON.stringify(lightItem.result.asset) === sourceAssetBefore, 'geração e iluminação preservam o sprite original');

console.log('\n== 16. segunda auditoria: exportação, editor e folhas ==');
g('profiles').children.find(b => b.dataset.id === 'character').dispatch('click');
g('sizeCustom').dispatch('input', { target: { value: '48' } });
const immediateBlob = await exportAndWait(() => g('exportPng').dispatch('click'), /48x48px\.png/);
let immediatePng = new DataView(await immediateBlob.arrayBuffer());
ok(immediatePng.getUint32(16) === 48, 'exportação imediata aguarda a última alteração de tamanho');
await saveBackup();
g('sizeCustom').dispatch('input', { target: { value: '24' } });
ok(closeWarns(), 'editar o sprite marca o backup como pendente');
const editorBackup = await saveBackup();
ok(editorBackup.editor && editorBackup.editor.params.sizeW === 24 && /^data:image/.test(editorBackup.editor.source), 'backup guarda fonte e última receita do editor');
const full = PF.tabs.state().items[0];
g('sheetW').dispatch('input', { target: { value: String(full.result.asset.width) } });
g('sheetH').dispatch('input', { target: { value: String(full.result.asset.height) } });
g('sheetCell').dispatch('input', { target: { value: String(full.result.asset.width) } });
g('sheetClear').dispatch('click');
function cardButton(card, text) { return card.children.flatMap(row => row.children || []).find(b => b.textContent === text); }
cardButton(g('libGrid').children[0], 'folha').dispatch('click');
cardButton(g('libGrid').children[0], 'folha').dispatch('click');
ok(PF.tabs.state().sheet.placements.length === 1 && /cheia/.test(g('toast').textContent), 'folha cheia não empilha outro sprite em 0,0');
const onlyEditor = structuredClone(editorBackup);
onlyEditor.items = []; onlyEditor.anchorId = null; onlyEditor.sheet.placements = []; onlyEditor.lighting.assetId = 'editor';
await openBackup(onlyEditor);
ok(PF.tabs.state().items.length === 0 && g('stageDims').textContent === '24×24', 'projeto sem biblioteca restaura o sprite em edição');
ok((await testStore.getMeta('editor')).params.sizeW === 24, 'editor importado fica disponível após reabrir o navegador');
PF.tabs.switchTab('lighting');
await exportAndWait(() => g('lightExportNormal').dispatch('click'), /normal-y/);
ok(!g('lightExportNormal').disabled && /normal-y/.test(g('saveBarText').textContent), 'normal map volta a funcionar ao abrir backup só do editor');
ok(!/Sprite-em-edi/.test(g('saveBarText').textContent), 'nome exportado usa o nome do arquivo, sem texto do seletor');
g('lightPresetBold').dispatch('click');
ok(PF.lightingTab.settings().strength === 12 && PF.lightingTab.settings().smooth === 0, 'preset marcado aplica relevo e suavização');
g('lightPresetFlat').dispatch('click');
ok(PF.lightingTab.settings().strength === 0, 'preset plano elimina inclinação das normais');
g('lightReset').dispatch('click');
ok(PF.lightingTab.settings().strength === 6 && PF.lightingTab.settings().assetId === 'editor', 'redefinir controles preserva a origem selecionada');
g('lightColor').dispatch('input', { target: { value: '#ff0000' } });
ok(PF.lightingTab.settings().color === '#ff0000', 'cor da luz atualiza durante a edição');
g('sizeCustom').dispatch('input', { target: { value: '40' } });
const immediateNormal = await exportAndWait(() => g('lightExportNormal').dispatch('click'), /normal-y/);
immediatePng = new DataView(await immediateNormal.arrayBuffer());
ok(immediatePng.getUint32(16) === 40, 'normal map também respeita edição pendente do sprite');
g('outlineInner').dispatch('change', { target: { checked: true } });
g('killBW').dispatch('change', { target: { checked: true } });
g('killBWTol').dispatch('input', { target: { value: '15' } });
g('silhouette').dispatch('change', { target: { value: 'white' } });
const manifestBlob = await exportAndWait(() => g('exportJson').dispatch('click'), /\.asset\.json/);
const manifest = JSON.parse(await manifestBlob.text());
ok(manifest.params.outlineInner && manifest.params.removeBW && manifest.params.bwTolerance === 15 && manifest.params.silhouette === 'white' &&
  manifest.params.palette.length > 0 && Array.isArray(manifest.paletteRGBA) && Number.isInteger(manifest.transparentIndex), 'manifesto registra todos os controles novos do pipeline');
const savedEditor = await saveBackup();
const brokenEditor = structuredClone(savedEditor); brokenEditor.editor.source = 'data:image/png;base64,BROKEN';
await openBackup(brokenEditor);
ok(g('stageDims').textContent === '40×40' && /Não foi possível abrir/.test(g('toast').textContent), 'editor ilegível no backup preserva o projeto atual');
const originalCreateElement = document.createElement;
document.createElement = function (tag) {
  const element = originalCreateElement(tag);
  if (tag === 'canvas') element.getContext = () => ({ drawImage() {}, getImageData() { throw new Error('canvas indisponível'); } });
  return element;
};
await openBackup(savedEditor);
document.createElement = originalCreateElement;
ok(!document.body.inert && /canvas indisponível/.test(g('toast').textContent), 'falha do canvas rejeita importação e não deixa a interface bloqueada');
const legacy = structuredClone(savedEditor); delete legacy.editor;
await openBackup(legacy);
ok(g('lightExportNormal').disabled && g('fileName').textContent === 'nenhuma imagem', 'backup antigo sem editor abre e limpa a imagem do projeto anterior');

const vm = await import('node:vm');
const startupEvents = [], startupStore = originalCreateStore();
await startupStore.replace([], { editor: savedEditor.editor, project: { profile: savedEditor.profile, contract: savedEditor.contract }, lighting: { assetId: 'editor' } });
const bootPF = Object.assign({}, PF, { lightingTab: { init() {}, render() {}, restore() { startupEvents.push('lighting'); } } });
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/tabs.js'), 'utf8'), {
  self: { PF: bootPF }, window: windowStub, document, Image: ImageStub, setTimeout, clearTimeout
});
bootPF.tabs.init({ store: startupStore, getEditor() { return null; }, flushEditor() {},
  getProfile() { return savedEditor.profile; }, getContract() { return savedEditor.contract; },
  restoreProject() { startupEvents.push('project'); }, restoreEditor() { startupEvents.push('editor'); },
  toast() {}, saveBytes() { return Promise.resolve(); } });
ok(document.body.inert, 'interface aguarda o carregamento inicial antes de aceitar novas edições');
await new Promise(r => setTimeout(r, 100));
ok(startupEvents.join(',') === 'project,editor,lighting' && !document.body.inert, 'inicialização restaura o editor antes da origem da iluminação e libera a interface');
g('saveBarClose').dispatch('click');
console.log('\n----------------------------------------');
console.log(passes + ' passaram, ' + failures + ' falharam');
if (failures) process.exitCode = 1;
