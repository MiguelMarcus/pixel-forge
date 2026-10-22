/* Injeta a máscara de blue noise gerada em src/core.js.
 *   node tools/embed-blue-noise.mjs
 */
import fs from 'node:fs';

const b64 = fs.readFileSync('tools/out/blue-noise.b64', 'utf8').trim();
if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('base64 inválido');

const src = fs.readFileSync('src/core.js', 'utf8');
const next = src.replace(/var BLUE_NOISE_B64 = '[^']*';/, `var BLUE_NOISE_B64 = '${b64}';`);
if (next === src) throw new Error('placeholder BLUE_NOISE_B64 não encontrado');

fs.writeFileSync('src/core.js', next);
console.log('máscara embutida: ' + b64.length + ' chars');
