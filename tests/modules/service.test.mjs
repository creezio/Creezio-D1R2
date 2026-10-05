import test from 'node:test';
import assert from 'node:assert/strict';
import {namedModule,compositionCase} from '../contracts/helpers.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {manifest} from '../../extensions/native/modules-settings/tests/helpers.mjs';
import {catalogList,plansPreview,plansAccept,plansCancelPending,plansRead,journalList}
  from '../../extensions/native/modules-settings/module/service.ts';

function fixture() {
  const original=namedModule('merchant.cart','merchant');
  const before=compositionCase([original]);
  const updated=structuredClone(original);
  updated.identity.version='1.1.0';
  updated.documentation.versionBinding.moduleVersion='1.1.0';
  updated.packaging.validationBinding.moduleVersion='1.1.0';
  const proposed=compositionCase([updated]);
  const core={moduleId:updated.identity.id,origin:updated.identity.origin,
    version:updated.identity.version,source:proposed.composition.modules[0].source,
    descriptor:updated,lockNode:proposed.lock.modules[0]};
  const candidate={candidateKey:contractIntegrity(core),...core};
  const inventory={schemaVersion:1,candidates:[candidate],digest:contractIntegrity({schemaVersion:1,candidates:[candidate]})};
  const hostInventory={current:{composition:before.composition,lock:before.lock,descriptors:before.modules},inventory};
  const base={revision:0,compositionDigest:contractIntegrity(before.composition),
    lockDigest:contractIntegrity(before.lock),inventoryDigest:inventory.digest};
  const intent={schemaVersion:1,base,actions:[{kind:'update',moduleId:updated.identity.id,
    candidateKey:candidate.candidateKey}]};
  const records={head:null,plans:new Map(),journal:new Map(),'plan-outcomes':new Map()};
  const data={
    async get(model,{key}) {return model==='head'?records.head:records[model].get(key.id??key.revision)??null;},
    async list(model,{limit,after}) {const all=[...records[model].values()].filter(item=>!after||item.revision>after.revision)
      .sort((a,b)=>a.revision-b.revision);const items=all.slice(0,limit);return {items,nextAfter:all.length>limit?{revision:items.at(-1).revision}:null};},
    planCreate(model,input) {return {kind:'data-plan',action:'create',model,input};},
    planPatch(model,input) {return {kind:'data-plan',action:'patch',model,input};},
  };
  const context={moduleId:'creezio.modules-settings',operationId:'plans.preview',executionId:'e1',
    contextId:'application',audience:'admin',principalId:'owner',actorPrincipalId:'owner',
    signal:new AbortController().signal,data,hostInventory};
  return {context,intent,records,hostInventory};
}

test('module service derives catalog base from host and commits first plan as one T06 batch',async()=>{
  const {context,intent,records}=fixture();
  const catalog=(await catalogList({limit:50},context)).output;
  assert.equal(catalog.revision,0);
  assert.equal(catalog.compositionDigest,intent.base.compositionDigest);
  assert.equal(catalog.lockDigest,intent.base.lockDigest);
  assert.equal(catalog.inventoryDigest,intent.base.inventoryDigest);
  assert.equal(catalog.items[0].moduleId,'merchant.cart');
  assert.equal(catalog.items[0].candidateKey,intent.actions[0].candidateKey,
    'a verified newer version remains actionable');
  const preview=(await plansPreview({intent},context)).output;
  assert.match(preview.planDigest,/^sha256-[a-f0-9]{64}$/);
  assert.deepEqual(preview.diagnostics,[]);
  assert.equal(preview.actions[0].kind,'update');
  const accepted=await plansAccept({requestKey:'00000000-0000-4000-8000-000000000001',expectedRevision:0,
    expectedPlanDigest:preview.planDigest,intent},context);
  assert.equal(accepted.output.status,'accepted_pending_publication');
  assert.deepEqual(accepted.plans.map(plan=>`${plan.action}:${plan.model}`),
    ['create:head','create:plans','create:journal']);
  assert.equal(accepted.plans[0].input.values.revision,1);
  assert.equal(accepted.plans[1].input.values.plan_digest,preview.planDigest);
  assert.equal(accepted.plans[1].input.values.choices_json,JSON.stringify(intent));
  for (const plan of accepted.plans) {
    const value=plan.input.values;
    if (plan.model==='head') records.head=value;
    else records[plan.model].set(value.id??value.revision,value);
  }
  const read=(await plansRead({planId:accepted.output.planId},context)).output;
  const validateRead=addFormats(new Ajv2020({strict:true})).compile(
    manifest.contracts.schemas.find(item=>item.id==='plans-read-output').schema);
  assert.equal(validateRead(read),true,JSON.stringify(validateRead.errors));
  assert.equal(read.status,'accepted_pending_publication');
  assert.equal(read.events[0].revision,1);
  assert.deepEqual(read.handoff,{
    schemaVersion:1,status:'accepted_pending_publication',planId:accepted.output.planId,revision:1,
    planDigest:preview.planDigest,inventoryDigest:intent.base.inventoryDigest,
    baseCompositionDigest:intent.base.compositionDigest,baseLockDigest:intent.base.lockDigest,
    targetCompositionDigest:preview.targetCompositionDigest,targetLockDigest:preview.targetLockDigest,
    choices:intent,summary:read.plan.summary,
    summaryDigest:accepted.plans[1].input.values.summary_digest});
  assert.equal('choices' in read.plan,false,'the operator choices are confined to the pending handoff');
  const journal=(await journalList({limit:50},context)).output;
  assert.deepEqual(journal.items.map(item=>item.planId),[accepted.output.planId]);
  await assert.rejects(plansPreview({intent},context),{code:'conflict'},
    'an unpublished accepted plan cannot be overwritten from the old Worker composition');
  const cancelled=await plansCancelPending({requestKey:'00000000-0000-4000-8000-000000000002',
    expectedRevision:1,planId:accepted.output.planId,expectedPlanDigest:accepted.output.planDigest,
    reason:'La cible ne correspond plus au runtime retenu.'},context);
  assert.equal(cancelled.output.status,'cancelled');
  assert.deepEqual(cancelled.plans.map(plan=>`${plan.action}:${plan.model}`),
    ['patch:head','create:plan-outcomes']);
  records['plan-outcomes'].set(cancelled.plans[1].input.values.revision,cancelled.plans[1].input.values);
  const cancelledRead=(await plansRead({planId:accepted.output.planId},context)).output;
  assert.equal(validateRead(cancelledRead),true,JSON.stringify(validateRead.errors));
  assert.equal(cancelledRead.handoff,null,
    'a cancelled plan cannot be exported as an actionable handoff');
});

test('removal preview and accepted journal disclose each retired permission before publication',async()=>{
  const {context,intent}=fixture();
  const descriptor=context.hostInventory.current.descriptors[0];
  const removal={...intent,actions:[{kind:'remove',moduleId:descriptor.identity.id}]};
  const preview=(await plansPreview({intent:removal},context)).output;
  const expected=descriptor.contracts.permissions.map(permission=>({
    moduleId:descriptor.identity.id,origin:descriptor.identity.origin,permissionId:permission.id}))
    .sort((a,b)=>a.permissionId.localeCompare(b.permissionId));
  assert.deepEqual(preview.retiredPermissions,expected);
  const validatePreview=addFormats(new Ajv2020({strict:true})).compile(
    manifest.contracts.schemas.find(item=>item.id==='plans-preview-output').schema);
  assert.equal(validatePreview(preview),true,JSON.stringify(validatePreview.errors));
  const accepted=await plansAccept({requestKey:'00000000-0000-4000-8000-000000000011',
    expectedRevision:0,expectedPlanDigest:preview.planDigest,intent:removal},context);
  assert.deepEqual(JSON.parse(accepted.plans.find(plan=>plan.model==='plans').input.values.summary_json)
    .retiredPermissions,expected);
});

test('catalog separates available archives from Worker code and hides the exact current candidate',async()=>{
  const {context,hostInventory}=fixture();
  const selected=hostInventory.current.composition.modules[0];
  const descriptor=hostInventory.current.descriptors[0];
  const lockNode=hostInventory.current.lock.modules[0];
  const currentCore={moduleId:selected.moduleId,origin:selected.origin,version:descriptor.identity.version,
    source:selected.source,descriptor,lockNode};
  const currentCandidate={candidateKey:contractIntegrity(currentCore),...currentCore};
  const available=namedModule('vendor.stock','vendor');
  const source=compositionCase([available]);
  const availableCore={moduleId:available.identity.id,origin:available.identity.origin,
    version:available.identity.version,source:source.composition.modules[0].source,
    descriptor:available,lockNode:source.lock.modules[0]};
  const availableCandidate={candidateKey:contractIntegrity(availableCore),...availableCore};
  const candidates=[currentCandidate,availableCandidate];
  hostInventory.inventory={schemaVersion:1,candidates,
    digest:contractIntegrity({schemaVersion:1,candidates})};
  const catalog=(await catalogList({limit:50},context)).output;
  const current=catalog.items.find(item=>item.moduleId===selected.moduleId);
  const remote=catalog.items.find(item=>item.moduleId===available.identity.id);
  assert.equal(current.visibility,'current');
  assert.equal(current.codePresent,true);
  assert.equal(current.candidateKey,null,'the exact deployed lock is not an update');
  assert.equal(remote.visibility,'available');
  assert.equal(remote.codePresent,false,'a cached candidate is not code in the published Worker');
  assert.equal(remote.candidateKey,availableCandidate.candidateKey);
});

test('module service refuses stale revision, forged digest and uncompiled candidate',async()=>{
  const {context,intent}=fixture();
  const preview=(await plansPreview({intent},context)).output;
  await assert.rejects(plansAccept({requestKey:'00000000-0000-4000-8000-000000000002',expectedRevision:1,
    expectedPlanDigest:preview.planDigest,intent},context),{code:'conflict'});
  await assert.rejects(plansAccept({requestKey:'00000000-0000-4000-8000-000000000003',expectedRevision:0,
    expectedPlanDigest:contractIntegrity('forged'),intent},context),{code:'conflict'});
  const foreign={...intent,actions:[{...intent.actions[0],candidateKey:contractIntegrity('foreign')}]};
  const blocked=(await plansPreview({intent:foreign},context)).output;
  assert.equal(blocked.diagnostics[0].code,'plan.candidate');
  await assert.rejects(plansAccept({requestKey:'00000000-0000-4000-8000-000000000004',expectedRevision:0,
    expectedPlanDigest:blocked.planDigest,intent:foreign},context),{code:'conflict'});
});

test('a no-op preview requires no publication and cannot create a pending plan',async()=>{
  const {context,intent}=fixture();
  const empty={...intent,actions:[]};
  const preview=(await plansPreview({intent:empty},context)).output;
  assert.equal(preview.requiresPublication,false);
  assert.deepEqual(preview.actions,[]);
  await assert.rejects(plansAccept({requestKey:'00000000-0000-4000-8000-000000000006',
    expectedRevision:0,expectedPlanDigest:preview.planDigest,intent:empty},context),{code:'invalid_input'});
});
