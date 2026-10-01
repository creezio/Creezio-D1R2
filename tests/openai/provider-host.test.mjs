import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('connector GET queries require a matching declared provider and fresh search authority',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../extensions/connectors/meili/module/manifest.json',import.meta.url),'utf8'));
  const search=manifest.contracts.operations.find(item=>item.id==='index.search');
  const command=manifest.contracts.operations.find(item=>item.id==='index.emit');
  const schema=manifest.contracts.schemas.find(item=>item.id===search.input.schemaId).schema;
  const digest='sha256-'+'a'.repeat(64),moduleId='creezio.meili';
  const external={...search,id:'external.read',effects:{...search.effects,providers:['openai.responses.v1']}};
  const declarations=new Map([[search.id,search],[command.id,command],[external.id,external]]);
  const catalog=[search,command,external].map(item=>({moduleId,operationId:item.id,
    inputSchema:schema,schemaDigest:digest,audiences:['admin']}));
  const connectors=[{moduleId,id:'meili.api.v1',resources:[{id:'search',method:'GET'}]}];
  let revoked=false;
  const options={catalog,registry:{resolve(_moduleId,id){return {declaration:declarations.get(id),contractDigest:digest};}},
    data:{async authorize(){if(revoked)throw new Error('revoked');return {};},dispose(){}},
    request:{credential:{kind:'session',token:'opaque'},contextId:'ctx',audience:'admin'}};
  const admitted=await projectAuthorizedReadTools({...options,connectors});
  assert.deepEqual(admitted.tools.map(item=>item.operationId),['index.search']);
  assert.equal(admitted.tools[0].provider.strict,false);
  assert.equal(JSON.stringify(admitted.tools[0].provider.parameters),JSON.stringify(schema));
  assert.deepEqual(admitted.diagnostics,[]);
  const widget={moduleId,widgetId:'search-results',version:'1.0.0',resourceDigest:digest,
    toolName:'meili_index_search',operationDigest:digest};
  const widgets={widgets:[{...widget,audiences:['admin'],permissions:[],renderTools:[{
    toolName:widget.toolName,operationModuleId:moduleId,operationId:search.id,
    operationDigest:digest,audiences:['admin']}]}]};
  const aliased=await projectAuthorizedReadTools({...options,catalog:[{...catalog[0],widget}],
    connectors,widgets});
  assert.deepEqual(aliased.tools.map(item=>item.provider.name),['meili_index_search']);
  assert.deepEqual(aliased.diagnostics,[]);
  assert.equal((await projectAuthorizedReadTools(options)).tools.length,0);
  assert.equal((await projectAuthorizedReadTools({...options,connectors:[{...connectors[0],
    resources:[{id:'search',method:'POST'}]}]})).tools.length,0);
  assert.equal((await projectAuthorizedReadTools({...options,connectors:[{...connectors[0],
    moduleId:'other.module'}]})).tools.length,0);
  revoked=true;
  const denied=await projectAuthorizedReadTools({...options,connectors});
  assert.equal(denied.tools.length,0);
  assert.deepEqual(denied.diagnostics,['creezio.meili:index.search:forbidden']);
});

test('tool projection admits reads past sixteen and reports only authorized count omissions',async()=>{
  const schema={type:'object',properties:{},required:[],additionalProperties:false};
  const digest='sha256-'+'a'.repeat(64);
  const catalog=Array.from({length:131},(_,index)=>({moduleId:'creezio.conversations',
    operationId:`read${index}`,inputSchema:schema,schemaDigest:digest,audiences:['admin']}));
  const registry={resolve(_moduleId,id){return {declaration:{id,title:`Read ${id}`,kind:'query',
    audiences:['admin'],actors:['user'],permissions:[],approval:{mode:'none'},
    effects:{reads:[],writes:[],emits:[],calls:[],providers:[]}}};}};
  const data={async authorize(_credential,_target,{moduleId}){
    if(moduleId==='creezio.conversations'&&this.reads++===0)throw new Error('forbidden');
    return {};
  },reads:0,dispose(){}};
  const options={catalog,registry,data,request:{credential:{kind:'session',token:'opaque'},
    contextId:'ctx',audience:'admin'}};
  const first=await projectAuthorizedReadTools(options);
  assert.equal(first.tools.length,128);
  assert.equal(first.tools[0].operationId,'read1');
  assert.equal(first.tools[127].operationId,'read128');
  assert.equal(first.diagnostics.filter(item=>item==='catalog:count_limit').length,2);
  assert.equal(first.diagnostics.filter(item=>item.endsWith(':forbidden')).length,1);
  data.reads=0;
  const second=await projectAuthorizedReadTools(options);
  assert.deepEqual(second.tools.map(item=>item.provider.name),first.tools.map(item=>item.provider.name));
  assert.deepEqual(second.diagnostics,first.diagnostics);
  data.reads=0;
  const exact=await projectAuthorizedReadTools({...options,catalog:catalog.slice(0,129)});
  assert.equal(exact.tools.length,128);
  assert.equal(exact.diagnostics.includes('catalog:count_limit'),false);
});

test('tool projection enforces exact OpenAI tools JSON bytes and carries bounded output annotations',async()=>{
  const schema={type:'object',properties:{key:{type:'string',enum:['é'.repeat(3500)]}},
    required:['key'],additionalProperties:false};
  const digest='sha256-'+'b'.repeat(64);
  const catalog=Array.from({length:20},(_,index)=>({moduleId:'creezio.conversations',
    operationId:`read${index}`,inputSchema:schema,schemaDigest:digest,audiences:['admin'],
    ...(index===0?{outputDescription:'request.amountMinor: Value in minor currency units.'}
      :index===1?{outputDescription:'x'.repeat(1000)}:{})}));
  const registry={resolve(_moduleId,id){return {declaration:{id,title:'Read request',kind:'query',
    audiences:['admin'],actors:['user'],permissions:[],approval:{mode:'none'},
    effects:{reads:[],writes:[],emits:[],calls:[],providers:[]}}};}};
  const data={async authorize(){return {};},dispose(){}};
  const result=await projectAuthorizedReadTools({catalog,registry,data,
    request:{credential:{kind:'session',token:'opaque'},contextId:'ctx',audience:'admin'}});
  const payload=result.tools.map(({provider})=>({type:'function',name:provider.name,
    description:provider.description,parameters:provider.parameters,strict:provider.strict??true}));
  assert.ok(result.tools.length>0&&result.tools.length<20);
  assert.ok(Buffer.byteLength(JSON.stringify(payload))<=64*1024);
  assert.ok(Buffer.byteLength(JSON.stringify([...payload,payload[0]]))>64*1024);
  assert.equal(result.diagnostics.filter(item=>item==='catalog:byte_limit').length,20-result.tools.length);
  assert.match(result.tools[0].provider.description,/request\.amountMinor: Value in minor currency units\./);
  assert.ok(Buffer.byteLength(result.tools[0].provider.description)<=1024);
  assert.equal(result.tools[1].provider.description,'Read request');
  assert.doesNotMatch(result.tools[1].provider.description,/minor|currency/i);
});

test('catalogue scan bound is visible without claiming authorization of uninspected entries',async()=>{
  const catalog=Array.from({length:1001},()=>({moduleId:'invalid module',operationId:'read',
    inputSchema:{},schemaDigest:'sha256-'+'a'.repeat(64),audiences:['admin']}));
  const result=await projectAuthorizedReadTools({catalog,registry:{resolve(){throw new Error('unexpected');}},
    data:{async authorize(){throw new Error('unexpected');},dispose(){}},
    request:{credential:{kind:'session',token:'opaque'},contextId:'ctx',audience:'admin'}});
  assert.equal(result.tools.length,0);
  assert.equal(result.diagnostics[0],'catalog:catalog_limit');
  assert.equal(result.diagnostics.length,1001);
  assert.equal(result.diagnostics.filter(item=>item==='catalog:count_limit').length,0);
});
