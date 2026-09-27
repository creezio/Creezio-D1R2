import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('standard theme ships version-bound reader documentation and separate development notes', () => {
  const base=new URL('../../',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('module/manifest.json',base)));
  assert.equal(manifest.documentation.versionBinding.moduleVersion,manifest.identity.version);
  assert.equal(manifest.documentation.versionBinding.sourceRevision,manifest.identity.source.revision);
  for(const kind of ['readme','prd','changelog']){
    const declared=manifest.documentation.installed[kind];
    assert.equal(declared.artifact,'runtime');
    assert.ok(readFileSync(new URL(declared.path,base),'utf8').trim().length>80,kind);
  }
  for(const declared of Object.values(manifest.documentation.development))
    if(declared?.path) assert.equal(declared.artifact,'validation');
});
