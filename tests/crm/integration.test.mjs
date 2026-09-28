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
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import * as handlers from '../../extensions/native/crm/module/operations.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/native/crm/module/manifest.json');
const moduleId=manifest.identity.id,digest=`sha256-${'c'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,
  models:manifest.contracts.models.map(model=>({modelId:model.id,table:generated.tables[model.id],model}))}]};
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
const succeeded=result=>{assert.equal(result.execution?.state,'succeeded',JSON.stringify(result));return result.execution.output;};
const rejected=async(promise,code)=>{const result=await promise.catch(error=>error);
  assert.notEqual(result?.execution?.state,'succeeded',JSON.stringify(result));
  assert.equal(result.code??result.execution?.errorCode,code,JSON.stringify(result));};

test('CRM relations, archive races, search and audience refusal pass through real D1 operations',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-crm-integration'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic CRM integration password';
      const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'crm-owner@example.invalid',
        displayName:'CRM owner',password});
      assert.equal(owner.ok,true,JSON.stringify(owner));
      const admin=await accounts.login({loginIdentifier:'crm-owner@example.invalid',password,audience:'admin'});
      const app=await accounts.login({loginIdentifier:'crm-owner@example.invalid',password,audience:'app'});
      assert.equal(admin.ok,true);assert.equal(app.ok,true);
      await db.prepare(`INSERT INTO "${ACCESS_TABLES.role_grants}" (role_id,permission_id) VALUES (?,?)`)
        .bind('administrator',`${moduleId}:use`).run();
      const engine=createOperationEngine({db,catalog,registry:registry(),permissions});
      const invoke=(operationId,input,session=admin,audience='admin')=>engine.invoke({
        credential:{kind:'session',token:session.token},moduleId,operationId,contextId:'application',audience,input});
      const company=succeeded(await invoke('company.create',{requestKey:'company-1',name:'Atlas'})).item;
      const exactPage=succeeded(await invoke('company.list',{limit:1}));
      assert.deepEqual(exactPage.items.map(item=>item.id),[company.id]);
      assert.equal(exactPage.nextCursor,null,'an exact final page must not invite an empty next page');
      const contact=succeeded(await invoke('contact.create',{requestKey:'contact-1',name:'Ana',
        companyId:company.id})).item;
      assert.equal(succeeded(await invoke('company.read',{id:company.id})).item.revision,2,
        'link bumps parent revision in the same D1 batch');
      await rejected(invoke('company.archive',{requestKey:'archive-stale',id:company.id,revision:1}),'conflict');
      await rejected(invoke('company.archive',{requestKey:'archive-linked',id:company.id,revision:2}),'conflict');
      const prospect=succeeded(await invoke('prospect.create',{requestKey:'prospect-1',name:'Bistro',
        companyId:company.id,contactId:contact.id,stage:'a_contacter',position:1})).item;
      assert.equal(prospect.companyId,company.id);
      assert.equal(succeeded(await invoke('company.read',{id:company.id})).item.revision,3);
      assert.equal(succeeded(await invoke('contact.read',{id:contact.id})).item.revision,2);
      await rejected(invoke('contact.archive',{requestKey:'contact-stale',id:contact.id,revision:1}),'conflict');
      await rejected(invoke('contact.archive',{requestKey:'contact-linked',id:contact.id,revision:2}),'conflict');
      const found=succeeded(await invoke('prospect.search',{query:'bistro',limit:5}));
      assert.equal(found.items[0].id,prospect.id);
      await rejected(invoke('prospect.list',{limit:5},app,'app'),'forbidden');
      const acl=createAuthorizationService(db,{permissions}),before=await acl.readPolicy(admin.token);
      assert.equal(before.ok,true,JSON.stringify(before));
      const policy=structuredClone(before.policy);
      policy.roles.push({id:'crm-app',inherits:[],permissionIds:[`${moduleId}:use`],permissionOverrides:[]});
      if(!policy.memberships.some(row=>row.principalId===owner.principalId&&row.audience==='app'
        &&row.contextId==='application'))policy.memberships.push({principalId:owner.principalId,
          audience:'app',contextId:'application',status:'active'});
      policy.assignments.push({principalId:owner.principalId,audience:'app',contextId:'application',roleId:'crm-app'});
      const allowed=await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy});
      assert.equal(allowed.ok,true,JSON.stringify(allowed));
      assert.equal(succeeded(await invoke('company.read',{id:company.id},app,'app')).item.id,company.id,
        'the same authorized principal sees one CRM record across admin and app');
      assert.equal(succeeded(await invoke('prospect.search',{query:'bistro',limit:5},app,'app')).items[0].id,prospect.id);
      const shared=succeeded(await invoke('company.create',{requestKey:'shared-company',name:'Shared'})).item;
      await rejected(invoke('contact.update',{requestKey:'move-linked-contact',id:contact.id,
        revision:2,companyId:shared.id}),'conflict');
      assert.equal(succeeded(await invoke('contact.read',{id:contact.id})).item.companyId,company.id);
      assert.equal(succeeded(await invoke('contact.read',{id:contact.id})).item.revision,2);
      assert.equal(succeeded(await invoke('prospect.read',{id:prospect.id})).item.companyId,company.id);
      const appSeen=succeeded(await invoke('company.read',{id:shared.id},app,'app')).item;
      assert.equal(appSeen.revision,1);
      const adminEdit=succeeded(await invoke('company.update',{requestKey:'shared-admin-edit',id:shared.id,
        revision:1,city:'Paris'})).item;
      assert.equal(adminEdit.revision,2);
      await rejected(invoke('company.update',{requestKey:'shared-app-stale',id:shared.id,revision:1,
        city:'Lyon'},app,'app'),'conflict');
      const appEdit=succeeded(await invoke('company.update',{requestKey:'shared-app-edit',id:shared.id,
        revision:2,city:'Lyon'},app,'app')).item;
      assert.equal(appEdit.revision,3);
      assert.equal(succeeded(await invoke('company.read',{id:shared.id})).item.city,'Lyon');
      const appContact=succeeded(await invoke('contact.create',{requestKey:'shared-app-contact',name:'Luc',
        companyId:shared.id},app,'app')).item;
      assert.equal(succeeded(await invoke('contact.read',{id:appContact.id})).item.companyId,shared.id);
      await rejected(invoke('company.archive',{requestKey:'shared-archive-linked',id:shared.id,revision:4}),
        'conflict');
      const archivedProspect=succeeded(await invoke('prospect.archive',
        {requestKey:'prospect-archive',id:prospect.id,revision:1})).item;
      assert.equal(archivedProspect.revision,2);
      const archivedContact=succeeded(await invoke('contact.archive',
        {requestKey:'contact-archive',id:contact.id,revision:2})).item;
      assert.equal(archivedContact.revision,3);
      const archivedCompany=succeeded(await invoke('company.archive',
        {requestKey:'company-archive',id:company.id,revision:3})).item;
      assert.equal(archivedCompany.revision,4);
      assert.deepEqual(succeeded(await invoke('company.list',{limit:5})).items.map(item=>item.id),[shared.id]);
      assert.equal(succeeded(await invoke('company.list',{limit:5,archived:true})).items[0].id,company.id);
      assert.equal(succeeded(await invoke('contact.search',{limit:5,query:'ana',archived:true})).items[0].id,contact.id);
      await rejected(invoke('contact.restore',
        {requestKey:'contact-restore-blocked',id:contact.id,revision:3}),'conflict');
      const restoredCompany=succeeded(await invoke('company.restore',
        {requestKey:'company-restore',id:company.id,revision:4})).item;
      assert.equal(restoredCompany.archivedAt,null);
      const restoredContact=succeeded(await invoke('contact.restore',
        {requestKey:'contact-restore',id:contact.id,revision:3})).item;
      assert.equal(restoredContact.archivedAt,null);
      const restoredProspect=succeeded(await invoke('prospect.restore',
        {requestKey:'prospect-restore',id:prospect.id,revision:2})).item;
      assert.equal(restoredProspect.archivedAt,null);
      const raceCompany=succeeded(await invoke('company.create',
        {requestKey:'race-company',name:'Concurrent'})).item;
      const racing=await Promise.allSettled([
        invoke('company.archive',{requestKey:'race-archive',id:raceCompany.id,revision:1}),
        invoke('contact.create',{requestKey:'race-link',name:'Concurrent contact',companyId:raceCompany.id})
      ]);
      const winners=racing.filter(result=>result.status==='fulfilled'&&result.value.execution?.state==='succeeded');
      assert.equal(winners.length,1,'a link and its parent archive cannot both commit');
      const raceRow=await db.prepare(`SELECT archived_at,revision FROM "${generated.tables.company}"
        WHERE context_id=? AND id=?`).bind('application',raceCompany.id).first();
      const linked=await db.prepare(`SELECT COUNT(*) AS count FROM "${generated.tables.contact}"
        WHERE context_id=? AND company_id=? AND archived_at IS NULL`)
        .bind('application',raceCompany.id).first();
      assert.ok(raceRow.archived_at===null||linked.count===0,
        'committed state never exposes an active child of an archived company');
      const firstCompany=succeeded(await invoke('company.create',
        {requestKey:'move-race-first',name:'Move race first'})).item;
      const secondCompany=succeeded(await invoke('company.create',
        {requestKey:'move-race-second',name:'Move race second'})).item;
      const movingContact=succeeded(await invoke('contact.create',
        {requestKey:'move-race-contact',name:'Move race contact',companyId:firstCompany.id})).item;
      const moveRace=await Promise.allSettled([
        invoke('prospect.create',{requestKey:'move-race-link',name:'Concurrent ownership',
          companyId:firstCompany.id,contactId:movingContact.id}),
        invoke('contact.update',{requestKey:'move-race-update',id:movingContact.id,
          revision:movingContact.revision,companyId:secondCompany.id})
      ]);
      assert.equal(moveRace.filter(result=>result.status==='fulfilled'&&
        result.value.execution?.state==='succeeded').length,1,
      'contact revision CAS prevents a simultaneous link and company move from both committing');
      const finalContact=succeeded(await invoke('contact.read',{id:movingContact.id})).item;
      const raceProspects=succeeded(await invoke('prospect.search',
        {query:'Concurrent ownership',limit:5})).items;
      for(const item of raceProspects)assert.equal(item.companyId,finalContact.companyId);
      const timestamp=new Date().toISOString();
      const large={context_id:'application',id:'large-0',name:'Charge-test',city:'c'.repeat(240),
        contact_name:'t'.repeat(240),email:'e'.repeat(320),phone:'p'.repeat(240),
        website:'w'.repeat(512),notes:'\u0001'.repeat(4000),stage:'a_contacter',position:1,
        company_id:null,contact_id:null,created_at:timestamp,updated_at:timestamp,
        archived_at:null,revision:1};
      const columns=Object.keys(large);
      await db.batch(Array.from({length:30},(_,index)=>{
        const row={...large,id:`large-${index}`};
        return db.prepare(`INSERT INTO "${generated.tables.prospect}" (${columns.map(name=>`"${name}"`).join(',')})
          VALUES (${columns.map(()=>'?').join(',')})`).bind(...columns.map(name=>row[name]));
      }));
      const largePage=succeeded(await invoke('prospect.list',{limit:25}));
      assert.ok(largePage.items.length>0&&largePage.items.length<25);
      assert.equal(typeof largePage.nextCursor,'string');
      assert.ok(Buffer.byteLength(JSON.stringify(largePage))<262144);
      const ids=new Set();let cursor;
      for(let turn=0;turn<20;turn++){
        const result=succeeded(await invoke('prospect.search',{query:'charge-test',limit:25,
          ...(cursor?{cursor}:{})}));
        for(const item of result.items)ids.add(item.id);
        cursor=result.nextCursor;
        if(!cursor)break;
      }
      assert.equal(ids.size,30,'large records remain searchable through bounded result pages');
    }finally{await runtime.dispose();}
  });
