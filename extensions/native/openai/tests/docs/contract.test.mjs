import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('installed documentation matches module version and describes secret boundary',()=>{
  assert.equal(manifest.documentation.versionBinding.moduleVersion,manifest.identity.version);
  for(const name of ['README.md','prd.md','CHANGELOG.md'])assert.ok(read(name).length>60);
  assert.match(read('README.md'),/coffre serveur/);
  assert.match(read('prd.md'),/première recette/i);
});
