import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('documentation states the source capability and outstanding signed remote recipe',()=>{
  const docs=['README.md','prd.md','TODO.md','CHANGELOG.md','interview.md'].map(read).join('\n').toLowerCase();
  for(const term of ['webhook','transcription','dossier','clé','synchronisation','0.1.0'])
    assert.ok(docs.includes(term),term);
  assert.deepEqual(Object.keys(manifest.validation.suites).sort(),
    ['api-mcp','backend','docs','package','ui','widgets'].sort());
});
