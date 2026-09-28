import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('version-bound documents distinguish local support from original fleet transport',()=>{
  assert.equal(manifest.documentation.versionBinding.moduleVersion,manifest.identity.version);
  assert.match(read('prd.md'),/original/);
  assert.match(read('README.md'),/unavailable/);
  assert.match(read('TODO.md'),/contrats publics/);
  assert.match(read('CHANGELOG.md'),/Aucune release/);
});
