import test from 'node:test';
import assert from 'node:assert/strict';
import {namedModule,dependsOn,compositionCase,lockFor} from '../contracts/helpers.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {solveModulePlan,verifyModulePlanForCommit} from '../../sdk/modules/solver.mjs';

function candidate(module, selection, node) {
  const core={moduleId:module.identity.id,origin:module.identity.origin,
    version:module.identity.version,source:selection.source,descriptor:module,lockNode:node};
  return {candidateKey:contractIntegrity(core),...core};
}
function fixture() {
  const cart=namedModule('merchant.cart','merchant');
  const stock=namedModule('vendor.stock','vendor');
  const before=compositionCase([cart]);
  const update=structuredClone(cart);
  update.identity.version='1.1.0';
  update.documentation.versionBinding.moduleVersion='1.1.0';
  update.packaging.validationBinding.moduleVersion='1.1.0';
  dependsOn(update,stock);
  const proposed=compositionCase([update,stock]);
  const candidates=[candidate(update,proposed.composition.modules[0],proposed.lock.modules[0]),
    candidate(stock,proposed.composition.modules[1],proposed.lock.modules[1])];
  const inventory={schemaVersion:1,candidates,digest:contractIntegrity({schemaVersion:1,candidates})};
  const current={...before,descriptors:before.modules,revision:3};
  const base={revision:3,compositionDigest:contractIntegrity(before.composition),
    lockDigest:contractIntegrity(before.lock),inventoryDigest:inventory.digest};
  const choices={schemaVersion:1,base,actions:[{kind:'update',moduleId:cart.identity.id,
    candidateKey:candidates[0].candidateKey}]};
  return {current,inventory,choices,cart,stock};
}

test('pure T11 solve proposes an exact required dependency and preserves unrelated state',()=>{
  const {current,inventory,choices,cart,stock}=fixture();
  const before=structuredClone(current),plan=solveModulePlan(current,choices,inventory);
  assert.deepEqual(plan.diagnostics,[]);
  assert.equal(plan.summary.status,'ready');
  assert.ok(plan.next);
  assert.equal(plan.next.composition.modules.find(item=>item.moduleId===cart.identity.id).versionRange,'1.1.0');
  assert.ok(plan.next.composition.modules.some(item=>item.moduleId===stock.identity.id));
  assert.ok(!plan.next.composition.exposure.admin.moduleIds.includes(stock.identity.id));
  assert.ok(!plan.next.composition.exposure.app.moduleIds.includes(stock.identity.id));
  assert.equal(plan.next.lock.modules.find(item=>item.moduleId===stock.identity.id).version,'1.0.0');
  assert.deepEqual(plan.summary.changes.map(item=>item.action),['update','add-required']);
  assert.equal(plan.summary.dependencyOrder.at(-1),cart.identity.id);
  assert.deepEqual(current,before);
  assert.equal(verifyModulePlanForCommit({current,choices,inventory,
    expectedChoicesDigest:plan.choicesDigest,expectedSummaryDigest:plan.summaryDigest})?.summaryDigest,
    plan.summaryDigest);
});

test('T11 solve refuses stale state, foreign candidates and altered stored summaries',()=>{
  const {current,inventory,choices}=fixture();
  const ready=solveModulePlan(current,choices,inventory);
  const stale=solveModulePlan({...current,revision:4},choices,inventory);
  assert.equal(stale.next,null);
  assert.equal(stale.diagnostics[0].code,'plan.stale');
  const foreign=solveModulePlan(current,{...choices,actions:[{...choices.actions[0],
    candidateKey:contractIntegrity('foreign')}]},inventory);
  assert.equal(foreign.next,null);
  assert.equal(foreign.diagnostics[0].code,'plan.candidate');
  assert.equal(verifyModulePlanForCommit({current,choices,inventory,
    expectedChoicesDigest:ready.choicesDigest,expectedSummaryDigest:contractIntegrity('altered')}),null);
});

test('T11 choices reject duplicate and oversized intentions before changing composition',()=>{
  const {current,inventory,choices}=fixture();
  const duplicate=solveModulePlan(current,{...choices,actions:[choices.actions[0],choices.actions[0]]},inventory);
  assert.equal(duplicate.next,null);
  assert.equal(duplicate.diagnostics[0].code,'plan.invalid_choices');
  const oversized=solveModulePlan(current,{...choices,actions:Array.from({length:33},(_,index)=>({
    kind:'remove',moduleId:`extra.${index}`}))},inventory);
  assert.equal(oversized.next,null);
  assert.equal(oversized.diagnostics[0].code,'plan.invalid_choices');
});

test('disable and remove clear published exposure while retaining the selected version for disable',()=>{
  const {current,inventory,choices,cart}=fixture();
  for (const kind of ['disable','remove']) {
    const plan=solveModulePlan(current,{...choices,actions:[{kind,moduleId:cart.identity.id}]},inventory);
    assert.equal(plan.summary.status,'ready',JSON.stringify(plan.diagnostics));
    assert.deepEqual(plan.next.composition.exposure.admin.moduleIds,[]);
    assert.deepEqual(plan.next.composition.exposure.app.moduleIds,[]);
    assert.equal(plan.next.lock.modules.some(item=>item.moduleId===cart.identity.id),kind==='disable');
  }
});

test('add requires an explicit audience decision and keeps automatic dependencies headless',()=>{
  const {current,inventory,choices,stock}=fixture();
  const candidateKey=inventory.candidates.find(item=>item.moduleId===stock.identity.id).candidateKey;
  const action={kind:'add',moduleId:stock.identity.id,candidateKey};
  assert.equal(solveModulePlan(current,{...choices,actions:[action]},inventory)
    .diagnostics[0].code,'plan.invalid_choices');
  const admin=solveModulePlan(current,{...choices,actions:[{...action,audiences:['admin']}]},inventory);
  assert.equal(admin.summary.status,'ready',JSON.stringify(admin.diagnostics));
  assert.ok(admin.next.composition.exposure.admin.moduleIds.includes(stock.identity.id));
  assert.ok(!admin.next.composition.exposure.app.moduleIds.includes(stock.identity.id));
  const headless=solveModulePlan(current,{...choices,actions:[{...action,audiences:[]}]},inventory);
  assert.equal(headless.summary.status,'ready',JSON.stringify(headless.diagnostics));
  assert.ok(!headless.next.composition.exposure.admin.moduleIds.includes(stock.identity.id));
  assert.ok(!headless.next.composition.exposure.app.moduleIds.includes(stock.identity.id));
  assert.equal(solveModulePlan(current,{...choices,actions:[{...choices.actions[0],audiences:['app']}]},inventory)
    .diagnostics[0].code,'plan.invalid_choices');
});

test('enable restores exactly its chosen audiences',()=>{
  const {current,inventory,choices,cart}=fixture();
  const disabled=structuredClone(current);
  disabled.composition.modules[0].enabled=false;
  disabled.composition.exposure.admin.moduleIds=[];
  disabled.composition.exposure.app.moduleIds=[];
  disabled.lock.compositionIntegrity=contractIntegrity(disabled.composition);
  const base={...choices.base,compositionDigest:contractIntegrity(disabled.composition),
    lockDigest:contractIntegrity(disabled.lock)};
  const plan=solveModulePlan(disabled,{schemaVersion:1,base,actions:[
    {kind:'enable',moduleId:cart.identity.id,audiences:['app']}]},inventory);
  assert.equal(plan.summary.status,'ready',JSON.stringify(plan.diagnostics));
  assert.deepEqual(plan.next.composition.exposure.admin.moduleIds,[]);
  assert.deepEqual(plan.next.composition.exposure.app.moduleIds,[cart.identity.id]);
});

test('a module update cannot silently adopt a different publisher origin',()=>{
  const {current,cart}=fixture();
  const foreign=structuredClone(cart);
  foreign.identity.origin='https://example.invalid/other/cart';
  const proposed=compositionCase([foreign]);
  const entry=candidate(foreign,proposed.composition.modules[0],proposed.lock.modules[0]);
  const candidates=[entry],inventory={schemaVersion:1,candidates,
    digest:contractIntegrity({schemaVersion:1,candidates})};
  const choices={schemaVersion:1,base:{revision:current.revision,
    compositionDigest:contractIntegrity(current.composition),lockDigest:contractIntegrity(current.lock),
    inventoryDigest:inventory.digest},actions:[{kind:'update',moduleId:cart.identity.id,
      candidateKey:entry.candidateKey}]};
  const plan=solveModulePlan(current,choices,inventory);
  assert.equal(plan.next,null);
  assert.ok(plan.diagnostics.some(item=>item.code==='transition.origin'));
});

test('an installed package cannot be rebuilt under the same exact version',()=>{
  const {current,cart}=fixture();
  current.composition.modules[0].source={kind:'package',name:'@merchant/cart'};
  current.lock.compositionIntegrity=contractIntegrity(current.composition);
  const rebuilt=structuredClone(cart);
  rebuilt.documentation.versionBinding.sourceRevision='fixture-v2';
  const proposed=compositionCase([rebuilt]);
  const entry=candidate(rebuilt,proposed.composition.modules[0],proposed.lock.modules[0]);
  const candidates=[entry],inventory={schemaVersion:1,candidates,
    digest:contractIntegrity({schemaVersion:1,candidates})};
  const choices={schemaVersion:1,base:{revision:current.revision,
    compositionDigest:contractIntegrity(current.composition),lockDigest:contractIntegrity(current.lock),
    inventoryDigest:inventory.digest},actions:[{kind:'update',moduleId:cart.identity.id,
      candidateKey:entry.candidateKey}]};
  const plan=solveModulePlan(current,choices,inventory);
  assert.equal(plan.next,null);
  assert.ok(plan.diagnostics.some(item=>item.code==='transition.immutable'));
});

test('an explicit provider removal is refused while a required consumer stays active',()=>{
  const consumer=namedModule('merchant.cart','merchant');
  const provider=namedModule('vendor.stock','vendor');
  dependsOn(consumer,provider);
  const before=compositionCase([consumer,provider]);
  const current={...before,descriptors:before.modules,revision:2};
  const candidates=[],inventory={schemaVersion:1,candidates,
    digest:contractIntegrity({schemaVersion:1,candidates})};
  const choices={schemaVersion:1,base:{revision:2,
    compositionDigest:contractIntegrity(before.composition),lockDigest:contractIntegrity(before.lock),
    inventoryDigest:inventory.digest},actions:[{kind:'remove',moduleId:provider.identity.id}]};
  const plan=solveModulePlan(current,choices,inventory);
  assert.equal(plan.next,null);
  assert.ok(plan.diagnostics.some(item=>item.code==='dependency.missing'),JSON.stringify(plan.diagnostics));
  assert.deepEqual(plan.summary.changes,[{moduleId:provider.identity.id,action:'remove'}]);
});

test('a plan keeps all dependency-order entries beyond the former 32-item display limit',()=>{
  const modules=Array.from({length:33},(_,index)=>namedModule(`shop.module${index}`,'shop'));
  const before=compositionCase(modules),current={...before,descriptors:modules,revision:0};
  const candidates=[],inventory={schemaVersion:1,candidates,
    digest:contractIntegrity({schemaVersion:1,candidates})};
  const choices={schemaVersion:1,base:{revision:0,
    compositionDigest:contractIntegrity(before.composition),lockDigest:contractIntegrity(before.lock),
    inventoryDigest:inventory.digest},actions:[]};
  const plan=solveModulePlan(current,choices,inventory);
  assert.equal(plan.summary.status,'ready',JSON.stringify(plan.diagnostics));
  assert.equal(plan.summary.dependencyOrder.length,33);
  assert.equal(plan.summary.detailsPaged,false);
});

test('a plan with more than 256 impacts is blocked instead of approving a truncated summary',()=>{
  const modules=Array.from({length:257},(_,index)=>namedModule(`shop.module${index}`,'shop'));
  const before=compositionCase(modules),current={...before,descriptors:modules,revision:0};
  const candidates=[],inventory={schemaVersion:1,candidates,
    digest:contractIntegrity({schemaVersion:1,candidates})};
  const choices={schemaVersion:1,base:{revision:0,
    compositionDigest:contractIntegrity(before.composition),lockDigest:contractIntegrity(before.lock),
    inventoryDigest:inventory.digest},actions:[]};
  const plan=solveModulePlan(current,choices,inventory);
  assert.equal(plan.next,null);
  assert.equal(plan.summary.status,'blocked');
  assert.ok(plan.diagnostics.some(item=>item.code==='plan.summary_limit'));
});

test('a plan exceeding the 8 KiB summary bound is blocked with its reason',()=>{
  const modules=Array.from({length:100},(_,index)=>
    namedModule(`shop.${'x'.repeat(80)}${index}`,'shop'));
  const before=compositionCase(modules),current={...before,descriptors:modules,revision:0};
  const candidates=[],inventory={schemaVersion:1,candidates,
    digest:contractIntegrity({schemaVersion:1,candidates})};
  const choices={schemaVersion:1,base:{revision:0,
    compositionDigest:contractIntegrity(before.composition),lockDigest:contractIntegrity(before.lock),
    inventoryDigest:inventory.digest},actions:[]};
  const plan=solveModulePlan(current,choices,inventory);
  assert.equal(plan.next,null);
  assert.equal(plan.summary.status,'blocked');
  assert.ok(plan.diagnostics.some(item=>item.code==='plan.summary_limit'));
});
