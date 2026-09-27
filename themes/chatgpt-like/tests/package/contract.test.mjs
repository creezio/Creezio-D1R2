import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {validateModule} from '../../../../sdk/contracts/validate.mjs';

test('ChatGPT-like theme manifest and every declared artifact are valid',()=>{
  const base=new URL('../../',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('module/manifest.json',base)));
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const artifact of ['runtime','validation']) for(const name of manifest.packaging[artifact].files){
    const stat=lstatSync(new URL(name,base));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),name);
  }
  assert.equal(manifest.contracts.ui.themes[0].component.path,'ui/index.tsx');
  assert.equal(manifest.contracts.ui.themes[0].component.export,'ChatGptLikeFrontTheme');
});
