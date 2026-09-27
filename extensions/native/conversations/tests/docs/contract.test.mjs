import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('installed documentation belongs to this version and explains provider absence',()=>{
  assert.equal(manifest.documentation.versionBinding.moduleVersion,manifest.identity.version);
  for(const name of ['README.md','prd.md','CHANGELOG.md'])assert.ok(read(name).includes('conversation')||read(name).includes('Conversation'));
  assert.match(read('README.md'),/T16/);
  assert.match(read('interview.md'),/curseur/);
});
