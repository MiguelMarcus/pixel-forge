import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, '_site');
fs.mkdirSync(site, { recursive: true });
for (const name of ['index.html', 'styles.css', 'src']) {
  fs.cpSync(path.join(root, name), path.join(site, name), { recursive: true });
}
fs.writeFileSync(path.join(site, '.nojekyll'), '');
const htmlPath = path.join(site, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/(src|href)="((?:src\/[^"?]+\.js)|styles\.css)"/g, (_match, attribute, file) => {
  const digest = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 12);
  return `${attribute}="${file}?v=${digest}"`;
});
fs.writeFileSync(htmlPath, html);
console.log('Site estático pronto em _site/');
