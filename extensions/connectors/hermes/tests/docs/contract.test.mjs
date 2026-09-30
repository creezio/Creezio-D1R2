import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('docs bind the version and state external protocol and pending qualification honestly',()=>{
  assert.equal(manifest.documentation.versionBinding.moduleVersion,manifest.identity.version);
  for(const name of ['README.md','prd.md','CHANGELOG.md','interview.md','TODO.md','AGENTS.md','FILES.md'])
    assert.ok(read(name).length>50,name);
  for(const phrase of ['externe','coffre','/v1/capabilities','génération','fournisseur réel'])
    assert.ok(read('README.md').includes(phrase),phrase);
  assert.match(read('TODO.md'),/issue inconnue/u);
  assert.match(read('TODO.md'),/approval/u);
  assert.match(read('README.md'),/Trois widgets MCP Apps/u);
  assert.match(read('README.md'),/aucun POST n’est renvoyé/u);
  assert.equal(manifest.validation.suites.widgets.mode,'required');
});
