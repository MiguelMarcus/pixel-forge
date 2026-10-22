const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

test('pacote publicado inclui assets atuais com versão por conteúdo', () => {
  const root=path.resolve(__dirname,'..');
  execFileSync(process.execPath,[path.join(root,'tools/build-site.mjs')]);
  const html=fs.readFileSync(path.join(root,'_site/index.html'),'utf8');
  const assets=[...html.matchAll(/(?:src|href)="((?:src\/[^"?]+\.js)|styles\.css)\?v=([a-f0-9]+)"/g)];
  assert.ok(assets.length>=12,'todos os scripts e CSS devem ter versão');
  for(const [,name,version] of assets) {
    const content=fs.readFileSync(path.join(root,name));
    assert.equal(createHash('sha256').update(content).digest('hex').slice(0,12),version,name);
    assert.deepEqual(fs.readFileSync(path.join(root,'_site',name)),content,name);
  }
  assert.ok(fs.existsSync(path.join(root,'_site/.nojekyll')));
});
