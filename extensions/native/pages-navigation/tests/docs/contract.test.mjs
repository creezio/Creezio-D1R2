import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('documentation identifies explicit public exposure, private media and conservative reset',()=>{
  const docs=['README.md','prd.md','TODO.md','interview.md','FILES.md','CHANGELOG.md'];
  for(const name of docs)assert.ok(read(name).length>50,name);
  const all=docs.map(read).join('\n').toLowerCase();
  assert.match(all,/anonyme/);
  assert.match(all,/reset|rétablir/);
  assert.match(all,/navigation/);
  assert.match(all,/média/);
  assert.equal(manifest.documentation.versionBinding.sourceRevision,
    manifest.packaging.validationBinding.sourceRevision);
});
