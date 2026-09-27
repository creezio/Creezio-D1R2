import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
test('installed documents describe the local boundary, exact transfer and absence of secrets', () => {
  const readme = read('README.md'), prd = read('prd.md');
  assert.match(readme, /Docker local/);
  assert.match(readme, /même transfert/);
  assert.match(readme, /Aucun secret/);
  assert.match(prd, /CSRF/);
  assert.match(prd, /désactivées par défaut/);
  assert.ok(read('CHANGELOG.md').includes('0.0.0'));
});
