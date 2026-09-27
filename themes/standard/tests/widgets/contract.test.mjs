import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('standard theme renders no invented widget or chat contribution', () => {
  const manifest=JSON.parse(readFileSync(new URL('../../module/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.equal(manifest.contracts.ui.front.mode,'absent');
  assert.deepEqual(manifest.contracts.ui.views,[]);
});
