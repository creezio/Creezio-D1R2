import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {contractIntegrity,validateComposition} from '../../sdk/contracts/validate.mjs';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {compileOperationSchemas} from '../../scripts/operations/schemas.mjs';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {hostOnly} from '../../extensions/native/access/module/operations.ts';
import * as moduleHandlers from '../../extensions/native/modules-settings/module/operations.ts';
import * as conversationHandlers from '../../extensions/native/conversations/module/operations.ts';
import {solveModulePlan} from '../../sdk/modules/solver.mjs';
import {installedDocumentDigest,splitInstalledDocumentContent} from '../../sdk/modules/documents.ts';
import {namedModule} from '../contracts/helpers.mjs';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const quote=value=>`"${value.replaceAll('"','""')}"`;
const access=json('../../extensions/native/access/module/manifest.json');
const settings=json('../../extensions/native/modules-settings/module/manifest.json');
const conversations=json('../../extensions/native/conversations/module/manifest.json');
const moduleId='creezio.modules-settings';
function compiledFixture() {
  const composition=json('../../configuration/composition.json');
  const lock=json('../../configuration/composition.lock.json');
  const witness=namedModule('merchant.example','merchant');
  witness.compatibility.core='^0.0.0';
  witness.validation.policy=structuredClone(composition.sdk.policy);
  const modules=[access,settings,conversations,witness];
  if (!composition.modules.some(item=>item.moduleId===moduleId)) {
    composition.modules.push({moduleId,origin:settings.identity.origin,versionRange:'^0.0.0',
      source:{kind:'workspace',path:'extensions/native/modules-settings'},enabled:true,
      configuration:[],integrations:[]});
    composition.exposure.admin.moduleIds.push(moduleId);
  }
  if (!lock.modules.some(item=>item.moduleId===moduleId)) {
    const template=structuredClone(lock.modules.find(item=>item.moduleId==='creezio.access'));
    lock.modules.push({...template,moduleId,origin:settings.identity.origin,version:settings.identity.version,
      source:settings.identity.source,contractIntegrity:contractIntegrity(settings),dependencies:[]});
  }
  composition.modules.push({moduleId:witness.identity.id,origin:witness.identity.origin,
    versionRange:'^1.0.0',source:{kind:'workspace',path:'extensions/merchant/example'},
    enabled:true,configuration:[],integrations:[]});
  const template=structuredClone(lock.modules.find(item=>item.moduleId==='creezio.access'));
  lock.modules.push({...template,moduleId:witness.identity.id,origin:witness.identity.origin,
    version:witness.identity.version,source:witness.identity.source,
    contractIntegrity:contractIntegrity(witness),dependencies:[]});
  for (const descriptor of modules) {
    const node=lock.modules.find(item=>item.moduleId===descriptor.identity.id);
    node.contractIntegrity=contractIntegrity(descriptor);
  }
  lock.compositionIntegrity=contractIntegrity(composition);
  const checked=validateComposition(composition,{lock,modules});
  assert.deepEqual(checked.errors,[],JSON.stringify(checked.errors));
  const candidates=modules.map(descriptor=>{
    const selection=composition.modules.find(item=>item.moduleId===descriptor.identity.id);
    const node=lock.modules.find(item=>item.moduleId===descriptor.identity.id);
    const core={moduleId:descriptor.identity.id,origin:descriptor.identity.origin,
      version:descriptor.identity.version,source:selection.source,descriptor,lockNode:node};
    return {candidateKey:contractIntegrity(core),...core};
  });
  const inventory={schemaVersion:1,candidates,digest:contractIntegrity({schemaVersion:1,candidates})};
  const currentInstalledDocuments=modules.flatMap(descriptor=>{
    const selected=composition.modules.find(item=>item.moduleId===descriptor.identity.id);
    const node=lock.modules.find(item=>item.moduleId===descriptor.identity.id);
    assert.ok(selected&&node);
    return ['readme','prd','changelog'].map(kind=>{
      const declaration=descriptor.documentation.installed[kind];
      const content=descriptor===witness
        ? `# Synthetic installed ${kind} for ${descriptor.identity.id}\nVersion ${descriptor.identity.version}.\n`
        : readFileSync(new URL(`../../${selected.source.path}/${declaration.path}`,
          import.meta.url),'utf8');
      const bytes=new TextEncoder().encode(content);
      return {moduleId:descriptor.identity.id,origin:descriptor.identity.origin,
        version:descriptor.identity.version,sourceRevision:descriptor.identity.source.revision,
        runtimeIntegrity:node.runtime.integrity,kind,visibility:declaration.visibility,
        path:declaration.path,digest:installedDocumentDigest(bytes),byteLength:bytes.byteLength,
        blockCount:splitInstalledDocumentContent(content).length,content};
    });
  });
  return {composition,lock,modules,witness,inventory,currentInstalledDocuments};
}

test('modules settings operation commits head, plan, journal and execution in real D1',
  {timeout:60000},async()=>{
    const fixture=compiledFixture();
    const source={composition:fixture.composition,lock:fixture.lock,modules:fixture.modules};
    const schema=compileCompositionSchema(source), compiled=compileOperationSchemas(source);
    const validators={...await import(`data:text/javascript;base64,${Buffer.from(compiled.validatorsCode).toString('base64')}`)};
    const handlers={...Object.fromEntries(access.contracts.operations.map(item=>[`creezio.access:${item.id}`,hostOnly])),
      ...Object.fromEntries(settings.contracts.operations.map(item=>[`${moduleId}:${item.id}`,
        moduleHandlers[item.handler.export]])),
      ...Object.fromEntries(conversations.contracts.operations.map(item=>[`${conversations.identity.id}:${item.id}`,
        conversationHandlers[item.handler.export]])),
      ...Object.fromEntries(fixture.witness.contracts.operations.map(item=>
        [`${fixture.witness.identity.id}:${item.id}`,hostOnly]))};
    const registry=createOperationRegistry({catalog:compiled.catalog,validators,handlers});
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
      script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-module-settings-qualification'},d1Persist:false});
    try {
      const db=await runtime.getD1Database('DB');
      await db.batch(schema.statements.map(item=>db.prepare(item)));
      const accounts=createAccountService(db), bootstrap=await provisionBootstrapCapability(db);
      assert.ok(bootstrap);
      const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'modules-owner@example.invalid',
        displayName:'Module owner',password:'Synthetic module manager test password'});
      assert.equal(owner.ok,true,JSON.stringify(owner));
      const session=await accounts.login({loginIdentifier:'modules-owner@example.invalid',
        password:'Synthetic module manager test password',audience:'admin'});
      assert.equal(session.ok,true,JSON.stringify(session));
      const runtimeInventory={current:{composition:fixture.composition,lock:fixture.lock,
        descriptors:fixture.modules},inventory:fixture.inventory,
        currentInstalledDocuments:fixture.currentInstalledDocuments};
      const engine=createOperationEngine({db,registry,catalog:schema.runtimeCatalog,
        permissions:[{id:`${moduleId}:manage`,audiences:['admin'],actors:['user','delegated-user']}],runtimeInventory});
      const invoke=(operationId,input)=>engine.invoke({credential:{kind:'session',token:session.token},
        moduleId,operationId,contextId:'application',audience:'admin',input});
      await assert.rejects(invoke('catalog.list',{limit:50}),{code:'forbidden'},
        'bootstrap Access authority does not imply module management authority');
      await db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.role_grants)} (role_id,permission_id) VALUES (?,?)`)
        .bind('administrator',`${moduleId}:manage`).run();
      const catalog=await invoke('catalog.list',{limit:50});
      assert.equal(catalog.execution.state,'succeeded',JSON.stringify(catalog.execution));
      const base={revision:catalog.execution.output.revision,
        compositionDigest:catalog.execution.output.compositionDigest,
        lockDigest:catalog.execution.output.lockDigest,
        inventoryDigest:catalog.execution.output.inventoryDigest};
      const refusedAccess={schemaVersion:1,base,actions:[{kind:'disable',moduleId:'creezio.access'}]};
      const accessPreview=await invoke('plans.preview',{intent:refusedAccess});
      assert.equal(accessPreview.execution.state,'succeeded');
      assert.ok(accessPreview.execution.output.diagnostics.length>0,
        'the manager cannot remain enabled after its required Access dependency is disabled');
      const intent={schemaVersion:1,base,actions:[{kind:'disable',moduleId:fixture.witness.identity.id}]};
      const preview=await invoke('plans.preview',{intent});
      assert.equal(preview.execution.state,'succeeded',JSON.stringify(preview.execution));
      assert.deepEqual(preview.execution.output.diagnostics,[]);
      const models=schema.runtimeCatalog.modules.find(item=>item.moduleId===moduleId).models;
      const table=id=>quote(models.find(item=>item.modelId===id).table);
      await db.prepare(`CREATE TRIGGER module_settings_test_fail BEFORE INSERT ON ${table('journal')}
        BEGIN SELECT RAISE(ABORT,'forced journal failure'); END`).run();
      await assert.rejects(invoke('plans.accept',{requestKey:'00000000-0000-4000-8000-000000000002',
        expectedRevision:0,expectedPlanDigest:preview.execution.output.planDigest,intent}),{code:'unknown'});
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table('head')}`).first()).n,0);
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table('plans')}`).first()).n,0);
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table('journal')}`).first()).n,0);
      await db.prepare('DROP TRIGGER module_settings_test_fail').run();
      const request={requestKey:'00000000-0000-4000-8000-000000000001',expectedRevision:0,
        expectedPlanDigest:preview.execution.output.planDigest,intent};
      const rival={...request,requestKey:'00000000-0000-4000-8000-000000000003'};
      const raced=await Promise.allSettled([invoke('plans.accept',request),invoke('plans.accept',rival)]);
      const winners=raced.filter(item=>item.status==='fulfilled' && item.value.execution.state==='succeeded');
      assert.equal(winners.length,1,JSON.stringify(raced));
      const accepted=winners[0].value;
      const winningRequest=raced[0].status==='fulfilled' && raced[0].value.execution.state==='succeeded'
        ? request : rival;
      assert.equal(accepted.execution.state,'succeeded',JSON.stringify(accepted.execution));
      assert.equal(accepted.execution.output.status,'accepted_pending_publication');
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table('head')}`).first()).n,1);
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table('plans')}`).first()).n,1);
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table('journal')}`).first()).n,1);
      const replay=await invoke('plans.accept',winningRequest);
      assert.equal(replay.execution.id,accepted.execution.id);
      assert.equal(replay.replayed,true);
      const read=await invoke('plans.read',{planId:accepted.execution.output.planId});
      assert.equal(read.execution.state,'succeeded',JSON.stringify(read.execution));
      assert.equal(read.execution.output.status,'accepted_pending_publication');
      const journal=await invoke('journal.list',{limit:50});
      assert.equal(journal.execution.state,'succeeded',JSON.stringify(journal.execution));
      assert.deepEqual(journal.execution.output.items.map(item=>item.revision),[1]);
      const head=await db.prepare(`SELECT revision,accepted_plan_digest FROM ${table('head')}`).first();
      assert.equal(head.revision,1);
      assert.equal(head.accepted_plan_digest,preview.execution.output.planDigest);

      // A newly published Worker carries the accepted composition. Only then can a fresh CAS plan be accepted.
      const solved=solveModulePlan({composition:fixture.composition,lock:fixture.lock,
        descriptors:fixture.modules,revision:0},intent,fixture.inventory);
      assert.ok(solved.next);
      const published={composition:solved.next.composition,lock:solved.next.lock,modules:fixture.modules};
      assert.deepEqual(validateComposition(published.composition,{lock:published.lock,modules:published.modules}).errors,[]);
      const schema2=compileCompositionSchema(published),compiled2=compileOperationSchemas(published);
      const validators2={...await import(`data:text/javascript;base64,${Buffer.from(compiled2.validatorsCode).toString('base64')}`)};
      const activeNames=new Set(compiled2.catalog.modules.flatMap(module=>module.operations
        .filter(item=>item.active).map(item=>`${module.moduleId}:${item.operation.id}`)));
      const handlers2=Object.fromEntries(Object.entries(handlers).filter(([name])=>activeNames.has(name)));
      const registry2=createOperationRegistry({catalog:compiled2.catalog,validators:validators2,handlers:handlers2});
      const publishedEngine=createOperationEngine({db,registry:registry2,catalog:schema2.runtimeCatalog,
        permissions:[{id:`${moduleId}:manage`,audiences:['admin'],actors:['user','delegated-user']}],
        runtimeInventory:{current:{...published,descriptors:fixture.modules},inventory:fixture.inventory,
          currentInstalledDocuments:fixture.currentInstalledDocuments}});
      const publishedInvoke=(operationId,input)=>publishedEngine.invoke({credential:{kind:'session',token:session.token},
        moduleId,operationId,contextId:'application',audience:'admin',input});
      const effective=await publishedInvoke('plans.read',{planId:accepted.execution.output.planId});
      assert.equal(effective.execution.output.status,'effective');
      const catalog2=await publishedInvoke('catalog.list',{limit:50});
      assert.equal(catalog2.execution.output.revision,1);
      const base2={revision:1,compositionDigest:catalog2.execution.output.compositionDigest,
        lockDigest:catalog2.execution.output.lockDigest,
        inventoryDigest:catalog2.execution.output.inventoryDigest};
      const intent2={schemaVersion:1,base:base2,actions:[{kind:'enable',moduleId:fixture.witness.identity.id,
        audiences:[]}]};
      const preview2=await publishedInvoke('plans.preview',{intent:intent2});
      assert.equal(preview2.execution.state,'succeeded',JSON.stringify(preview2.execution));
      const second=await publishedInvoke('plans.accept',{requestKey:'00000000-0000-4000-8000-000000000004',
        expectedRevision:1,expectedPlanDigest:preview2.execution.output.planDigest,intent:intent2});
      assert.equal(second.execution.state,'succeeded',JSON.stringify(second.execution));
      assert.equal(second.execution.output.revision,2);
      assert.equal((await db.prepare(`SELECT revision FROM ${table('head')}`).first()).revision,2);
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table('plans')}`).first()).n,2);
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table('journal')}`).first()).n,2);
      const stale=await publishedInvoke('plans.accept',{requestKey:'00000000-0000-4000-8000-000000000005',
        expectedRevision:1,expectedPlanDigest:preview2.execution.output.planDigest,intent:intent2})
        .then(value=>value.execution,error=>({state:'threw',errorCode:error.code}));
      assert.notEqual(stale.state,'succeeded');
      assert.equal(stale.errorCode,'conflict');
    } finally {await runtime.dispose();}
  });
