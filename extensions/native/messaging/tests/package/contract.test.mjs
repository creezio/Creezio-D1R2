import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {validateModule} from '@creezio/sdk/contracts/node';
import {manifest, moduleRoot} from '../helpers.mjs';

test('messaging package closes its declared runtime and validation artifacts', () => {
  assert.deepEqual(validateModule(manifest).errors, []);
  assert.equal(manifest.identity.id, 'creezio.messaging');
  for (const kind of ['runtime', 'validation']) {
    const names = manifest.packaging[kind].files;
    assert.equal(new Set(names).size, names.length);
    for (const name of names) {
      let cursor = moduleRoot;
      for (const part of name.split('/')) {
        cursor = new URL(part, cursor);
        const stat = lstatSync(cursor);
        assert.equal(stat.isSymbolicLink(), false, name);
        if (stat.isDirectory()) cursor = new URL(`${cursor.href}/`);
      }
      assert.ok(lstatSync(new URL(name, moduleRoot)).isFile(), name);
    }
  }
  for (const entry of ['module/manifest.json', 'module/models.json', manifest.entrypoints.server.path,
    'README.md', 'prd.md', 'CHANGELOG.md']) assert.ok(manifest.packaging.runtime.files.includes(entry), entry);
  assert.ok(!manifest.packaging.runtime.files.some(name => /^(tests|ci)\//.test(name)));
  for (const suite of ['backend', 'ui', 'api-mcp', 'widgets', 'package', 'docs']) {
    assert.ok(manifest.packaging.validation.files.includes(`ci/${suite}.mjs`));
    for (const file of manifest.validation.suites[suite].tests)
      assert.ok(manifest.packaging.validation.files.includes(file), file);
  }
});
