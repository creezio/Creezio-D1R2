import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createVaultKeyring,createVaultReference} from '../../core/vault/crypto.ts';
import {n8nConnectorDescriptor} from '../../extensions/connectors/n8n/module/storage.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/connectors/n8n/module/manifest.json');
const moduleId=manifest.identity.id,connectorId=n8nConnectorDescriptor.id,digest=`sha256-${'9'.repeat(64)}`;
const ref=(kind,id)=>({moduleId,kind,id});
const field=(id,type,{protected:privateField=false,nullable=false,constraints}={})=>({id,type,protected:privateField,
  nullable,computed:false,...(constraints?{constraints}:{})});
const projection={id:'projection',title:'Page projetée',scope:'context',contextField:'context_id',
  fields:[field('context_id','string',{protected:true}),field('id','string'),field('value','string')],
  primaryKey:['context_id','id'],indexes:[],relations:[],permissions:[ref('permission','manage')],
  deletion:{mode:'soft',requiresApproval:false},public:false};
const models=[...manifest.contracts.models,projection];
const modulePermissions=manifest.contracts.permissions.map(item=>item.id==='manage'
  ?{...item,resources:[...item.resources,ref('model','projection')]}:item);
const generated=generateD1Schema(moduleId,models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=modulePermissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:modulePermissions,models:models.map(model=>({modelId:model.id,
    table:generated.tables[model.id],model}))}]};
const operation={id:'sync.page',title:'Projeter un GET',kind:'command',input:{schemaId:'sync-input'},
  output:{schemaId:'sync-output'},permissions:[ref('permission','manage')],audiences:['admin'],actors:['user'],
  context:'required',handler:{path:'tests/connectors/command-commit.test.mjs',export:'syncPage'},
  effects:{reads:[ref('model','connector_config'),ref('model','connector_secret')],
    writes:[ref('model','projection')],emits:[],calls:[],providers:[connectorId]},
  errors:['invalid_input','forbidden','unavailable','unknown','conflict'].map(code=>({code,
    retryable:code==='unavailable'||code==='unknown',outcome:code==='unknown'?'unknown':'rejected'})),
  pagination:{mode:'none'},idempotency:{mode:'required',keyField:'requestKey',
    scope:'actor-context-operation',retentionSeconds:86400},approval:{mode:'none'},
  concurrency:{mode:'none'},execution:{maxDurationMs:10000,maxItems:4,resumable:false},
  audit:{required:true,redactFields:[]},public:false};
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const terminalOrUnknown=async promise=>{
  try{return await promise;}catch(error){assert.equal(error.code,'unknown');return null;}
};
function gate(){let open;const waiting=new Promise(resolve=>{open=resolve;});return {waiting,open};}

async function fixture({maxItems=4}={}){
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'creezio-connector-command-proof'},d1Persist:false});
  const db=await runtime.getD1Database('DB');
  await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
  const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
  const password='Synthetic connector command proof password';
  const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'connector-proof@example.invalid',
    displayName:'Connector proof owner',password}));
  const admin=good(await accounts.login({loginIdentifier:'connector-proof@example.invalid',password,audience:'admin'}));
  const acl=createAuthorizationService(db,{permissions});
  const before=good(await acl.readPolicy(admin.token)),policy=structuredClone(before.policy);
  policy.roles.push({id:'connector-admin',inherits:[],permissionIds:[`${moduleId}:manage`,`${moduleId}:read`],
    permissionOverrides:[]});
  policy.assignments.push({principalId:owner.principalId,audience:'admin',contextId:'application',
    roleId:'connector-admin'});
  good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
  const keyring=createVaultKeyring({activeKeyId:'proof-key',keys:{'proof-key':new Uint8Array(32).fill(31)}});
  const reference=createVaultReference(),secret='synthetic-remote-secret';
  const ciphertext=await keyring.seal({moduleId,contextId:'application',bindingId:connectorId,
    reference,version:1},secret);
  await db.batch([
    db.prepare(`INSERT INTO "${generated.tables.connector_config}"(context_id,id,origin,key_ref,secret_version,enabled,revision,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind('application',connectorId,'https://n8n.example.invalid',reference,1,1,1,
      '2026-09-29T00:00:00.000Z'),
    db.prepare(`INSERT INTO "${generated.tables.connector_secret}"(context_id,id,binding_id,ciphertext,key_id,version,state)
      VALUES(?,?,?,?,?,?,?)`).bind('application',reference,connectorId,ciphertext,'proof-key',1,'active'),
  ]);
  let calls=0,ready=gate(),release=gate(),hold=false,skipGet=false;
  const handler=async(input,context)=>{
    if(skipGet)return {output:{id:input.id},plans:[context.data.planCreate('projection',
      {values:{id:input.id,value:'untrusted'}})]};
    const remote=await context.connector.request({resource:'workflows',limit:1});
    if(remote.kind!=='ok')throw new Error('GET unavailable');
    if(hold){ready.open();await release.waiting;}
    return {output:{id:input.id},plans:[context.data.planCreate('projection',
      {values:{id:input.id,value:remote.body.data[0].id}})]};
  };
  const declared={...operation,execution:{...operation.execution,maxItems}};
  const registry=createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
    version:manifest.identity.version,enabled:true,
    schemas:[{schemaId:'sync-input',validator:'input'},{schemaId:'sync-output',validator:'output'}],
    operations:[{operation:declared,active:true,contractDigest:digest,inputValidator:'input',outputValidator:'output'}]}]},
    validators:{input:value=>!!value&&typeof value.requestKey==='string'&&typeof value.id==='string',
      output:value=>!!value&&typeof value.id==='string'},handlers:{[`${moduleId}:sync.page`]:handler}});
  const engine=createOperationEngine({db,catalog,registry,permissions,
    connectors:[{descriptor:n8nConnectorDescriptor,keyring,fetcher:async()=>{calls++;
      return Response.json({data:[{id:'wf-1'}]});}}]});
  const invoke=(id,requestKey)=>engine.invoke({credential:{kind:'session',token:admin.token},moduleId,
    operationId:'sync.page',contextId:'application',audience:'admin',input:{id,requestKey}});
  const lookup=requestKey=>engine.lookup({credential:{kind:'session',token:admin.token},moduleId,
    operationId:'sync.page',contextId:'application',audience:'admin',requestKey});
  const projected=id=>db.prepare(`SELECT id,value FROM "${generated.tables.projection}" WHERE context_id=? AND id=?`)
    .bind('application',id).first();
  return {runtime,db,admin,owner,acl,keyring,reference,invoke,lookup,projected,get calls(){return calls;},
    pause(){hold=true;ready=gate();release=gate();return {entered:ready.waiting,resume:release.open};},
    skip(){skipGet=true;}};
}

test('command GET proofs and business projection commit atomically in real D1', {timeout:30000},async()=>{
  const f=await fixture();
  try{
    const completed=await f.invoke('good','proof-good');
    assert.equal(completed.execution.state,'succeeded',JSON.stringify(completed));
    assert.equal((await f.projected('good')).value,'wf-1');
    assert.equal(f.calls,1);
    const replay=await f.invoke('good','proof-good');
    assert.equal(replay.replayed,true);assert.equal(f.calls,1);
    assert.equal((await f.lookup('proof-good')).state,'succeeded');
  }finally{await f.runtime.dispose();}
});

test('config change after remote GET but before D1 commit rolls back projection', {timeout:30000},async()=>{
  const f=await fixture();
  try{
    const pause=f.pause(),pending=f.invoke('stale-config','proof-config');
    await pause.entered;
    await f.db.prepare(`UPDATE "${generated.tables.connector_config}" SET revision=2 WHERE context_id=? AND id=?`)
      .bind('application',connectorId).run();
    pause.resume();
    const result=await terminalOrUnknown(pending);
    assert.notEqual(result?.execution.state,'succeeded');
    assert.equal(await f.projected('stale-config'),null);
    assert.notEqual((await f.lookup('proof-config'))?.state,'succeeded');
    assert.equal((await f.invoke('stale-config','proof-config')).replayed,true);
    assert.equal(f.calls,1);
  }finally{await f.runtime.dispose();}
});

test('vault revocation after remote GET but before D1 commit rolls back projection', {timeout:30000},async()=>{
  const f=await fixture();
  try{
    const pause=f.pause(),pending=f.invoke('stale-key','proof-key');
    await pause.entered;
    await f.db.prepare(`UPDATE "${generated.tables.connector_secret}" SET version=2,state='revoked'
      WHERE context_id=? AND id=?`).bind('application',f.reference).run();
    pause.resume();
    const result=await terminalOrUnknown(pending);
    assert.notEqual(result?.execution.state,'succeeded');
    assert.equal(await f.projected('stale-key'),null);
    assert.notEqual((await f.lookup('proof-key'))?.state,'succeeded');
    assert.equal((await f.invoke('stale-key','proof-key')).replayed,true);
    assert.equal(f.calls,1);
  }finally{await f.runtime.dispose();}
});

test('replacement of the exact key and config version after GET rolls back the old page',
  {timeout:30000},async()=>{
    const f=await fixture();
    try{
      const pause=f.pause(),pending=f.invoke('replaced-key','proof-replaced');
      await pause.entered;
      const ciphertext=await f.keyring.seal({moduleId,contextId:'application',bindingId:connectorId,
        reference:f.reference,version:2},'replacement-secret');
      await f.db.batch([
        f.db.prepare(`UPDATE "${generated.tables.connector_secret}" SET version=2,ciphertext=?
          WHERE context_id=? AND id=?`).bind(ciphertext,'application',f.reference),
        f.db.prepare(`UPDATE "${generated.tables.connector_config}" SET revision=2,secret_version=2
          WHERE context_id=? AND id=?`).bind('application',connectorId),
      ]);
      pause.resume();
      const result=await terminalOrUnknown(pending);
      assert.notEqual(result?.execution.state,'succeeded');
      assert.equal(await f.projected('replaced-key'),null);
      assert.notEqual((await f.lookup('proof-replaced'))?.state,'succeeded');
      assert.equal((await f.invoke('replaced-key','proof-replaced')).replayed,true);
      assert.equal(f.calls,1);
    }finally{await f.runtime.dispose();}
  });

test('permission removed after GET cannot confirm or project the page', {timeout:30000},async()=>{
  const f=await fixture();
  try{
    const pause=f.pause(),pending=f.invoke('revoked-grant','proof-grant');
    await pause.entered;
    const current=good(await f.acl.readPolicy(f.admin.token)),policy=structuredClone(current.policy);
    policy.assignments=policy.assignments.filter(item=>!(item.principalId===f.owner.principalId
      &&item.roleId==='connector-admin'));
    good(await f.acl.replacePolicy(f.admin.token,{expectedEpoch:current.epoch,policy}));
    pause.resume();
    const result=await terminalOrUnknown(pending);
    assert.notEqual(result?.execution.state,'succeeded');
    assert.equal(await f.projected('revoked-grant'),null);
    await assert.rejects(f.lookup('proof-grant'),{code:'forbidden'});
    assert.equal(f.calls,1);
  }finally{await f.runtime.dispose();}
});

test('a declared connector command cannot commit a projection without its successful GET', {timeout:30000},async()=>{
  const f=await fixture();
  try{
    f.skip();
    const result=await f.invoke('skipped','proof-skipped');
    assert.equal(result.execution.state,'failed');
    assert.equal(result.execution.errorCode,'invalid_output');
    assert.equal(await f.projected('skipped'),null);
    assert.equal(f.calls,0);
  }finally{await f.runtime.dispose();}
});

test('host-private proof plans consume the declared operation item budget', {timeout:30000},async()=>{
  const f=await fixture({maxItems:2});
  try{
    const result=await f.invoke('over-budget','proof-budget');
    assert.equal(result.execution.state,'failed');
    assert.equal(result.execution.errorCode,'invalid_input');
    assert.equal(await f.projected('over-budget'),null);
    assert.equal(f.calls,1);
  }finally{await f.runtime.dispose();}
});
