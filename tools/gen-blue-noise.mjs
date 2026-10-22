/* Gera uma máscara de blue noise 64×64 pelo algoritmo void-and-cluster
 * (Ulichney) e imprime em base64 para embutir no core.
 *
 *   node tools/gen-blue-noise.mjs
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const N = 64;
const SIZE = N * N;
const R = 4;
const SIGMA = 1.5;

function mod(n, m) { return ((n % m) + m) % m; }
function at(x, y) { return mod(y, N) * N + mod(x, N); }

const KERNEL = [];
for (let dy = -R; dy <= R; dy++) {
  for (let dx = -R; dx <= R; dx++) {
    KERNEL.push({ dx, dy, v: Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA)) });
  }
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(12345);
const pattern = new Uint8Array(SIZE);
const energy = new Float64Array(SIZE);

function stamp(x, y, sign) {
  for (const k of KERNEL) energy[at(x + k.dx, y + k.dy)] += sign * k.v;
}

const M = Math.round(SIZE * 0.1);
let placed = 0;
while (placed < M) {
  const p = Math.floor(rand() * SIZE);
  if (pattern[p]) continue;
  pattern[p] = 1;
  stamp(p % N, (p / N) | 0, +1);
  placed++;
}

function tightestCluster() {
  let best = -1, bestE = -Infinity;
  for (let p = 0; p < SIZE; p++) {
    if (pattern[p] && energy[p] > bestE) { bestE = energy[p]; best = p; }
  }
  return best;
}

function largestVoid() {
  let best = -1, bestE = Infinity;
  for (let p = 0; p < SIZE; p++) {
    if (!pattern[p] && energy[p] < bestE) { bestE = energy[p]; best = p; }
  }
  return best;
}

// estabiliza: enquanto o cluster mais apertado e o vazio maior forem
// pontos diferentes, move um para o outro
for (let iter = 0; iter < 4000; iter++) {
  const cluster = tightestCluster();
  if (cluster < 0) break;
  pattern[cluster] = 0;
  stamp(cluster % N, (cluster / N) | 0, -1);

  const voidP = largestVoid();
  if (voidP === cluster) {
    pattern[cluster] = 1;
    stamp(cluster % N, (cluster / N) | 0, +1);
    break;
  }
  pattern[voidP] = 1;
  stamp(voidP % N, (voidP / N) | 0, +1);
}

const rank = new Int32Array(SIZE).fill(-1);
let r = 0;

// fase 1: os que saem primeiro (clusters mais apertados)
for (; r < M; r++) {
  const cluster = tightestCluster();
  if (cluster < 0) break;
  rank[cluster] = r;
  pattern[cluster] = 0;
  stamp(cluster % N, (cluster / N) | 0, -1);
}

// fase 2: os que entram por último (vazios maiores primeiro)
for (; r < SIZE; r++) {
  const voidP = largestVoid();
  if (voidP < 0) break;
  rank[voidP] = r;
  pattern[voidP] = 1;
  stamp(voidP % N, (voidP / N) | 0, +1);
}

const mask = new Uint8Array(SIZE);
for (let i = 0; i < SIZE; i++) {
  const v = rank[i] < 0 ? 0 : rank[i];
  mask[i] = Math.round((v * 255) / (SIZE - 1));
}

const b64 = Buffer.from(mask).toString('base64');
fs.mkdirSync('tools/out', { recursive: true });
fs.writeFileSync('tools/out/blue-noise.b64', b64);

// PNG de conferência, 8× maior
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
const Z = 8;
const W = N * Z, H = N * Z;
const raw = Buffer.alloc((W + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W + 1)] = 0;
  for (let x = 0; x < W; x++) raw[y * (W + 1) + 1 + x] = mask[((y / Z) | 0) * N + ((x / Z) | 0)];
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(path.join('tools/out', 'blue-noise.png'), png);

console.log('máscara ' + SIZE + ' bytes | base64 ' + b64.length + ' chars');
console.log('min ' + Math.min(...mask) + ' max ' + Math.max(...mask));
