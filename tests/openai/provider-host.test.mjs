import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderKeyring} from '../../core/providers/host.ts';
import {projectAuthorizedReadTools,strictToolSchema} from '../../core/providers/tools.ts';

test('deployment keyring rejects missing defaults and malformed material',async()=>{
  assert.equal(readProviderKeyring({}),null);
  assert.throws(()=>readProviderKeyring({CREEZIO_VAULT_KEYRING:'{"activeKeyId":"k","keys":{"k":"short"}}'}),
    {code:'unavailable'});
  const key=btoa(String.fromCharCode(...new Uint8Array(32).fill(9))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const ring=readProviderKeyring({CREEZIO_VAULT_KEYRING:JSON.stringify({activeKeyId:'k',keys:{k:key}})});
  assert.equal(ring.activeKeyId,'k');
  const ctx={moduleId:'creezio.openai',contextId:'a',bindingId:'openai.responses.v1',
    reference:'creezio-secret:v1:00000000-0000-4000-8000-000000000001',version:1};
  const envelope=await ring.seal(ctx,'test-secret');
  assert.equal(await ring.open(ctx,envelope),'test-secret');
  await assert.rejects(ring.open({...ctx,contextId:'b'},envelope),{code:'unreadable'});
});

test('tool projection advertises only compatible authorized reads and never mutates schemas',async()=>{
  const schema={type:'object',properties:{conversationId:{type:'string',maxLength:128}},
    required:['conversationId'],additionalProperties:false};
  const optional={type:'object',properties:{limit:{type:'integer'},cursor:{type:'string'}},
    required:['limit'],additionalProperties:false};
  assert.equal(strictToolSchema(schema),true);
  assert.equal(strictToolSchema(optional),false);
  assert.equal(strictToolSchema({...schema,required:['conversationId','missing']}),false);
  const calls=[];
  const declaration={id:'conversation.read',title:'Read conversation',kind:'query',audiences:['admin','app'],
    actors:['user'],context:'required',permissions:[{moduleId:'creezio.conversations',kind:'permission',id:'use'}],
    approval:{mode:'none'},effects:{reads:[],writes:[],emits:[],calls:[],providers:[]}};
  const registry={resolve(_moduleId,id){return {declaration:{...declaration,id}};}};
  const data={async authorize(_credential,target,owner){calls.push({target,owner});
    if(owner.moduleId==='denied.module')throw new Error('forbidden');return {kind:'data-lease'};},dispose(){}};
  const catalog=[{moduleId:'creezio.conversations',operationId:'conversation.read',inputSchema:schema,
    schemaDigest:'sha256-'+'a'.repeat(64),audiences:['admin']},
  {moduleId:'denied.module',operationId:'conversation.read',inputSchema:schema,
    schemaDigest:'sha256-'+'b'.repeat(64),audiences:['admin']},
  {moduleId:'creezio.conversations',operationId:'request.list',inputSchema:optional,
    schemaDigest:'sha256-'+'c'.repeat(64),audiences:['admin']},
  {moduleId:'creezio.conversations',operationId:'malformed.read',inputSchema:{...optional,
    required:['limit','missing']},schemaDigest:'sha256-'+'d'.repeat(64),audiences:['admin']},
  {moduleId:'creezio.conversations',operationId:'reference.read',inputSchema:{...optional,
    $ref:'#/definitions/list'},schemaDigest:'sha256-'+'e'.repeat(64),audiences:['admin']}];
  const result=await projectAuthorizedReadTools({catalog,registry,data,
    request:{credential:{kind:'session',token:'opaque'},contextId:'ctx',audience:'admin'}});
  assert.equal(result.tools.length,2);
  assert.equal(result.tools[0].provider.bindingId,'creezio.conversations:conversation.read');
  assert.equal(result.tools[0].provider.name.length,64);
  assert.equal(JSON.stringify(result.tools[0].provider.parameters),JSON.stringify(schema));
  assert.equal(result.tools[0].provider.strict,true);
  assert.equal(result.tools[1].provider.bindingId,'creezio.conversations:request.list');
  assert.equal(result.tools[1].provider.strict,false);
  assert.equal(JSON.stringify(result.tools[1].provider.parameters),JSON.stringify(optional));
  assert.equal(calls.length,3);
  assert.ok(result.diagnostics.includes('denied.module:conversation.read:forbidden'));
  assert.ok(result.diagnostics.includes('creezio.conversations:malformed.read:unsupported_schema'));
  assert.ok(result.diagnostics.includes('creezio.conversations:reference.read:unsupported_schema'));
});
