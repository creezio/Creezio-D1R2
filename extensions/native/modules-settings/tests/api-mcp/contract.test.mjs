import test from 'node:test';import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
test('HTTP and MCP bind the same six operations with administrative native authentication',()=>{
  const ids=manifest.contracts.operations.map(op=>op.id);
  assert.equal(ids.length,6);
  assert.deepEqual(manifest.contracts.api.map(binding=>binding.operation.id),ids);
  assert.deepEqual(manifest.contracts.mcp.tools.map(tool=>tool.operation.id),ids);
  assert.ok(manifest.contracts.api.every(binding=>binding.audience==='admin'&&binding.auth.join(',')==='session,oauth'));
  for(const op of manifest.contracts.operations){assert.deepEqual(op.audiences,['admin']);assert.deepEqual(op.actors,['user','delegated-user']);assert.equal(op.context,'application');}
  const tool=manifest.contracts.mcp.tools.find(tool=>tool.id==='plans.accept');
  assert.equal(tool.annotations.readOnly,false);assert.equal(tool.annotations.idempotent,true);
  assert.equal(tool.annotations.openWorld,false);
});

test('catalogue transports preserve the full canonical title including supplementary Unicode',()=>{
  const ajv=new Ajv2020({strict:true});addFormats(ajv);
  const validators=['catalog-list-output','catalog-detail-output'].map(id=>
    ajv.compile(manifest.contracts.schemas.find(item=>item.id===id).schema));
  const hash='sha256-'+'a'.repeat(64);
  const item={moduleId:'vendor.catalogue',title:'',description:'',origin:'https://vendor.example',version:'1.0.0',
    candidateKey:null,codePresent:true,enabled:true,configuration:'ready',operational:'unknown',visibility:'current'};
  for(const title of ['x'.repeat(4000),'😀'.repeat(4000),'x'.repeat(4001),'😀'.repeat(4001)]) {
    item.title=title;
    const values=[{items:[item],nextAfterId:null,compositionDigest:hash,lockDigest:hash,inventoryDigest:hash,revision:0},
      {module:item,dependsOn:[],usedBy:[],optionalIntegrations:[],diagnostics:[]}];
    validators.forEach((validate,index)=>assert.equal(validate(values[index]),[...title].length<=4000));
  }
});
