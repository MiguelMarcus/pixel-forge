/*
 * Testes do núcleo. Roda em Node puro (sem DOM):
 *   node tests/test-core.mjs
 * Gera PNGs em tests/out para serem verificados por verify_png.py.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const PF = require('../src/core.js');
require('../src/aseprite.js');
require('../src/score.js');
require('../src/shadow.js');

const OUT = path.join(import.meta.dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
let passes = 0;

function ok(cond, label, extra) {
  if (cond) { passes++; console.log('  ok   ' + label + (extra ? '  [' + extra + ']' : '')); }
  else { failures++; console.log('  FAIL ' + label + (extra ? '  [' + extra + ']' : '')); }
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* Imagem sintética "gerada por IA": gradiente, borda suave, glow. */
function makeAISprite(w, h) {
  const img = PF.createImage(w, h);
  const cx = w * 0.5, cy = h * 0.55;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / (w * 0.19);
      const dy = (y - cy) / (h * 0.23);
      const d = Math.sqrt(dx * dx + dy * dy);
      const bodyA = 1 - smoothstep(0.90, 1.04, d);
      // glow externo
      const glow = Math.max(0, 1 - Math.abs(d - 1.12) / 0.35) * 0.25;
      const t = Math.max(0, Math.min(1, (y - (cy - h * 0.25)) / (h * 0.5)));
      const r = Math.round(118 + 110 * t);
      const g = Math.round(70 + 130 * (1 - t));
      const b = Math.round(190 - 70 * t);
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(200 * glow + r * (1 - glow));
      img.data[i + 1] = Math.round(120 * glow + g * (1 - glow));
      img.data[i + 2] = Math.round(255 * glow + b * (1 - glow));
      img.data[i + 3] = Math.round(255 * Math.max(bodyA, glow * 0.7));
    }
  }
  return img;
}

function readFixture(name) {
  const p = path.join(import.meta.dirname, 'fixtures', name + '.raw');
  const m = path.join(import.meta.dirname, 'fixtures', name + '.json');
  if (!fs.existsSync(p) || !fs.existsSync(m)) return null;
  const meta = JSON.parse(fs.readFileSync(m, 'utf8'));
  const buf = fs.readFileSync(p);
  return { width: meta.width, height: meta.height, data: new Uint8ClampedArray(buf) };
}

const asHex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

console.log('\n== 1. pipeline completo (input sintético 512px) ==');
const src = makeAISprite(512, 512);
const palettes = PF.palettes();
const res = PF.conform(src, {
  targetW: 64,
  targetH: 64,
  margin: 1,
  mode: 'dominant',
  preserveAspect: true,
  doAutoCrop: true,
  removeBg: false,
  alphaThreshold: 128,
  palette: palettes.pico8.colors,
  dither: 'none',
  outline: true,
  outlineRadius: 1,
  orphanCleanup: true,
  contract: { maxColors: 16, minDistance: 16, requireOutline: true, requireMargin: false, maxOrphans: 0 }
});

ok(res.asset.width === 64 && res.asset.height === 64, 'saída em 64×64', res.asset.width + 'x' + res.asset.height);
ok(res.stats.colorsUsed <= 16, 'cores <= 16', res.stats.colorsUsed);
ok(res.stats.colorsUsed >= 3, 'usa mais de uma cor (não colapsou)', res.stats.colorsUsed);
ok(res.stats.coverage > 0.04 && res.stats.coverage < 0.98, 'cobertura plausível', (res.stats.coverage * 100).toFixed(1) + '%');

let badIndex = 0;
for (let i = 0; i < res.asset.indices.length; i++) if (res.asset.indices[i] >= res.asset.palette.length) badIndex++;
ok(badIndex === 0, 'todos os índices dentro da paleta', badIndex + ' inválidos');

const badAlpha = res.asset.palette.filter((c) => c.a !== 0 && c.a !== 255);
ok(badAlpha.length === 0, 'alpha binário na paleta', badAlpha.length + ' parciais');

const paletteHex = res.asset.palette.filter((c) => c.a > 0).map(asHex);
const allowedHex = palettes.pico8.colors.map(asHex);
const outside = paletteHex.filter((h) => !allowedHex.includes(h));
ok(outside.length === 0, 'nenhuma cor fora da paleta PICO-8', outside.join(',') || 'ok');

ok(res.stats.orphans === 0, 'sem pixels órfãos', res.stats.orphans);

// o outline tem que estar na silhueta inteira
const t = res.asset.transparentIndex;
let boundary = 0, wrong = 0;
for (let y = 0; y < 64; y++) {
  for (let x = 0; x < 64; x++) {
    const p = y * 64 + x;
    if (res.asset.indices[p] === t) continue;
    const edge = x === 0 || y === 0 || x === 63 || y === 63 ||
      res.asset.indices[p - 1] === t || res.asset.indices[p + 1] === t ||
      res.asset.indices[p - 64] === t || res.asset.indices[p + 64] === t;
    if (edge) { boundary++; if (res.asset.indices[p] !== res.asset.outlineIndex) wrong++; }
  }
}
ok(wrong === 0, 'outline cobre a borda da silhueta', boundary + ' px de borda');

const failed = res.checks.filter((c) => !c.ok);
ok(res.ok === true, 'contrato aprovado', failed.map((c) => c.id).join(',') || 'todas as checagens');
console.log('  checks: ' + res.checks.map((c) => (c.ok ? '✓' : '✕') + c.id).join(' '));

console.log('\n== 2. encoder PNG (indexado) ==');
const png = await PF.encodePNG(res.asset, { deflate: (d) => zlib.deflateSync(d) });
const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
ok(sig.every((b, i) => png[i] === b), 'assinatura PNG');
const colorType = png[25];
ok(colorType === 3, 'colorType 3 (indexado)', String(colorType));
const bitDepth = png[24];
ok(bitDepth === 8, 'bit depth 8', String(bitDepth));

fs.writeFileSync(path.join(OUT, 'result.png'), png);
const png8 = await PF.encodePNG(PF.scaleNearest(res.asset, 8), { deflate: (d) => zlib.deflateSync(d) });
fs.writeFileSync(path.join(OUT, 'result@8x.png'), png8);
ok(png8.length > png.length, '8× tem mais bytes', png.length + ' -> ' + png8.length);

const stored = PF.deflateStored(new Uint8Array([1, 2, 3, 4, 5]));
ok(stored[0] === 0x78 && stored[1] === 0x01, 'fallback zlib "stored" tem header válido');

console.log('\n== 2b. compressão real (caminho do navegador) ==');
function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))
  ]);
}

const zReal = await withTimeout(PF.zlibDeflate(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), 6000);
ok(zReal !== 'TIMEOUT' && zReal && zReal.length > 2, 'zlibDeflate resolve (pipe, sem deadlock)',
  zReal === 'TIMEOUT' ? 'TRAVOU' : zReal.length + ' bytes');
ok(zReal && zReal[0] === 0x78, 'header zlib', zReal && zReal[0] ? '0x' + zReal[0].toString(16) : '-');

const pngReal = await withTimeout(PF.encodePNG(res.asset), 6000);
ok(pngReal !== 'TIMEOUT' && pngReal.length > 100, 'encodePNG sem deflate injetado',
  pngReal === 'TIMEOUT' ? 'TRAVOU' : pngReal.length + ' bytes');

const aspReal = await withTimeout(PF.encodeAseprite(res.asset, { layerName: 'real' }), 6000);
ok(aspReal !== 'TIMEOUT' && aspReal.length > 128, 'encodeAseprite sem deflate injetado',
  aspReal === 'TIMEOUT' ? 'TRAVOU' : aspReal.length + ' bytes');

console.log('\n== 3. dithering e amostragem mudam a saída de forma controlada ==');const base = PF.conform(src, { targetW: 32, targetH: 32, doAutoCrop: true, palette: palettes.gameboy.colors, contract: {} });
const fs32 = PF.conform(src, { targetW: 32, targetH: 32, doAutoCrop: true, palette: palettes.gameboy.colors, dither: 'fs', contract: {} });
ok(base.asset.indices.length === fs32.asset.indices.length, 'mesmas dimensões com/sem dither');
ok(PF.toRGBA(base.asset).data.join() !== PF.toRGBA(fs32.asset).data.join(), 'Floyd–Steinberg altera o resultado');
ok(fs32.stats.colorsUsed >= base.stats.colorsUsed, 'dither usa pelo menos tantas cores', fs32.stats.colorsUsed + ' vs ' + base.stats.colorsUsed);

const box = PF.conform(src, { targetW: 32, targetH: 32, mode: 'box', doAutoCrop: false, palette: palettes.gameboy.colors, contract: {} });
const near = PF.conform(src, { targetW: 32, targetH: 32, mode: 'nearest', doAutoCrop: false, palette: palettes.gameboy.colors, contract: {} });
ok(PF.toRGBA(box.asset).data.join() !== PF.toRGBA(near.asset).data.join(), 'box e nearest são diferentes');

console.log('\n== 4. paleta custom e remoção de fundo ==');
const customPal = PF.parsePalette('#101820, #f2aa4c, #f5d547, #e8e8f0');
ok(customPal.length === 4, 'parse de paleta hex', customPal.map(asHex).join(' '));
const withCustom = PF.conform(src, { targetW: 48, targetH: 48, palette: customPal, contract: { maxColors: 4 } });
ok(withCustom.stats.colorsUsed <= 4, 'respeita paleta de 4 cores', withCustom.stats.colorsUsed);

// fundo sólido -> remoção por flood fill
const onWhite = PF.createImage(200, 200);
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 200; x++) {
    const i = (y * 200 + x) * 4;
    const inside = Math.abs(x - 100) < 45 && Math.abs(y - 100) < 45;
    onWhite.data[i] = inside ? 220 : 255;
    onWhite.data[i + 1] = inside ? 60 : 255;
    onWhite.data[i + 2] = inside ? 90 : 255;
    onWhite.data[i + 3] = 255;
  }
}
const cut = PF.removeBackground(onWhite, { r: 255, g: 255, b: 255 }, 10);
let outsideOpaque = 0, insideOpaque = 0, expectedInside = 0;
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 200; x++) {
    const a = cut.data[(y * 200 + x) * 4 + 3];
    const inside = Math.abs(x - 100) < 45 && Math.abs(y - 100) < 45;
    if (inside) { expectedInside++; if (a > 0) insideOpaque++; }
    else if (a > 0) outsideOpaque++;
  }
}
ok(outsideOpaque === 0, 'fundo removido por completo', outsideOpaque + ' px restantes');
ok(insideOpaque === expectedInside, 'sujeito preservado', insideOpaque + '/' + expectedInside + ' px');

console.log('\n== 5. idempotência sobre pixel art válida ==');
const cav = readFixture('cavaleiro-64');
if (!cav) {
  console.log('  --   fixture cavaleiro-64 ausente (rode make_fixture.py)');
} else {
  // paleta = cores exatas da imagem: o pipeline não pode alterar nada
  const uniq = new Map();
  for (let i = 0; i < cav.data.length; i += 4) {
    if (cav.data[i + 3] < 128) continue;
    const k = (cav.data[i] << 16) | (cav.data[i + 1] << 8) | cav.data[i + 2];
    if (!uniq.has(k)) uniq.set(k, { r: cav.data[i], g: cav.data[i + 1], b: cav.data[i + 2], a: 255 });
  }
  const srcPalette = Array.from(uniq.values());
  const again = PF.conform(cav, {
    targetW: cav.width,
    targetH: cav.height,
    doAutoCrop: false,
    alphaThreshold: 128,
    palette: srcPalette,
    dither: 'none',
    outline: false,
    orphanCleanup: false,
    contract: {}
  });
  const a = PF.toRGBA(again.asset).data;
  let same = 0, total = cav.width * cav.height;
  for (let i = 0; i < total; i++) {
    if (a[i * 4 + 3] === cav.data[i * 4 + 3] &&
      (cav.data[i * 4 + 3] === 0 || (a[i * 4] === cav.data[i * 4] && a[i * 4 + 1] === cav.data[i * 4 + 1] && a[i * 4 + 2] === cav.data[i * 4 + 2]))) same++;
  }
  const ratio = same / total;
  ok(ratio > 0.97, 'pixel art válida sobrevive ao pipeline', (ratio * 100).toFixed(1) + '% idêntico');
  console.log('  paleta extraída: ' + srcPalette.length + ' cores');
  fs.writeFileSync(path.join(OUT, 'idempotente.png'), await PF.encodePNG(again.asset, { deflate: (d) => zlib.deflateSync(d) }));
}

console.log('\n== 6. encoder .aseprite ==');
const asp = await PF.encodeAseprite(res.asset, { deflate: (d) => zlib.deflateSync(d), layerName: 'cavaleiro' });
fs.writeFileSync(path.join(OUT, 'result-indexed.aseprite'), asp);
ok(asp.length > 128, 'arquivo maior que o header', asp.length + ' bytes');
ok(asp[4] === 0xe0 && asp[5] === 0xa5, 'magic 0xA5E0 (little-endian)');
const declared = asp[0] | (asp[1] << 8) | (asp[2] << 16) | (asp[3] << 24);
ok(declared === asp.length, 'tamanho no header bate com o arquivo', declared + ' vs ' + asp.length);
ok(asp.buffer.byteLength === asp.length, 'buffer exato (sem view sobrando)', asp.buffer.byteLength + ' vs ' + asp.length);
const depthA = asp[12] | (asp[13] << 8);
ok(depthA === 8, 'color depth 8 (indexado)', String(depthA));
const framesA = asp[6] | (asp[7] << 8);
ok(framesA === 1, '1 frame', String(framesA));

const aspRaw = await PF.encodeAseprite(res.asset, { uncompressed: true });
ok(aspRaw[4] === 0xe0 && aspRaw[5] === 0xa5, 'variante sem compressão também é válida');
ok(aspRaw.length > asp.length, 'sem compressão é maior', aspRaw.length + ' vs ' + asp.length);
ok((aspRaw[0] | (aspRaw[1] << 8) | (aspRaw[2] << 16) | (aspRaw[3] << 24)) === aspRaw.length, 'tamanho confere no modo raw');

// sprite opaco não pode marcar uma cor real como transparente
const opaqueImg = PF.createImage(32, 32);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    opaqueImg.data[i] = 40 + x * 4;
    opaqueImg.data[i + 1] = 90 + y * 3;
    opaqueImg.data[i + 2] = 160;
    opaqueImg.data[i + 3] = 255;
  }
}
const opaqueRes = PF.conform(opaqueImg, {
  targetW: 32, targetH: 32, mode: 'box', palette: palettes.sweetie16.colors, contract: {}
});
ok(opaqueRes.asset.transparentIndex === -1, 'asset opaco não tem índice transparente');
const aspOpaque = await PF.encodeAseprite(opaqueRes.asset, { deflate: (d) => zlib.deflateSync(d) });
const tIdx = aspOpaque[28];
ok(tIdx >= opaqueRes.asset.palette.length, 'header aponta pra entrada extra, não pra cor real', String(tIdx));
const ncol = aspOpaque[32] | (aspOpaque[33] << 8);
ok(ncol === tIdx + 1, 'ncolors inclui a entrada transparente', ncol + ' vs ' + (tIdx + 1));
ok(tIdx < 256, 'índice transparente cabe no byte');

// .aseprite em RGB: é o modo que o app exporta, pra editar sem trava de paleta
const aspRgba = await PF.encodeAseprite(res.asset, {
  colorDepth: 'rgba', layerName: 'cavaleiro', deflate: (d) => zlib.deflateSync(d)
});
fs.writeFileSync(path.join(OUT, 'result.aseprite'), aspRgba);

const depthRgba = aspRgba[12] | (aspRgba[13] << 8);
ok(depthRgba === 32, 'RGB usa color depth 32', String(depthRgba));
ok(aspRgba[28] === 0, 'RGB não marca índice transparente', String(aspRgba[28]));

const rFrameLen = aspRgba[128] | (aspRgba[129] << 8) | (aspRgba[130] << 16) | (aspRgba[131] << 24);
const kinds = [];
for (let p2 = 144; p2 < 128 + rFrameLen;) {
  const csize = aspRgba[p2] | (aspRgba[p2 + 1] << 8) | (aspRgba[p2 + 2] << 16) | (aspRgba[p2 + 3] << 24);
  kinds.push(aspRgba[p2 + 4] | (aspRgba[p2 + 5] << 8));
  p2 += csize;
}
ok(kinds.indexOf(0x0004) >= 0 && kinds.indexOf(0x2019) < 0,
  'RGB usa o chunk de paleta antigo (0x0004)',
  kinds.map((c) => '0x' + c.toString(16)).join(' '));
ok(aspRgba.length > 128 && (aspRgba[0] | (aspRgba[1] << 8) | (aspRgba[2] << 16) | (aspRgba[3] << 24)) === aspRgba.length,
  'RGB com tamanho consistente', aspRgba.length + ' bytes');

console.log('\n== 7. perfis de aplicação ==');
const profiles = require('../src/profiles.js');
ok(profiles.list().length === 3, '3 perfis definidos');
const bgP = profiles.paramsFor('background');
ok(bgP.fit === 'cover' && bgP.outline === false, 'fundo: encaixe cover e sem outline');
ok(profiles.contractFor('background').rules.indexOf('seamlessX') >= 0, 'fundo exige emenda');
ok(profiles.contractFor('character').rules.indexOf('ground') >= 0, 'personagem exige pé na base');
const pv = profiles.pivotFor('character', 64, 64);
ok(pv && pv.x === 32 && pv.y === 63, 'pivô do personagem no pé', JSON.stringify(pv));
ok(profiles.pivotFor('background', 320, 180) === null, 'fundo sem pivô');

const charRes = PF.conform(src, {
  targetW: 64, targetH: 64, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, alphaThreshold: 128, palette: palettes.sweetie16.colors,
  outline: true, outlineRadius: 1, orphanCleanup: true,
  contract: profiles.contractFor('character')
});
ok(charRes.ok, 'personagem passa no contrato', charRes.checks.filter((c) => !c.ok).map((c) => c.id).join(',') || 'ok');
const groundCheck = charRes.checks.find((c) => c.id === 'ground');
ok(groundCheck && groundCheck.ok, 'pé na base', groundCheck ? groundCheck.detail : '-');

// fundo tileável de verdade: gradiente que fecha no ciclo
const tile = PF.createImage(64, 32);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    const v = Math.round(128 + 60 * Math.sin((x / 64) * Math.PI * 2));
    tile.data[i] = v; tile.data[i + 1] = v; tile.data[i + 2] = v; tile.data[i + 3] = 255;
  }
}
const tileRes = PF.conform(tile, {
  targetW: 64, targetH: 32, fit: 'cover', mode: 'box',
  palette: palettes.sweetie16.colors,
  contract: profiles.contractFor('background')
});
ok(tileRes.ok, 'gradiente cíclico tileia', tileRes.checks.filter((c) => !c.ok).map((c) => c.id).join(',') || 'ok');

// fundo com emenda dura: metade escura, metade clara
const broken = PF.createImage(64, 32);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    const v = x < 32 ? 16 : 240;
    broken.data[i] = v; broken.data[i + 1] = v; broken.data[i + 2] = v; broken.data[i + 3] = 255;
  }
}
const brokenRes = PF.conform(broken, {
  targetW: 64, targetH: 32, fit: 'cover', mode: 'box',
  palette: palettes.sweetie16.colors,
  contract: profiles.contractFor('background')
});
ok(!brokenRes.ok, 'metade escura/clara NÃO tileia');
const seamCheck = brokenRes.checks.find((c) => c.id === 'seamlessX');
ok(seamCheck && !seamCheck.ok, 'checagem de emenda acusa', seamCheck ? seamCheck.detail : '-');

console.log('\n== 8. folha de sprites ==');
const sheet = require('../src/sheet.js');

const src2 = PF.resample(src, 400, 512, 'box');
const c1 = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.sweetie16.colors, outline: true, orphanCleanup: true,
  contract: profiles.contractFor('character')
});
const c2 = PF.conform(src2, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.pico8.colors, outline: true, orphanCleanup: true,
  contract: profiles.contractFor('character')
});

const placements = [
  { asset: c1.asset, x: 0, y: 0, assetId: 'a', name: 'um' },
  { asset: c2.asset, x: 32, y: 0, assetId: 'b', name: 'dois' }
];
const sheetAsset = sheet.composeSheet(64, 64, placements);

ok(sheetAsset.width === 64 && sheetAsset.height === 64, 'folha 64×64');
ok(sheetAsset.indices.length === 4096, 'buffer do tamanho da folha', String(sheetAsset.indices.length));
ok(sheetAsset.transparentIndex === 0, 'índice 0 é o transparente');
ok(sheetAsset.palette.length - 1 <= 64, 'paleta união dentro do limite', String(sheetAsset.palette.length - 1));
ok(sheetAsset.palette.length - 1 === new Set(sheetAsset.palette.slice(1).map((c) => c.r + ',' + c.g + ',' + c.b)).size,
  'paleta sem cor repetida');

const sv = sheet.validateSheet({
  mode: 'grid', width: 64, height: 64, cell: 32, baseline: 63,
  placements: placements, sheet: sheetAsset, maxColors: 64
});
ok(sv.checks.length >= 6, 'checagens da folha', String(sv.checks.length));
ok(sv.ok, 'folha conforme', sv.checks.filter((c) => !c.ok).map((c) => c.id).join(',') || 'ok');

// mesma arte com paleta diferente tem que ser detectada como duplicada
const c3 = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.db16.colors, outline: true, orphanCleanup: true,
  contract: profiles.contractFor('character')
});
const dup = sheet.validateSheet({
  mode: 'grid', width: 64, height: 64, cell: 32, baseline: 63,
  placements: [{ asset: c3.asset, x: 0, y: 0 }, { asset: c3.asset, x: 32, y: 0 }],
  sheet: sheet.composeSheet(64, 64, [{ asset: c3.asset, x: 0, y: 0 }, { asset: c3.asset, x: 32, y: 0 }]),
  maxColors: 64
});
const dupCheck = dup.checks.find((c) => c.id === 'duplicates');
ok(dupCheck && !dupCheck.ok, 'duplicata detectada', dupCheck ? dupCheck.detail : '-');

const frames = sheet.sheetFrames(placements, 'grid', 63);
ok(frames.length === 2, '2 frames exportados');
ok(frames[0].pivot && frames[0].pivot.y === 31, 'pivô do frame no pé', JSON.stringify(frames[0].pivot));

const sheetPng = await PF.encodePNG(sheetAsset, { deflate: (d) => zlib.deflateSync(d) });
fs.writeFileSync(path.join(OUT, 'sheet.png'), sheetPng);
ok(sheetPng[24] === 8 && sheetPng[25] === 3, 'folha exporta PNG indexado');

console.log('\n== 9. extração de paleta: dominante vs distribuída ==');
const sceneImg = PF.createImage(120, 120);
for (let y = 0; y < 120; y++) {
  for (let x = 0; x < 120; x++) {
    const i = (y * 120 + x) * 4;
    let r, g, b;
    if (x < 3) { r = 245; g = 244; b = 238; }                 // contorno claro
    else if (x < 9) { r = 112; g = 74; b = 42; }              // tronco
    else {                                                     // massa verde com gradiente amplo
      const t = (x - 9) / 111;
      r = 20 + Math.round(110 * t);
      g = 95 + Math.round(130 * t);
      b = 35 + Math.round(95 * t);
    }
    sceneImg.data[i] = r; sceneImg.data[i + 1] = g; sceneImg.data[i + 2] = b; sceneImg.data[i + 3] = 255;
  }
}

function classifyPal(list) {
  let green = 0, warm = 0, light = 0;
  list.forEach((c) => {
    if (c.r > 200 && c.g > 200 && c.b > 200) light++;
    else if (c.g > c.r) green++;
    else warm++;
  });
  return { green, warm, light };
}

function coverageError(img, pal) {
  let max = 0, sum = 0, n = 0;
  for (let y = 0; y < 120; y += 2) {
    for (let x = 0; x < 120; x += 2) {
      const i = (y * 120 + x) * 4;
      let best = Infinity;
      for (let k = 0; k < pal.length; k++) {
        const dr = img.data[i] - pal[k].r, dg = img.data[i + 1] - pal[k].g, db = img.data[i + 2] - pal[k].b;
        const d = Math.sqrt(dr * dr + dg * dg + db * db);
        if (d < best) best = d;
      }
      if (best > max) max = best;
      sum += best; n++;
    }
  }
  return { max: max, mean: sum / n };
}

const domPal = PF.extractPalette(sceneImg, 8, 'dominant');
const sprPal = PF.extractPalette(sceneImg, 8, 'spread');
const domK = classifyPal(domPal), sprK = classifyPal(sprPal);

ok(domPal.length > 0 && sprPal.length > 0, 'ambas extraem cores', domPal.length + ' / ' + sprPal.length);
ok(sprPal.length <= 8 && domPal.length <= 8, 'respeitam o limite de 8');
ok(domK.green >= sprK.green, 'dominante concentra mais verdes', JSON.stringify(domK) + ' vs ' + JSON.stringify(sprK));

const covD = coverageError(sceneImg, domPal);
const covS = coverageError(sceneImg, sprPal);
ok(covS.max < covD.max, 'distribuída cobre melhor o caso extremo',
  'max ' + covS.max.toFixed(0) + ' < ' + covD.max.toFixed(0));

const uniq = new Set(sprPal.map((c) => c.r + ',' + c.g + ',' + c.b));
ok(uniq.size === sprPal.length, 'distribuída sem cores repetidas', uniq.size + '/' + sprPal.length);

console.log('\n== 10. preto/branco e borda configurável ==');
const bw = PF.createImage(30, 30);
for (let y = 0; y < 30; y++) {
  for (let x = 0; x < 30; x++) {
    const i = (y * 30 + x) * 4;
    const c = x < 10 ? [0, 0, 0] : (x < 20 ? [255, 255, 255] : [200, 40, 40]);
    bw.data[i] = c[0]; bw.data[i + 1] = c[1]; bw.data[i + 2] = c[2]; bw.data[i + 3] = 255;
  }
}
const bwOut = PF.removeBlackWhite(bw, 8);
let blackLeft = 0, whiteLeft = 0, redLeft = 0;
for (let y = 0; y < 30; y++) {
  for (let x = 0; x < 30; x++) {
    const i = (y * 30 + x) * 4;
    if (bwOut.data[i + 3] === 0) continue;
    if (x < 10) blackLeft++;
    else if (x < 20) whiteLeft++;
    else redLeft++;
  }
}
ok(blackLeft === 0, 'preto removido', String(blackLeft));
ok(whiteLeft === 0, 'branco removido', String(whiteLeft));
ok(redLeft === 300, 'a cor do sujeito sobrevive', String(redLeft));

const plain = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.sweetie16.colors, outline: false, orphanCleanup: true,
  contract: {}
});
const bordered = PF.addOutline(plain.asset, 3, { color: '#FF00FF' });
const oc = bordered.palette[bordered.outlineIndex];
ok(oc && oc.r === 255 && oc.g === 0 && oc.b === 255, 'borda usa a cor escolhida', PF.rgbToHex(oc || {}));
ok(bordered.palette.length === plain.asset.palette.length + 1, 'cor da borda entra na paleta',
  bordered.palette.length + ' vs ' + plain.asset.palette.length);

function borderPixels(a) {
  let n = 0;
  for (let i = 0; i < a.indices.length; i++) if (a.indices[i] === a.outlineIndex) n++;
  return n;
}
const thin = PF.addOutline(plain.asset, 1, { color: '#FF00FF' });
ok(borderPixels(bordered) > borderPixels(thin), 'largura 3 cobre mais que largura 1',
  borderPixels(bordered) + ' vs ' + borderPixels(thin));

console.log('\n== 11. score contra a âncora ==');
const anchorRes = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.sweetie16.colors, outline: true, orphanCleanup: true,
  contract: {}
});
const sameRes = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.sweetie16.colors, outline: true, orphanCleanup: true,
  contract: {}
});
const otherPal = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.db16.colors, outline: true, orphanCleanup: true,
  contract: {}
});

const sSame = PF.scorePair(anchorRes.asset, sameRes.asset);
const sOther = PF.scorePair(anchorRes.asset, otherPal.asset);

ok(sSame && sSame.score === 100, 'mesma arte pontua 100', sSame && String(sSame.score));
ok(sSame.verdict === 'aceitar', 'veredito aceitar', sSame && sSame.verdict);
ok(sOther && sOther.score < 100, 'paleta diferente derruba o score', sOther && String(sOther.score));
ok(sOther.metrics.paletteMiss > sSame.metrics.paletteMiss, 'métrica de paleta acusa',
  sOther.metrics.paletteMiss.toFixed(3) + ' vs ' + sSame.metrics.paletteMiss.toFixed(3));

const squareImg = PF.createImage(64, 64);
for (let y = 20; y < 44; y++) {
  for (let x = 22; x < 42; x++) {
    const i = (y * 64 + x) * 4;
    squareImg.data[i] = 210; squareImg.data[i + 1] = 90; squareImg.data[i + 2] = 70; squareImg.data[i + 3] = 255;
  }
}
const sqRes = PF.conform(squareImg, {
  targetW: 32, targetH: 32, mode: 'dominant', fit: 'contain', align: 'center',
  doAutoCrop: true, palette: palettes.sweetie16.colors, outline: true, orphanCleanup: true,
  contract: {}
});
const sSquare = PF.scorePair(anchorRes.asset, sqRes.asset);
ok(sSquare.score < sSame.score, 'silhueta diferente pontua menos', String(sSquare.score));

console.log('\n== 12. borda interna ==');
function opaqueCount(a) {
  let n = 0;
  for (let i = 0; i < a.indices.length; i++) if (a.indices[i] !== a.transparentIndex) n++;
  return n;
}
const plainOpaque = opaqueCount(plain.asset);
const outer2 = PF.addOutline(plain.asset, 2, { color: '#FF00FF' });
const inner2 = PF.addOutline(plain.asset, 2, { color: '#FF00FF', inner: true });
ok(opaqueCount(outer2) > plainOpaque, 'borda externa cresce a silhueta',
  opaqueCount(outer2) + ' vs ' + plainOpaque);
ok(opaqueCount(inner2) === plainOpaque, 'borda interna mantém a silhueta',
  opaqueCount(inner2) + ' vs ' + plainOpaque);
ok(inner2.indices[0] !== undefined, 'borda interna gera asset válido');

console.log('\n== 13. blue noise e rampas ==');
const bn = PF.blueNoise();
ok(bn && bn.length === 4096, 'máscara blue noise 64×64 embutida', bn ? String(bn.length) : 'nula');

const blueDither = PF.conform(src, {
  targetW: 32, targetH: 32, doAutoCrop: true, palette: palettes.gameboy.colors,
  dither: 'blue', ditherAmount: 0.6, contract: {}
});
const noDither = PF.conform(src, {
  targetW: 32, targetH: 32, doAutoCrop: true, palette: palettes.gameboy.colors,
  dither: 'none', contract: {}
});
ok(PF.toRGBA(blueDither.asset).data.join() !== PF.toRGBA(noDither.asset).data.join(),
  'blue noise altera a saída');
ok(blueDither.stats.colorsUsed >= noDither.stats.colorsUsed, 'blue noise usa mais tons',
  blueDither.stats.colorsUsed + ' vs ' + noDither.stats.colorsUsed);

const ramp = PF.extractPalette(sceneImg, 8, 'spread');
const keyOf = (c) => c.r + ',' + c.g + ',' + c.b;
ok(JSON.stringify(ramp) === JSON.stringify(PF.sortPaletteRamps(ramp)),
  'paleta extraída já vem ordenada em rampas');
ok(ramp.map(keyOf).sort().join('|') === PF.extractSpread(sceneImg, 8).map(keyOf).sort().join('|'),
  'ordenar não muda as cores');

console.log('\n== 14. silhueta (sombra) ==');
const silOrig = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.sweetie16.colors, outline: false, contract: {}
});
const silBlack = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.sweetie16.colors, silhouette: 'black',
  outline: false, contract: {}
});
const blackUsage = PF.computeStats(silBlack.asset).usage;
ok(blackUsage.size === 1, 'silhueta preta usa uma cor só', String(blackUsage.size));
const onlyColor = silBlack.asset.palette[Array.from(blackUsage.keys())[0]];
ok(onlyColor.r === 0 && onlyColor.g === 0 && onlyColor.b === 0, 'a cor é preta', PF.rgbToHex(onlyColor));
ok(PF.computeStats(silBlack.asset).opaque === PF.computeStats(silOrig.asset).opaque,
  'silhueta preserva a área do sprite',
  PF.computeStats(silBlack.asset).opaque + ' vs ' + PF.computeStats(silOrig.asset).opaque);

const silWhite = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.sweetie16.colors, silhouette: 'white',
  outline: true, outlineRadius: 1, contract: {}
});
const wc = silWhite.asset.palette[silWhite.asset.outlineIndex];
ok(wc && wc.r === 0 && wc.g === 0 && wc.b === 0, 'borda automática contrasta com o branco',
  wc ? PF.rgbToHex(wc) : '-');
ok(PF.computeStats(silWhite.asset).usage.size === 2, 'silhueta branca + borda = 2 tons',
  String(PF.computeStats(silWhite.asset).usage.size));

console.log('\n== 15. sombra automática ==');
const shSprite = PF.conform(src, {
  targetW: 32, targetH: 32, margin: 1, mode: 'dominant', fit: 'contain', align: 'bottom',
  doAutoCrop: true, palette: palettes.sweetie16.colors, outline: true, contract: {}
}).asset;
const shOpts = { shape: 'ellipse', widthScale: 1, squash: 0.35, offsetX: 0, offsetY: 0, color: '#000000', alpha: 0.45 };

const shMask = PF.shadowMask(shSprite, shOpts);
let shCount = 0;
for (let i = 0; i < shMask.length; i++) if (shMask[i]) shCount++;
ok(shCount > 0, 'máscara da sombra tem pixels', String(shCount));

const shOnly = PF.shadowAsset(shSprite, shOpts);
ok(shOnly.palette.length === 2, 'sombra tem 2 entradas (cor + transparente)', String(shOnly.palette.length));
ok(shOnly.palette[0].a > 0 && shOnly.palette[0].a < 255, 'cor da sombra tem alfa parcial', String(shOnly.palette[0].a));

const shComp = PF.compositeShadow(shSprite, shOpts);
const shStats = PF.computeStats(shComp);
ok(shStats.colorsUsed >= 2, 'composto junta sprite e sombra', String(shStats.colorsUsed));
ok(shComp.palette[0].a < 255, 'sombra fica atrás, com alfa');
ok(shComp.indices.length === shSprite.indices.length, 'mesmo quadro do sprite');

const shPng = await PF.encodePNG(shComp, { deflate: (d) => zlib.deflateSync(d) });
ok(shPng[25] === 3 && shPng[24] === 8, 'composto exporta PNG indexado');

const silMask = PF.shadowMask(shSprite, Object.assign({}, shOpts, { shape: 'silhouette' }));
let sx0 = 99, sx1 = -1, sy0 = 99, sy1 = -1;
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    if (!silMask[y * 32 + x]) continue;
    if (x < sx0) sx0 = x;
    if (x > sx1) sx1 = x;
    if (y < sy0) sy0 = y;
    if (y > sy1) sy1 = y;
  }
}
ok(sx1 - sx0 > sy1 - sy0, 'silhueta achatada fica mais larga que alta',
  (sx1 - sx0) + '×' + (sy1 - sy0));

console.log('\n----------------------------------------');
console.log(passes + ' passaram, ' + failures + ' falharam');
if (failures) process.exitCode = 1;
