import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('editorial front uses native view, without an MCP widget renderer',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.equal(manifest.contracts.ui.views.find(view=>view.id==='front').surfaces[0],'front');
});
