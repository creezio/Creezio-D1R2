import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {buildSync} from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {createVaultKeyring} from '../../core/vault/crypto.ts';
import {createWebhookProofAuthority} from '../../core/connectors/webhook-proof.ts';
import {createVaultedWebhookResolver} from '../../core/connectors/webhook-resolver.ts';
import {createSignedWebhookBridge} from '../../core/connectors/webhook-http.ts';
import {granolaWebhookInput} from '../../extensions/connectors/granola/module/webhook.ts';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {compileWidgetCatalog} from '../../scripts/widgets/compile.mjs';
import {compileMcpBindings} from '../../scripts/mcp/bindings.mjs';
import * as handlers from '../../extensions/connectors/granola/module/operations.ts';
import {granolaConnectorDescriptor} from '../../extensions/connectors/granola/module/storage.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/connectors/granola/module/manifest.json'),moduleId=manifest.identity.id;
const digest=`sha256-${'7'.repeat(64)}`,noteId='not_1d3tmYTlCICgjy',folderId='fol_4y6LduVdwSKC27';
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,models:manifest.contracts.models.map(model=>({
    modelId:model.id,table:generated.tables[model.id],model}))}]};
const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[moduleId]}}};
function registry(){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},names=new Map();
  for(const [index,item] of manifest.contracts.schemas.entries()){
    const name=`schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
  }
  const operationCatalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
    version:manifest.identity.version,enabled:true,
    schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
      inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))}]};
  return createOperationRegistry({catalog:operationCatalog,validators,
    handlers:Object.fromEntries(manifest.contracts.operations.map(op=>
      [`${moduleId}:${op.id}`,handlers[op.handler.export]]))});
}
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const success=value=>{assert.equal(value.execution?.state,'succeeded',JSON.stringify(value));return value.execution.output;};
const failed=async(promise,code)=>{
  const value=await promise.catch(error=>error);
  assert.notEqual(value.execution?.state,'succeeded');
  assert.equal(value.code??value.execution?.errorCode,code,JSON.stringify(value));
};
const note={id:noteId,object:'note',title:'Réunion',owner:{name:'Alice',email:'private@example.invalid'},
  created_at:'2026-01-27T15:30:00Z',updated_at:'2026-01-27T16:45:00Z'};
const notes=[note,...Array.from({length:7},(_,index)=>({...note,
  id:`not_z${String(index+1).padStart(13,'0')}`,title:`Réunion ${index+1}`}))];

test('Granola fixed GET, D1 context/generation and HTTP access use the shared operation engine',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-granola-integration'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Granola qualification password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,
        loginIdentifier:'granola-owner@example.invalid',displayName:'Granola owner',password}));
      const admin=good(await accounts.login({loginIdentifier:'granola-owner@example.invalid',password,audience:'admin'}));
      const app=good(await accounts.login({loginIdentifier:'granola-owner@example.invalid',password,audience:'app'}));
      const machines=createMachineAccountService(db,{permissions});
      const machine=good(await machines.createService(admin.token,{displayName:'Granola webhook receiver'})).principal;
      const acl=createAuthorizationService(db,{permissions});
      const before=good(await acl.readPolicy(admin.token)),policy=structuredClone(before.policy);
      policy.roles.push({id:'granola-admin',inherits:[],permissionIds:[`${moduleId}:manage`,`${moduleId}:read`],
        permissionOverrides:[]},{id:'granola-reader',inherits:[],permissionIds:[`${moduleId}:read`],
        permissionOverrides:[]});
      policy.contexts.push({id:'other',status:'active'});
      for(const [principalId,audience,contextId,roleId] of [
        [owner.principalId,'admin','application','granola-admin'],
        [owner.principalId,'app','application','granola-reader'],
        [owner.principalId,'app','other','granola-reader'],
        [machine.id,'admin','application','granola-admin']]){
        if(!policy.memberships.some(item=>item.principalId===principalId&&item.audience===audience&&item.contextId===contextId))
          policy.memberships.push({principalId,audience,contextId,status:'active'});
        policy.assignments.push({principalId,audience,contextId,roleId});
      }
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const serviceToken=good(await machines.issueToken(admin.token,{principalId:machine.id,
        label:'Granola webhook service test',ttlMs:60000,
        scopes:[{contextId:'application',audience:'admin',permissionIds:[`${moduleId}:manage`]}]})).token;
      const keyring=createVaultKeyring({activeKeyId:'granola-test',keys:{'granola-test':new Uint8Array(32).fill(23)}});
      const requests=[];let detailState='ok';
      const fetcher=async(url,init)=>{
        const parsed=new URL(url);requests.push({url:String(url),method:init.method,
          redirect:init.redirect,credential:init.headers.get('Authorization')});
        if(parsed.pathname==='/v1/notes')return Response.json({notes,hasMore:false,cursor:null});
        if(parsed.pathname==='/v1/folders')return Response.json({folders:[{id:folderId,object:'folder',
          name:'Équipe',parent_folder_id:null}],hasMore:false,cursor:null});
        if(parsed.pathname===`/v1/notes/${noteId}`&&detailState==='missing')return new Response(null,{status:404});
        if(parsed.pathname===`/v1/notes/${noteId}`&&detailState==='limited')return new Response(null,{status:429});
        if(parsed.pathname===`/v1/notes/${noteId}`)return Response.json({...note,
          web_url:'https://notes.granola.ai/d/example',folder_membership:[{id:folderId}],
          summary_text:'Résumé accessible',private_notes_text:'never-project'});
        if(parsed.pathname===`/v1/notes/${noteId}/transcript`)return Response.json({transcript:[{
          speaker:{name:'Alice'},text:'Bonjour',start_time:'2026-01-27T15:30:00Z',
          end_time:'2026-01-27T15:30:01Z'}],hasMore:false,cursor:null});
        if(parsed.pathname===`/v1/notes/${notes[1].id}/transcript`)
          return Response.json({transcript:[],hasMore:false,cursor:null});
        return new Response(null,{status:404});
      };
      const registered=registry(),proof=createWebhookProofAuthority(),
        engine=createOperationEngine({db,catalog,registry:registered,permissions,webhooks:proof,
        connectors:[{descriptor:granolaConnectorDescriptor,keyring,fetcher}]});
      const invoke=(operationId,input,{token=admin.token,audience='admin',contextId='application'}={})=>
        engine.invoke({credential:{kind:'session',token},moduleId,operationId,contextId,audience,input});
      const cfg=success(await invoke('config.set',{requestKey:'config',enabled:false,revision:0})).config;
      assert.equal(cfg.revision,1);
      const keyed=success(await invoke('config.key.set',{requestKey:'key',apiKey:'synthetic-key',revision:1})).config;
      assert.equal(keyed.hasKey,true);
      const secretRow=await db.prepare(`SELECT ciphertext FROM "${generated.tables.connector_secret}" WHERE context_id=?`)
        .bind('application').first();
      assert.doesNotMatch(JSON.stringify(secretRow),/synthetic-key/u);
      success(await invoke('config.set',{requestKey:'enable',enabled:true,revision:2}));
      const started=success(await invoke('sync.start',{requestKey:'start',collection:'notes',
        runId:'run-notes',revision:0})).state;
      assert.equal(started.revision,1);
      const pageResult=await invoke('sync.page',{requestKey:'page',collection:'notes',
        runId:'run-notes',cursor:null,expectedRevision:1,limit:8});
      assert.equal(pageResult.execution?.state,'succeeded',JSON.stringify({pageResult,requests}));
      const page=success(pageResult);
      assert.equal(page.processed,8);
      assert.equal(success(await invoke('note.list',{limit:25},{token:app.token,audience:'app'})).items[0].id,noteId);
      assert.deepEqual(success(await invoke('note.list',{limit:25},{token:app.token,audience:'app',contextId:'other'})).items,[]);
      await failed(invoke('config.read',{}, {token:app.token,audience:'app'}),'forbidden');
      const detail=success(await invoke('note.refresh',{requestKey:'refresh',id:noteId})).note;
      assert.equal(detail.summary_text,'Résumé accessible');
      assert.doesNotMatch(JSON.stringify(detail),/never-project|private@example/u);
      const transcript=success(await invoke('transcript.page',{id:noteId,cursor:null,limit:25},
        {token:app.token,audience:'app'}));
      assert.equal(transcript.segments[0].text,'Bonjour');
      assert.equal(transcript.note_id,noteId);
      const emptyTranscript=success(await invoke('transcript.page',{id:notes[1].id,cursor:null,limit:25},
        {token:app.token,audience:'app'}));
      assert.deepEqual(emptyTranscript.segments,[]);
      assert.equal(emptyTranscript.note_id,notes[1].id);
      await failed(invoke('transcript.page',{id:noteId,cursor:null,limit:25},
        {token:app.token,audience:'app',contextId:'other'}),'not_found');
      detailState='limited';
      await failed(invoke('note.refresh',{requestKey:'refresh-ambiguous',id:noteId}),'unavailable');
      assert.equal(success(await invoke('note.detail',{id:noteId},
        {token:app.token,audience:'app'})).note.id,noteId);
      detailState='missing';
      const removed=success(await invoke('note.refresh',{requestKey:'refresh-absent',id:noteId}));
      assert.equal(removed.removed,true);
      assert.equal(removed.note,null);
      await failed(invoke('note.detail',{id:noteId},{token:app.token,audience:'app'}),'not_found');
      assert.equal(success(await invoke('note.list',{limit:25},
        {token:app.token,audience:'app'})).items.some(row=>row.id===noteId),false);
      assert.ok(requests.every(row=>row.method==='GET'&&row.redirect==='manual'
        &&row.url.startsWith('https://public-api.granola.ai/v1/')
        &&row.credential==='Bearer synthetic-key'));
      const httpBindings=compileHttpBindings({composition,modules:[manifest],operationCatalog:registered.catalog});
      const http=createOperationHttpTransport(httpBindings,engine),origin='https://creezio.example.invalid';
      const response=await http.dispatch(new Request(origin+'/api/app/granola/note/list?limit=25',
        {headers:{cookie:`__Host-creezio-app=${app.token}`,'x-creezio-context':'application'}}),
      {profile:'sites',bindings:{DB:db}},
      {CREEZIO_APP_ORIGIN:origin},'granola-http');
      assert.equal(response.status,200,await response.clone().text());
      const widgetCatalog=compileWidgetCatalog({composition,modules:[manifest],
        operationCatalog:registered.catalog,
        readAsset:(_id,path)=>readFileSync(new URL(`../../extensions/connectors/granola/${path}`,
          import.meta.url),'utf8'),
        bundleRenderer:(_id,reference)=>buildSync({entryPoints:[fileURLToPath(new URL(
          `../../extensions/connectors/granola/${reference.path}`,import.meta.url))],bundle:true,
          write:false,platform:'browser',format:'iife',globalName:'__creezioWidget',target:'es2022',
          minify:true,footer:{js:`__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
      const mcpBindings=compileMcpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog,widgetCatalog});
      assert.deepEqual(widgetCatalog.widgets.map(item=>item.widgetId).sort(),
        ['notes','summary','sync','transcript']);
      assert.ok(mcpBindings);
      const signingSecret='whsec_'+Buffer.alloc(32,7).toString('base64');
      const latest=success(await invoke('config.read',{})).config;
      const signed=success(await invoke('config.key.webhook.set',{requestKey:'webhook-secret',
        webhookSecret:signingSecret,revision:latest.revision})).config;
      const serviced=success(await invoke('config.key.webhook.service.set',{requestKey:'webhook-service',
        serviceToken,revision:signed.revision})).config;
      const resolver=createVaultedWebhookResolver({db,catalog,keyring,contextId:'application',
        connectors:[granolaConnectorDescriptor],mappings:[{moduleId,operationId:'event.receive',
          path:'/api/webhooks/granola',map:granolaWebhookInput}]});
      const bridge=createSignedWebhookBridge({engine,proof,resolve:resolver});
      const binding={moduleId,operationId:'event.receive',path:'/api/webhooks/granola',
        audience:'admin',auth:['webhook-signature']};
      const eventId='8f1c2a4e-6b3d-4e8f-9a2b-1c5d7e9f0a3b',timestamp=String(Math.floor(Date.now()/1000));
      const body=JSON.stringify({event_id:eventId,event_type:'note.generated',note_id:noteId,
        occurred_at:'2026-01-27T15:30:00Z'});
      const signature=createHmac('sha256',Buffer.from(signingSecret.slice(6),'base64'))
        .update(`${eventId}.${timestamp}.${body}`).digest('base64');
      await failed(engine.invoke({credential:{kind:'api-token',token:serviceToken},moduleId,
        operationId:'event.receive',contextId:'application',audience:'admin',
        input:granolaWebhookInput(JSON.parse(body),eventId,'a'.repeat(64))}),'forbidden');
      const deliver=(value=signature)=>bridge.dispatch(new Request(origin+'/api/webhooks/granola',{
        method:'POST',headers:{'content-type':'application/json','webhook-id':eventId,
          'webhook-timestamp':timestamp,'webhook-signature':`v1,${value}`},body}),binding);
      assert.equal((await deliver('invalid')).status,401);
      assert.equal((await deliver()).status,204);
      assert.equal((await deliver()).status,204);
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM "${generated.tables.webhook_event}" WHERE context_id=?`)
        .bind('application').first()).n,1);
      const revoked=success(await invoke('config.key.webhook.revoke',{requestKey:'webhook-revoke',
        revision:serviced.revision})).config;
      assert.equal((await deliver()).status,503);
      const signingA=success(await invoke('config.key.webhook.set',{requestKey:'webhook-sign-a',
        webhookSecret:signingSecret,revision:revoked.revision})).config;
      const signingB=success(await invoke('config.key.webhook.set',{requestKey:'webhook-sign-b',
        webhookSecret:signingSecret,revision:signingA.revision})).config;
      const rotated=success(await invoke('config.key.set',{requestKey:'api-key-rotate',
        apiKey:'synthetic-key-two',revision:signingB.revision})).config;
      assert.equal(rotated.hasWebhookSecret,false);
      assert.equal(rotated.hasWebhookService,false);
      assert.equal(rotated.enabled,false);
    }finally{await runtime.dispose();}
});
