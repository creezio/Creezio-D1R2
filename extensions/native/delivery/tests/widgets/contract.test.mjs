import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../module/manifest.json', import.meta.url), 'utf8'));
test('delivery contributes no widget or public front view', () => {
  assert.deepEqual(manifest.contracts.widgets, []);
  assert.equal(manifest.contracts.ui.front.mode, 'absent');
  assert.deepEqual(manifest.contracts.ui.views[0].surfaces, ['workspace']);
  assert.equal(manifest.validation.suites.widgets.mode, 'not-applicable');
});
