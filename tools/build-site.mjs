import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, '_site');
fs.mkdirSync(site, { recursive: true });
for (const name of ['index.html', 'styles.css', 'src']) {
  fs.cpSync(path.join(root, name), path.join(site, name), { recursive: true });
}
fs.writeFileSync(path.join(site, '.nojekyll'), '');
console.log('Site estático pronto em _site/');
