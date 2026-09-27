import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {validateModule} from '../../../../sdk/contracts/validate.mjs';

test('widget module validates with all declared runtime and validation files confined',()=>{
  const base=new URL('../../',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('module/manifest.json',base)));
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const artifact of ['runtime','validation'])for(const name of manifest.packaging[artifact].files){
    const stat=lstatSync(new URL(name,base));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),name);
  }
  assert.equal(manifest.contracts.widgets.length,2);
  assert.equal(manifest.validation.suites.widgets.mode,'required');
});
