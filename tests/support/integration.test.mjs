import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {compileMcpBindings} from '../../scripts/mcp/bindings.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {createMcpHttpTransport} from '../../core/mcp/http.ts';
import * as handlers from '../../extensions/native/support/module/operations.ts';

const json=file=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const manifest=json('../../extensions/native/support/module/manifest.json');
const moduleId=manifest.identity.id,digest=`sha256-${'d'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,
  models:manifest.contracts.models.map(model=>({modelId:model.id,table:generated.tables[model.id],model}))}]};
const composition={modules:[{moduleId,enabled:true}],
  exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[moduleId]}}};
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
    handlers:Object.fromEntries(manifest.contracts.operations.map(operation=>
      [`${moduleId}:${operation.id}`,handlers[operation.handler.export]]))});
}
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const succeeded=value=>{assert.equal(value.execution?.state,'succeeded',JSON.stringify(value));return value.execution.output;};
const refused=async(call,code)=>{const value=await call.catch(error=>error);
  assert.equal(value.code??value.execution?.errorCode,code,JSON.stringify(value));};

test('Support app/admin/machine share only authorized tickets and revisioned messages in real D1',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-support-integration'},d1Persist:false});
    let client;
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Support integration password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'support-owner@example.invalid',
        displayName:'Support owner',password}));
      const ownerAdmin=good(await accounts.login({loginIdentifier:'support-owner@example.invalid',password,audience:'admin'}));
      const ownerApp=good(await accounts.login({loginIdentifier:'support-owner@example.invalid',password,audience:'app'}));
      const lifecycle=createAccountLifecycleService(db,{permissions});
      const invitation=good(await lifecycle.issueInvitation(ownerAdmin.token,
        {loginIdentifier:'support-client@example.invalid',displayName:'Support client'}));
      const customer=good(await lifecycle.redeem({token:invitation.token,purpose:'invitation',password}));
      const customerApp=good(await accounts.login({loginIdentifier:'support-client@example.invalid',password,audience:'app'}));
      const machines=createMachineAccountService(db,{permissions});
      const machine=good(await machines.createService(ownerAdmin.token,{displayName:'Support bot'})).principal;
      const acl=createAuthorizationService(db,{permissions});
      const before=good(await acl.readPolicy(ownerAdmin.token)),policy=structuredClone(before.policy);
      policy.roles.push({id:'support-request',inherits:[],permissionIds:[`${moduleId}:use`],permissionOverrides:[]});
      policy.roles.push({id:'support-agent',inherits:[],permissionIds:[`${moduleId}:use`,`${moduleId}:manage`],permissionOverrides:[]});
      for(const [principalId,audience,roleId] of [[owner.principalId,'admin','support-agent'],
        [owner.principalId,'app','support-request'],[customer.principalId,'app','support-request'],
        [machine.id,'app','support-request']]){
        if(!policy.memberships.some(row=>row.principalId===principalId&&row.audience===audience&&row.contextId==='application'))
          policy.memberships.push({principalId,audience,contextId:'application',status:'active'});
        policy.assignments.push({principalId,audience,contextId:'application',roleId});
      }
      good(await acl.replacePolicy(ownerAdmin.token,{expectedEpoch:before.epoch,policy}));
      const apiToken=good(await machines.issueToken(ownerAdmin.token,{principalId:machine.id,
        label:'Support integration',ttlMs:60000,scopes:[{contextId:'application',audience:'app',
          permissionIds:[`${moduleId}:use`]}]})).token;
      const engine=createOperationEngine({db,catalog,registry:registry(),permissions});
      const invoke=(operationId,input,credential={kind:'session',token:customerApp.token},audience='app')=>
        engine.invoke({credential,moduleId,operationId,contextId:'application',audience,input});
      const created=succeeded(await invoke('ticket.create',{requestKey:'customer-ticket',subject:'Impression bloquée',
        body:'Bonjour, erreur imprimante'})).item;
      assert.equal(created.messageCount,1);
      await refused(invoke('ticket.read',{id:created.id},{kind:'session',token:ownerApp.token}),'not_found');
      assert.deepEqual(succeeded(await invoke('ticket.list',{limit:25},
        {kind:'session',token:ownerApp.token})).items,[]);
      assert.equal(succeeded(await invoke('ticket.read',{id:created.id},
        {kind:'session',token:ownerAdmin.token},'admin')).item.subject,created.subject);
      const reply=succeeded(await invoke('message.reply',{requestKey:'agent-reply',ticketId:created.id,
        revision:created.revision,body:'Nous vérifions'},
        {kind:'session',token:ownerAdmin.token},'admin'));
      assert.equal(reply.ticket.status,'repondu');
      const thread=succeeded(await invoke('message.list',{ticketId:created.id,limit:50})).items;
      assert.equal(thread.length,2);
      assert.equal(thread[0].id,reply.item.id);
      assert.equal(thread[0].authorId,'support');
      await refused(invoke('message.customer',{requestKey:'stale',ticketId:created.id,revision:1,
        body:'Ancien'}),'conflict');
      const reopened=succeeded(await invoke('message.customer',{requestKey:'client-reopen',ticketId:created.id,
        revision:reply.ticket.revision,body:'Toujours bloqué'})).ticket;
      assert.equal(reopened.status,'ouvert');
      const claimed=succeeded(await invoke('ticket.claim',{requestKey:'claim',id:created.id,
        revision:reopened.revision,claim:true},{kind:'session',token:ownerAdmin.token},'admin')).item;
      assert.equal(claimed.assignedTo,owner.principalId);
      await refused(invoke('ticket.status',{requestKey:'no-admin',id:created.id,revision:claimed.revision,
        status:'ferme'}),'forbidden');
      const escaped='"'.repeat(4000);
      let longTicket=succeeded(await invoke('ticket.create',{requestKey:'long-ticket',subject:'Long fil',body:escaped})).item;
      for(let index=0;index<35;index++){
        longTicket=succeeded(await invoke('message.customer',{requestKey:`long-${index}`,
          ticketId:longTicket.id,revision:longTicket.revision,body:escaped})).ticket;
      }
      const seen=new Set();let pageCursor=null,firstPage=true;
      do{
        const page=succeeded(await invoke('message.list',{ticketId:longTicket.id,limit:50,
          ...(pageCursor?{cursor:pageCursor}:{})}));
        assert.ok(new TextEncoder().encode(JSON.stringify(page)).length<181_000);
        if(firstPage){assert.ok(page.items.length<36);firstPage=false;}
        for(const item of page.items){assert.equal(seen.has(item.id),false);seen.add(item.id);}
        pageCursor=page.nextCursor;
      }while(pageCursor);
      assert.equal(seen.size,36);
      const botTicket=succeeded(await invoke('ticket.create',{requestKey:'bot-ticket',subject:'Automate',body:''},
        {kind:'api-token',token:apiToken})).item;
      assert.equal(succeeded(await invoke('ticket.list',{limit:25},{kind:'api-token',token:apiToken})).items[0].id,botTicket.id);
      await refused(invoke('ticket.read',{id:created.id},{kind:'api-token',token:apiToken}),'not_found');
      const registered=registry(),origin='https://support.example.invalid';
      const http=createOperationHttpTransport(compileHttpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog}),engine);
      const wire=(path,body,token=apiToken)=>http.dispatch(new Request(origin+path,{
        method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,
          'x-creezio-context':'application',...(body?{'content-type':'application/json','x-creezio-request':'1'}:{})},
        ...(body?{body:JSON.stringify(body)}:{})}),{profile:'sites',bindings:{DB:db}},
        {CREEZIO_APP_ORIGIN:origin},'support-transport');
      const httpList=await wire('/api/app/support/ticket/list?limit=25');
      assert.equal(httpList.status,200,await httpList.clone().text());
      assert.equal(succeeded(await httpList.json()).items[0].id,botTicket.id);
      const mcp=createMcpHttpTransport(compileMcpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog}),registered,engine,{origin,
        resourceMetadataUrl:audience=>`${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
        authenticate:async(request,audience)=>{
          const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'');
          const checked=await machines.check(bearer,{contextId:'application',audience,actors:['machine'],
            requiredPermissionIds:[`${moduleId}:use`],purpose:'operation'});
          return checked.allowed?{credential:{kind:'api-token',token:bearer},contextId:'application'}:null;
        },canDiscover:async(identity,target)=>(await machines.check(identity.credential.token,{
          contextId:target.contextId,audience:target.audience,actors:target.actors,
          requiredPermissionIds:target.permissionIds,purpose:'operation'})).allowed});
      client=new Client({name:'support-native-integration',version:'1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/app'),{
        authProvider:{token:async()=>apiToken},fetch:(input,init)=>mcp.dispatch(new Request(input,init),'app','support-mcp')}));
      const tools=(await client.listTools()).tools;
      assert.ok(tools.some(tool=>tool.name==='support_ticket_read'));
      assert.ok(tools.every(tool=>tool.name!=='support_message_reply'));
      const mcpRead=await client.callTool({name:'support_ticket_read',arguments:{id:botTicket.id}});
      assert.equal(mcpRead.structuredContent.item.subject,'Automate');
      const latest=good(await acl.readPolicy(ownerAdmin.token)),revoked=structuredClone(latest.policy);
      revoked.assignments=revoked.assignments.filter(row=>row.principalId!==machine.id);
      good(await acl.replacePolicy(ownerAdmin.token,{expectedEpoch:latest.epoch,policy:revoked}));
      await refused(invoke('ticket.list',{limit:25},{kind:'api-token',token:apiToken}),'forbidden');
      assert.equal((await wire('/api/app/support/ticket/list?limit=25')).status,403);
      await assert.rejects(client.callTool({name:'support_ticket_read',arguments:{id:botTicket.id}}));
      assert.equal(succeeded(await invoke('ticket.read',{id:created.id})).item.revision,claimed.revision);
    }finally{if(client)await client.close();await runtime.dispose();}
  });
