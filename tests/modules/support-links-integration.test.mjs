import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import * as supportHandlers from '../../extensions/native/support/module/operations.ts';
import * as crmHandlers from '../../extensions/native/crm/module/operations.ts';
import * as messagingHandlers from '../../extensions/native/messaging/module/operations.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifests=[
  json('../../extensions/native/support/module/manifest.json'),
  json('../../extensions/native/crm/module/manifest.json'),
  json('../../extensions/native/messaging/module/manifest.json')];
const handlersByModule={'creezio.support':supportHandlers,'creezio.crm':crmHandlers,
  'creezio.messaging':messagingHandlers};
const digest=`sha256-${'e'.repeat(64)}`;
const schemas=new Map(manifests.map(module=>[module.identity.id,
  generateD1Schema(module.identity.id,module.contracts.models)]));
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifests.flatMap(module=>module.contracts.permissions.map(permission=>({
  id:`${module.identity.id}:${permission.id}`,audiences:permission.audiences,actors:permission.actors})));
const catalog={schemaVersion:1,compositionDigest:digest,modules:manifests.map(module=>({
  moduleId:module.identity.id,version:module.identity.version,enabled:true,
  permissions:module.contracts.permissions,models:module.contracts.models.map(model=>({
    modelId:model.id,table:schemas.get(module.identity.id).tables[model.id],model}))}))};
function registry(){
  const ajv=addFormats(new Ajv2020({strict:true,coerceTypes:false,removeAdditional:false}));
  const validators={},handlers={};
  const modules=manifests.map(module=>{
    const moduleId=module.identity.id,names=new Map();
    for(const [index,item] of module.contracts.schemas.entries()){
      const name=`${moduleId.replaceAll('.','_')}_${index}`;
      names.set(item.id,name);validators[name]=ajv.compile(item.schema);
    }
    for(const operation of module.contracts.operations)
      handlers[`${moduleId}:${operation.id}`]=handlersByModule[moduleId][operation.handler.export];
    return {moduleId,version:module.identity.version,enabled:true,
      schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
      operations:module.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
        inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))};
  });
  return createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules},validators,handlers});
}
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const succeeded=value=>{assert.equal(value.execution?.state,'succeeded',JSON.stringify(value));return value.execution.output;};
const refused=async(promise,code)=>{const value=await promise.catch(error=>error);
  assert.equal(value.code??value.execution?.errorCode,code,JSON.stringify(value));};

test('Support links CRM and Messaging through fresh public queries and persists opaque IDs in D1',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-support-links'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,
        ...[...schemas.values()].flatMap(schema=>schema.statements)].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Support links password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,
        loginIdentifier:'support-links@example.invalid',displayName:'Support links',password}));
      const admin=good(await accounts.login({loginIdentifier:'support-links@example.invalid',password,audience:'admin'}));
      const app=good(await accounts.login({loginIdentifier:'support-links@example.invalid',password,audience:'app'}));
      const acl=createAuthorizationService(db,{permissions});
      const initial=good(await acl.readPolicy(admin.token)),policy=structuredClone(initial.policy);
      const all=['creezio.support:use','creezio.crm:use','creezio.messaging:use'];
      policy.roles.push({id:'links-all',inherits:[],permissionIds:all,permissionOverrides:[]});
      if(!policy.memberships.some(row=>row.principalId===owner.principalId&&row.audience==='app'&&row.contextId==='application'))
        policy.memberships.push({principalId:owner.principalId,audience:'app',contextId:'application',status:'active'});
      policy.assignments.push({principalId:owner.principalId,audience:'app',contextId:'application',roleId:'links-all'});
      good(await acl.replacePolicy(admin.token,{expectedEpoch:initial.epoch,policy}));
      const engine=createOperationEngine({db,catalog,registry:registry(),permissions});
      const invoke=(moduleId,operationId,input)=>engine.invoke({credential:{kind:'session',token:app.token},
        moduleId,operationId,contextId:'application',audience:'app',input});
      const contact=succeeded(await invoke('creezio.crm','contact.create',
        {requestKey:'contact-create',name:'Ada Support',email:'ada@example.invalid'})).item;
      const box=succeeded(await invoke('creezio.messaging','box.create',
        {requestKey:'box-create',name:'Support mail',address:''})).box;
      const ticket=succeeded(await invoke('creezio.support','ticket.create',
        {requestKey:'ticket-create',subject:'Référence explicite'})).item;
      const messageId='message-seeded',at='2026-09-30T00:00:00.000Z';
      const table=schemas.get('creezio.messaging').tables.message;
      await db.prepare(`INSERT INTO "${table}" (context_id,owner_id,box_id,id,direction,from_addr,to_addr,cc_addr,
        subject,text_body,html_body,state,folder,read_at,thread_id,reply_to,in_reply_to,provider_message_id,
        received_at,sent_at,created_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          'application',owner.principalId,box.id,messageId,'inbound','ada@example.invalid','', '',
          'Sujet lié','Corps lié','','received','inbox',null,null,null,null,null,at,null,at,1).run();
      const linkedContact=succeeded(await invoke('creezio.support','reference.contact.link',
        {requestKey:'contact-link',ticketId:ticket.id,revision:ticket.revision,contactId:contact.id})).item;
      assert.equal(linkedContact.contactId,contact.id);
      const linkedMessage=succeeded(await invoke('creezio.support','reference.message.link',
        {requestKey:'message-link',ticketId:ticket.id,revision:linkedContact.revision,
          boxId:box.id,messageId})).item;
      assert.deepEqual([linkedMessage.messageBoxId,linkedMessage.messageId],[box.id,messageId]);
      await refused(invoke('creezio.support','reference.message.link',
        {requestKey:'stale-link',ticketId:ticket.id,revision:ticket.revision,boxId:box.id,messageId}),'conflict');
      const reread=succeeded(await invoke('creezio.support','ticket.read',{id:ticket.id})).item;
      assert.equal(reread.contactId,contact.id);assert.equal(reread.messageId,messageId);
      assert.equal(succeeded(await invoke('creezio.support','reference.contact.read',
        {ticketId:ticket.id,contactId:contact.id})).item.name,'Ada Support');
      assert.equal(succeeded(await invoke('creezio.support','reference.message.read',
        {ticketId:ticket.id,boxId:box.id,messageId})).message.text,'Corps lié');
      const before=good(await acl.readPolicy(admin.token)),revoked=structuredClone(before.policy);
      revoked.roles.find(role=>role.id==='links-all').permissionIds=['creezio.support:use'];
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy:revoked}));
      await refused(invoke('creezio.support','reference.contact.read',
        {ticketId:ticket.id,contactId:contact.id}),'forbidden');
      await refused(invoke('creezio.support','reference.message.read',
        {ticketId:ticket.id,boxId:box.id,messageId}),'forbidden');
      assert.equal(succeeded(await invoke('creezio.support','ticket.read',{id:ticket.id})).item.messageId,messageId);
      const unlinked=succeeded(await invoke('creezio.support','reference.message.unlink',
        {requestKey:'message-unlink',ticketId:ticket.id,revision:linkedMessage.revision})).item;
      assert.equal(unlinked.messageId,null);
    }finally{await runtime.dispose();}
  });
