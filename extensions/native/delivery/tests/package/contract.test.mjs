import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {validateModule} from '@creezio/sdk/contracts/node';

const moduleRoot = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('module/manifest.json', moduleRoot), 'utf8'));
test('manifest is valid and both artifact inventories contain real files', () => {
  assert.deepEqual(validateModule(manifest).errors, []);
  for (const group of ['runtime', 'validation']) {
    for (const file of manifest.packaging[group].files)
      assert.equal(existsSync(new URL(file, moduleRoot)), true, `${group}: ${file}`);
  }
});
