import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {canonicalOrigin,configRead,configSet,configKeySet,configKeyRevoke,connectionCheck,indexList}
  from '../../module/service.ts';
import {meiliConnectorDescriptor} from '../../module/storage.ts';

const row={id:'meili.api.v1',origin:'https://meili.example.invalid',
  key_ref:'creezio-secret:v1:00000000-0000-4000-8000-000000000001',
  secret_version:1,enabled:true,revision:4,updated_at:'2026-09-29T00:00:00.000Z'};
function harness(initial=row,remote={kind:'ok',status:200,body:{results:[],limit:1,offset:0,total:0}}){
  const calls=[];let live=initial;
  return {calls,setRow(value){live=value;},context:{signal:new AbortController().signal,
    data:{async get(name){assert.equal(name,'connector_config');return live;},
      planPatch(name,args){calls.push({name,args});return {kind:'plan'};},
      planCreate(name,args){calls.push({name,args});return {kind:'plan'};}},
    providerSecrets:{async preparePut(args){calls.push({secret:args});return {plan:{kind:'secret-plan'},
      reference:'creezio-secret:v1:00000000-0000-4000-8000-000000000002',version:1};},
      async prepareReplace(args){calls.push({secret:args});return {plan:{kind:'secret-plan'},
        reference:args.reference,version:2};},async prepareRevoke(args){calls.push({revoke:args});
        return {plan:{kind:'secret-plan'},version:2};}},
    connector:{async request(args){calls.push({request:args});return typeof remote==='function'?remote(args):remote;}}}};
}
test('descriptor fixes each Meili read and bounded task-producing write',()=>{
  assert.deepEqual(manifest.contracts.models.map(model=>model.primaryKey),
    Array.from({length:4},()=>['context_id','id']));
  assert.deepEqual(manifest.contracts.connectors,[meiliConnectorDescriptor]);
  assert.deepEqual(meiliConnectorDescriptor.auth,{kind:'bearer'});
  assert.deepEqual(meiliConnectorDescriptor.resources.map(({id,method,path})=>[id,method,path]),[
    ['indexes','GET','/indexes'],['index-list','GET','/indexes'],
    ['document-upsert','POST','/indexes/{id}/documents'],
    ['document-delete','POST','/indexes/{id}/documents/delete-batch'],
    ['task','GET','/tasks/{id}'],['search','GET','/indexes/{id}/search']]);
  assert.deepEqual(meiliConnectorDescriptor.resources.find(item=>item.id==='document-upsert').query,
    {fixed:[{name:'primaryKey',value:'id'}]});
  for(const resource of meiliConnectorDescriptor.resources.filter(item=>item.method==='POST')){
    assert.deepEqual(resource.successStatuses,[202]);
    assert.equal(resource.body.encoding,'json-root');
    assert.equal(resource.body.fields.length,1);
  }
  assert.deepEqual(manifest.contracts.search,[]);
});
test('index listing projects only bounded metadata, paginates and rejects rotation during GET',async()=>{
  const dates={createdAt:'2026-09-29T00:00:00.000Z',updatedAt:'2026-09-30T00:00:00.000Z'};
  const first=harness(row,{kind:'ok',status:200,body:{results:[
    {uid:'one',primaryKey:'id',...dates,documents:[{secret:'never'}]},
    {uid:'two',primaryKey:null,...dates}],offset:0,limit:2,total:3}});
  const page=(await indexList({limit:2},first.context)).output;
  assert.deepEqual(page,{items:[{uid:'one',primaryKey:'id',...dates},
    {uid:'two',primaryKey:null,...dates}],total:3,nextCursor:'2'});
  assert.deepEqual(first.calls[0].request,{resource:'index-list',cursor:'0',limit:2,
    signal:first.context.signal});
  assert.doesNotMatch(JSON.stringify(page),/secret|documents/u);
  const second=harness(row,{kind:'ok',status:200,body:{results:[{uid:'three',primaryKey:'sku',...dates}],
    offset:2,limit:2,total:3}});
  assert.equal((await indexList({cursor:'2',limit:2},second.context)).output.nextCursor,null);
  for(const args of [{cursor:'02'},{cursor:'-1'},{limit:21},{limit:0},{cursor:'100001'}])
    await assert.rejects(indexList(args,harness().context),{code:'invalid_input'});
  const changing=harness(row,async()=>{changing.setRow({...row,revision:5,key_ref:'rotated'});
    return {kind:'ok',status:200,body:{results:[{uid:'hidden',primaryKey:null,...dates}],
      offset:0,limit:1,total:1}};});
  await assert.rejects(indexList({limit:1},changing.context),{code:'conflict'});
  assert.equal(changing.calls.length,1);
  await assert.rejects(indexList({limit:1},harness({...row,enabled:false}).context),{code:'unavailable'});
  for(const body of [{results:[{}],offset:0,limit:1,total:1},
    {results:[],offset:1,limit:1,total:1},{results:[],offset:0,limit:1,total:2}])
    await assert.rejects(indexList({limit:1},harness(row,{kind:'ok',status:200,body}).context),
      {code:'unavailable'});
});
test('configuration URL/CAS and vault plans never return a key or reference',async()=>{
  assert.equal(canonicalOrigin('https://MEILI.example.invalid/'),'https://meili.example.invalid');
  for(const url of ['http://example.com','https://localhost','https://127.0.0.1',
    'https://[::1]','https://user:pass@example.com','https://example.com/path',
    'https://example.com/?x=1'])assert.throws(()=>canonicalOrigin(url),{code:'invalid_input'});
  const empty=harness(null);
  const created=await configSet({requestKey:'a',origin:'https://MEILI.example.invalid/',
    enabled:false,revision:0},empty.context);
  assert.equal(created.output.config.revision,1);
  await assert.rejects(configSet({requestKey:'stale',origin:row.origin,enabled:false,revision:3},
    harness().context),{code:'conflict'});
  await assert.rejects(configSet({requestKey:'new-host',origin:'https://other.example.invalid',
    enabled:false,revision:4},harness().context),{code:'conflict'},
    'disabling does not permit redirecting an existing sealed key');
  const rotated=harness(),secret='synthetic-meili-key';
  const changed=await configKeySet({requestKey:'b',apiKey:secret,revision:4},rotated.context);
  assert.equal(changed.plans.length,2);
  assert.equal(rotated.calls[0].secret.providerId,'meili.api.v1');
  assert.doesNotMatch(JSON.stringify(changed),/synthetic-meili-key|creezio-secret/u);
  const revoked=harness(),after=await configKeyRevoke({requestKey:'c',revision:4},revoked.context);
  assert.equal(after.plans.length,2);assert.equal(after.output.config.enabled,false);
  assert.equal(after.output.config.hasKey,false);
  assert.equal(revoked.calls[1].args.compare.expected,4);
  assert.doesNotMatch(JSON.stringify(await configRead({},harness().context)),/creezio-secret/u);
});
test('probe projects a boolean only, including empty page and remote auth refusal',async()=>{
  for(const body of [{results:[],limit:1,offset:0,total:0},
    {results:[{uid:'never-return',primaryKey:'secret',documents:[{token:'hidden'}]}],
      limit:1,offset:0,total:100000}]){
    const h=harness(row,{kind:'ok',status:200,body});
    const result=await connectionCheck({},h.context);
    assert.deepEqual(result.output,{authenticated:true,status:'connected'});
    assert.deepEqual(h.calls.filter(call=>call.request).map(call=>call.request.resource),['indexes']);
    assert.doesNotMatch(JSON.stringify(result),/uid|primaryKey|token|total|hidden/u);
  }
  const denied=harness(row,{kind:'error',code:'remote_auth',status:401});
  assert.deepEqual((await connectionCheck({},denied.context)).output,
    {authenticated:false,status:'key_rejected'});
  await assert.rejects(connectionCheck({},harness(row,{kind:'error',code:'access_denied'}).context),
    {code:'forbidden'});
  for(const body of [{results:[{},{}],limit:1,offset:0,total:2},
    {results:[],limit:2,offset:0,total:0},{results:[],limit:1,offset:-1,total:0},
    {results:[],limit:1,offset:0,total:NaN}])
    await assert.rejects(connectionCheck({},harness(row,{kind:'ok',status:200,body}).context),
      {code:'unavailable'});
});
