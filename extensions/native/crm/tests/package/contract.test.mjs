import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateModule} from '../../../../../sdk/contracts/validate.mjs';
import {manifest,moduleRoot} from '../helpers.mjs';

test('module contract validates and every packaged artifact is a regular file',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const group of ['runtime','validation'])for(const path of manifest.packaging[group].files){
    const stat=lstatSync(new URL(path,moduleRoot));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),path);
  }
});
test('runtime archive declares every MCP Apps renderer and HTML resource',()=>{
  const files=new Set(manifest.packaging.runtime.files);
  assert.ok(files.has('ui/widgets/runtime.ts'));
  for(const widget of manifest.contracts.widgets){
    assert.ok(files.has(widget.renderer.path),widget.id);
    const resource=manifest.contracts.mcp.resources.find(item=>item.id===widget.resource);
    assert.ok(files.has(resource?.source.path),widget.id);
  }
});
test('CRM conversation skill is integrity-bound to the packaged file',()=>{
  const skill=manifest.contracts.mcp.skills.find(item=>item.id==='crm');
  assert.ok(skill);
  assert.ok(manifest.packaging.runtime.files.includes(skill.path));
  assert.equal(skill.integrity,`sha256-${createHash('sha256').update(readFileSync(
    new URL(skill.path,moduleRoot))).digest('hex')}`);
  assert.equal(skill.resources.length,6);
  assert.equal(skill.operations.length,9);
});
