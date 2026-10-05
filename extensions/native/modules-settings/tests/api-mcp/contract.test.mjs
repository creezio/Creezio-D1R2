import test from 'node:test';import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
test('HTTP and MCP bind the same ten operations with administrative native authentication',()=>{
  const ids=manifest.contracts.operations.map(op=>op.id);
  assert.equal(ids.length,10);
  assert.deepEqual(manifest.contracts.api.map(binding=>binding.operation.id),ids);
  assert.deepEqual(manifest.contracts.mcp.tools.map(tool=>tool.operation.id),ids);
  assert.ok(manifest.contracts.api.every(binding=>binding.audience==='admin'&&binding.auth.join(',')==='session,oauth'));
  for(const op of manifest.contracts.operations){assert.deepEqual(op.audiences,['admin']);assert.deepEqual(op.actors,['user','delegated-user']);assert.equal(op.context,'application');}
  const tool=manifest.contracts.mcp.tools.find(tool=>tool.id==='plans.accept');
  assert.equal(tool.annotations.readOnly,false);assert.equal(tool.annotations.idempotent,true);
  assert.equal(tool.annotations.openWorld,false);
  for(const [id,path] of [['plans.confirm-publication','/api/admin/module-plans/{plan_id}/publication'],
    ['plans.cancel-pending','/api/admin/module-plans/{plan_id}/cancel']]){
    const operation=manifest.contracts.operations.find(item=>item.id===id);
    const binding=manifest.contracts.api.find(item=>item.id===id);
    const mcp=manifest.contracts.mcp.tools.find(item=>item.id===id);
    assert.deepEqual(operation.permissions,[{moduleId:'creezio.modules-settings',kind:'permission',id:'manage'}]);
    assert.equal(binding.method,'POST');assert.equal(binding.path,path);
    assert.deepEqual(binding.parameters,[{name:'plan_id',in:'path',inputField:'planId',required:true}]);
    assert.deepEqual(mcp.annotations,{readOnly:false,destructive:false,idempotent:true,openWorld:false});
  }
});

test('installed documentation reads are bounded queries with pinned document identity and no arbitrary path',()=>{
  const ajv=new Ajv2020({strict:true});addFormats(ajv);
  const compile=id=>ajv.compile(manifest.contracts.schemas.find(item=>item.id===id).schema);
  const validate=compile('docs-read-input'),hash='sha256-'+'a'.repeat(64);
  const input={moduleId:'vendor.catalogue',kind:'prd',digest:hash,runtimeIntegrity:hash,blockIndex:0};
  assert.equal(validate(input),true);
  for(const invalid of [{...input,path:'AGENTS.md'},{...input,kind:'agents'},{...input,blockIndex:8},
    {...input,digest:undefined},{...input,runtimeIntegrity:undefined}]) assert.equal(validate(invalid),false);
  for(const id of ['docs.list','docs.read']) {
    const operation=manifest.contracts.operations.find(item=>item.id===id);
    assert.equal(operation.kind,'query');assert.equal(operation.pagination.mode,'none');
    assert.deepEqual(operation.effects,{reads:[],writes:[],emits:[],calls:[],providers:[]});
    assert.deepEqual(operation.permissions,[{moduleId:'creezio.modules-settings',kind:'permission',id:'manage'}]);
    assert.equal(manifest.contracts.api.find(item=>item.id===id).method,'GET');
    assert.equal(manifest.contracts.mcp.tools.find(item=>item.id===id).annotations.readOnly,true);
  }
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

test('plan handoff is a bounded admin read projection without raw package metadata',()=>{
  const operation=manifest.contracts.operations.find(item=>item.id==='plans.read');
  assert.deepEqual(operation.permissions,[{moduleId:'creezio.modules-settings',kind:'permission',id:'manage'}]);
  assert.deepEqual(operation.audiences,['admin']);
  assert.equal(operation.kind,'query');
  const ajv=new Ajv2020({strict:true});addFormats(ajv);
  const schema=manifest.contracts.schemas.find(item=>item.id==='plans-read-output').schema;
  const handoff=schema.properties.handoff.anyOf.find(item=>item.type==='object');
  assert.equal(handoff.additionalProperties,false);
  assert.deepEqual(handoff.properties.status,{const:'accepted_pending_publication'});
  assert.equal(handoff.properties.choices.additionalProperties,false);
  assert.equal(handoff.properties.choices.properties.actions.items.additionalProperties,false);
  assert.equal(handoff.properties.choices.properties.actions.items.properties.descriptor,undefined);
  assert.equal(ajv.compile(schema)({}),false,'a plan read must include its verified record and handoff state');
});
