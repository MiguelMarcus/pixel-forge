/* Round-trip: entrada "degradada por IA" -> Pixel Forge -> compara com o original.
 *   node tests/roundtrip.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const PF = require('../src/core.js');
require('../src/profiles.js');

const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'out');
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'ai-512.json'), 'utf8'));
const raw = fs.readFileSync(path.join(OUT, 'ai-512.raw'));
const src = { width: meta.width, height: meta.height, data: new Uint8ClampedArray(raw) };

const palettes = PF.palettes();
const charParams = PF.profileParams('character');
const charContract = PF.profileContract('character');

const configs = [
  { name: 'rt-pico8', palette: palettes.pico8.colors },
  { name: 'rt-sweetie', palette: palettes.sweetie16.colors }
];

for (const cfg of configs) {
  const res = PF.conform(src, {
    targetW: 64,
    targetH: 64,
    margin: charParams.margin,
    mode: charParams.mode,
    fit: charParams.fit,
    align: charParams.align,
    doAutoCrop: true,
    removeBg: true,
    bgColor: { r: 236, g: 241, b: 248 },
    bgTolerance: 18,
    alphaThreshold: charParams.alpha,
    palette: cfg.palette,
    dither: charParams.dither,
    outline: charParams.outline,
    outlineRadius: charParams.outlineRadius,
    orphanCleanup: charParams.orphanCleanup,
    contract: charContract
  });

  fs.writeFileSync(path.join(OUT, cfg.name + '.png'),
    await PF.encodePNG(res.asset, { deflate: (d) => zlib.deflateSync(d) }));
  fs.writeFileSync(path.join(OUT, cfg.name + '@8x.png'),
    await PF.encodePNG(PF.scaleNearest(res.asset, 8), { deflate: (d) => zlib.deflateSync(d) }));

  const bad = res.checks.filter((c) => !c.ok).map((c) => c.id);
  console.log(`${cfg.name}: ${res.stats.colorsUsed} cores, cobertura ${(res.stats.coverage * 100).toFixed(1)}%, ` +
    `órfãos ${res.stats.orphans}, contrato ${res.ok ? 'OK' : 'FALHA: ' + bad.join(',')}`);
}
