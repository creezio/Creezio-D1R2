import test from 'node:test';import assert from 'node:assert/strict';import {manifest,read} from '../helpers.mjs';
test('installed docs bind the module version; authoring docs and six CI suites travel together',()=>{
  assert.equal(manifest.documentation.versionBinding.moduleVersion,manifest.identity.version);
  assert.equal(manifest.documentation.versionBinding.sourceRevision,manifest.identity.source.revision);
  for(const section of ['installed','development'])for(const entry of Object.values(manifest.documentation[section]))assert.ok(read(entry.path).trim().length>30,entry.path);
  assert.deepEqual(Object.keys(manifest.validation.suites),['backend','ui','api-mcp','widgets','package','docs']);
  for(const suite of Object.values(manifest.validation.suites)){assert.ok(read(suite.script).includes('runSuite'));assert.ok(suite.tests.length>0);}
});
