import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('docs bind the candidate version and keep remote integration limits explicit',()=>{
  assert.equal(manifest.documentation.versionBinding.moduleVersion,manifest.identity.version);
  for(const name of ['README.md','prd.md','CHANGELOG.md','interview.md','TODO.md','AGENTS.md','FILES.md'])
    assert.ok(read(name).length>50,name);
  for(const text of ['coffre','POST /emails','Aucune opération publique','pièces jointes'])
    assert.ok(read('README.md').includes(text),text);
  assert.match(read('TODO.md'),/ne clôt ni T18 ni REQ-2901\/2902/u);
});
