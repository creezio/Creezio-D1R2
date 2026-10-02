import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('module documentation states the test Checkout boundary',()=>{
  const docs=['README.md','prd.md','interview.md','TODO.md','CHANGELOG.md'].map(read).join('\n');
  for(const term of ['lecture','webhook','paiement','pagination','clé','incertain'])
    assert.ok(docs.toLowerCase().includes(term),term);
  assert.ok(docs.includes('0.5.0'));
  assert.equal(manifest.documentation.versionBinding.moduleVersion,'0.5.0');
  assert.deepEqual(Object.keys(manifest.validation.suites).sort(),
    ['api-mcp','backend','docs','package','ui','widgets'].sort());
});
