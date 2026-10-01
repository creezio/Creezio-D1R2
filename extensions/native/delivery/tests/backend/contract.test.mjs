import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryController, deliveryViewInput} from '@creezio/sdk/delivery/controller';
import {deliveryViewModel} from '@creezio/sdk/delivery/view-model';
import {createDeliveryUpdateController} from '@creezio/sdk/delivery/update-controller';
import {deliveryUpdateViewModel} from '@creezio/sdk/delivery/update-view-model';

const digest = `sha256-${'a'.repeat(64)}`;
const summary = {title: 'Plan vérifié', details: ['D1 et R2'], warnings: []};
const inspection = {hostProfile: 'docker-local', configuration: 'ready', preparation: 'needed',
  target: {accountId: 'account-1', workerName: 'worker-1'}, activeTransferId: null, secretConnections: []};
function fixture() {
  const calls = [], stored = {value: null};
  const access = {audience: 'admin', getSnapshot: () => ({phase: 'authenticated', pending: null,
    session: {audience: 'admin', principalId: 'admin-1'}}), subscribe: () => () => {}};
  const transport = {
    async inspect() {return {ok: true, value: inspection};},
    async configure() {return {ok: true, value: inspection};},
    async prepare(input) {calls.push(['prepare', input]); return {ok: true,
      value: {transferId: 'transfer-1', planDigest: digest, summary}};},
    async start(input) {calls.push(['start', input]); return {ok: false, code: 'outcome_unknown'};},
    async status(id) {calls.push(['status', id]); return {ok: true,
      value: {transferId: id, planDigest: digest, phase: 'starting', summary: null,
        finalUrl: null, registryStatus: 'pending'}};},
    async reconcile(input) {calls.push(['reconcile', input]); return {ok: true,
      value: {transferId: input.transferId, planDigest: digest, phase: 'captured', summary: null,
        finalUrl: null, registryStatus: 'pending'}};},
  };
  const persistence = {read: () => stored.value, save(value) {stored.value = value; return true;}};
  return {calls, stored, access, transport, persistence,
    controller: createDeliveryController({access, transport, persistence})};
}

test('preparation has no capture and start persists exact transfer identity before its uncertain response', async () => {
  const f = fixture();
  assert.equal((await f.controller.inspect()).ok, true);
  const prepared = await f.controller.prepare({secretSelections: []});
  assert.equal(prepared.ok, true);
  assert.deepEqual(f.calls, [['prepare', {secretSelections: []}]]);
  assert.equal(f.stored.value.started, false);
  const started = await f.controller.start();
  assert.deepEqual(started, {ok: false, code: 'outcome_unknown'});
  assert.deepEqual(f.calls[1], ['start', {transferId: 'transfer-1', planDigest: digest}]);
  assert.equal(f.stored.value.started, true);
  assert.deepEqual(await f.controller.start(), {ok: false, code: 'not_ready'});
  await f.controller.status();
  await f.controller.reconcile();
  assert.deepEqual(f.calls.slice(2), [['status', 'transfer-1'],
    ['reconcile', {transferId: 'transfer-1', planDigest: digest}]]);
  f.controller.dispose();
});

test('exact prepared status rearms an uncertain start before the plan is shown', async () => {
  const f = fixture();
  await f.controller.inspect();
  await f.controller.prepare({secretSelections: []});
  assert.deepEqual(await f.controller.start(), {ok: false, code: 'outcome_unknown'});
  assert.equal(f.stored.value.started, true);
  f.transport.status = async id => ({ok: true,
    value: {transferId: id, planDigest: digest, phase: 'prepared', summary,
      finalUrl: null, registryStatus: 'pending'}});
  assert.equal((await f.controller.status()).ok, true);
  assert.equal(f.stored.value.started, false);
  assert.equal(f.controller.getSnapshot().saved?.started, false);
  assert.equal(f.controller.getSnapshot().prepared?.planDigest, digest);
  assert.equal((await f.controller.start()).code, 'outcome_unknown');
  assert.equal(f.calls.filter(([kind]) => kind === 'start').length, 2);
  f.controller.dispose();
});

test('prepared status stays blocked if the rearmed state cannot be persisted', async () => {
  const f = fixture();
  await f.controller.inspect();
  await f.controller.prepare({secretSelections: []});
  await f.controller.start();
  f.transport.status = async id => ({ok: true,
    value: {transferId: id, planDigest: digest, phase: 'prepared', summary,
      finalUrl: null, registryStatus: 'pending'}});
  f.persistence.save = () => false;
  assert.deepEqual(await f.controller.status(), {ok: false, code: 'persistence_unavailable'});
  assert.equal(f.stored.value.started, true);
  assert.equal(f.controller.getSnapshot().saved?.started, true);
  assert.deepEqual(await f.controller.start(), {ok: false, code: 'not_ready'});
  f.controller.dispose();
});

test('mismatched prepared status cannot rearm a started transfer', async () => {
  const f = fixture();
  await f.controller.inspect();
  await f.controller.prepare({secretSelections: []});
  await f.controller.start();
  f.transport.status = async id => ({ok: true,
    value: {transferId: id, planDigest: `sha256-${'b'.repeat(64)}`, phase: 'prepared',
      summary, finalUrl: null, registryStatus: 'pending'}});
  assert.deepEqual(await f.controller.status(), {ok: false, code: 'invalid_response'});
  assert.equal(f.stored.value.started, true);
  assert.deepEqual(await f.controller.start(), {ok: false, code: 'not_ready'});
  f.controller.dispose();
});

test('prepared status restores a reviewable plan after a reload', async () => {
  const f = fixture();
  f.stored.value = {owner: 'admin-1', transferId: 'transfer-1', planDigest: digest, started: false};
  f.controller.dispose();
  const controller = createDeliveryController({access: f.access, persistence: f.persistence,
    transport: {...f.transport, async status(id) {return {ok: true,
      value: {transferId: id, planDigest: digest, phase: 'prepared', summary,
        finalUrl: null, registryStatus: 'pending'}};}}});
  await controller.inspect();
  assert.equal((await controller.status()).ok, true);
  assert.deepEqual(controller.getSnapshot().prepared?.summary, summary);
  controller.dispose();
});

test('interrupted preparation resumes after reload and credential re-entry without another transfer', async () => {
  const f = fixture();
  let prepares = 0;
  f.transport.prepare = async input => {
    f.calls.push(['prepare', input]);
    prepares++;
    return prepares === 1 ? {ok: false, code: 'provision_unknown'}
      : {ok: true, value: {transferId: 'transfer-1', planDigest: digest, summary}};
  };
  await f.controller.inspect();
  assert.deepEqual(await f.controller.prepare({secretSelections: []}),
    {ok: false, code: 'provision_unknown'});
  assert.equal(f.stored.value, null);
  f.controller.dispose();

  const interrupted = {...inspection, configuration: 'needed', target: inspection.target,
    activeTransferId: null};
  f.transport.inspect = async () => ({ok: true, value: interrupted});
  f.transport.configure = async input => {
    f.calls.push(['configure', input.target]);
    return {ok: true, value: inspection};
  };
  const controller = createDeliveryController({access: f.access, transport: f.transport,
    persistence: f.persistence});
  assert.equal((await controller.inspect()).ok, true);
  assert.deepEqual(controller.getSnapshot().inspection?.target, inspection.target);
  assert.equal(deliveryViewModel(deliveryViewInput(controller.getSnapshot())).canConfigure, true);
  assert.equal((await controller.configure({target: inspection.target,
    credentials: {apiToken: 'synthetic-token'}})).ok, true);
  assert.equal(deliveryViewModel(deliveryViewInput(controller.getSnapshot())).canPrepare, true);
  assert.equal((await controller.prepare({secretSelections: []})).ok, true);
  assert.equal(f.stored.value.transferId, 'transfer-1');
  assert.equal(f.stored.value.planDigest, digest);
  const ready = deliveryViewModel(deliveryViewInput(controller.getSnapshot()));
  assert.equal(ready.transferId, null);
  assert.equal(ready.canStart, true);
  assert.equal(f.calls.filter(([kind]) => kind === 'prepare').length, 2);
  controller.dispose();
});

test('re-entering an operator token keeps the same transfer and plan', async () => {
  const f = fixture();
  await f.controller.inspect();
  await f.controller.prepare({secretSelections: []});
  const before = f.controller.getSnapshot().saved;
  const target = inspection.target;
  const result = await f.controller.configure({target, credentials: {apiToken: 'synthetic-token'}});
  assert.equal(result.ok, true);
  assert.deepEqual(f.controller.getSnapshot().saved, before);
  assert.equal(f.controller.getSnapshot().prepared?.planDigest, digest);
  assert.equal((await f.controller.configure({target: {...target, workerName: 'other'},
    credentials: {apiToken: 'synthetic-token'}})).ok, false);
  f.controller.dispose();
});

test('update review persists its exact identity before start and resumes without a second preparation', async () => {
  const stored={value:null},calls=[];
  const access={audience:'admin',getSnapshot:()=>({phase:'authenticated',pending:null,
    session:{audience:'admin',principalId:'admin-1'}}),subscribe:()=>()=>{}};
  const updateInspection={kind:'update',readiness:'ready',currentPublicationId:'publication-1',
    activeUpdateId:null,target:inspection.target};
  const prepared={kind:'update',updateId:'update-1',planDigest:digest,summary};
  const status={kind:'update',updateId:'update-1',planDigest:digest,phase:'delivery-unknown',summary:null,
    finalUrl:null,registryStatus:'unknown',retryEligible:true};
  const transport={
    async inspectUpdate(){return {ok:true,value:updateInspection};},
    async prepareUpdate(){calls.push('prepare');return {ok:true,value:prepared};},
    async startUpdate(input){calls.push(['start',input]);return {ok:false,code:'outcome_unknown'};},
    async statusUpdate(id){calls.push(['status',id]);return {ok:true,value:status};},
    async reconcileUpdate(input){calls.push(['reconcile',input]);return {ok:true,value:status};},
    async retryUpdate(input){calls.push(['retry',input]);return {ok:true,value:status};},
    async rejectUpdate(input){calls.push(['reject',input]);return {ok:false,code:'update_not_ready'};},
  };
  const persistence={read:()=>stored.value,save(value){stored.value=value;return true;}};
  let controller=createDeliveryUpdateController({access,transport,persistence});
  await controller.inspect();
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canPrepare,true);
  assert.equal((await controller.prepare()).ok,true);
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canStart,true);
  assert.deepEqual(stored.value,{kind:'update',owner:'admin-1',updateId:'update-1',
    planDigest:digest,started:false});
  assert.deepEqual(await controller.start(),{ok:false,code:'outcome_unknown'});
  assert.equal(stored.value.started,true);
  assert.deepEqual(calls,['prepare',['start',{updateId:'update-1',planDigest:digest}]]);
  controller.dispose();
  controller=createDeliveryUpdateController({access,transport,persistence});
  await controller.inspect();await controller.status();await controller.reconcile();
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canRetry,true);
  await controller.retry();
  assert.deepEqual(calls.slice(2),[['status','update-1'],
    ['reconcile',{updateId:'update-1',planDigest:digest}],
    ['retry',{updateId:'update-1',planDigest:digest}]]);
  assert.equal(calls.filter(call=>call==='prepare').length,1);
  controller.dispose();
});

test('confirmed Cloudflare validation refusal retains baseline and permits a new reviewed plan',async()=>{
  const stored={value:null},calls=[];
  const access={audience:'admin',getSnapshot:()=>({phase:'authenticated',pending:null,
    session:{audience:'admin',principalId:'admin-1'}}),subscribe:()=>()=>{}};
  const inspection={kind:'update',readiness:'ready',currentPublicationId:'baseline-1',
    activeUpdateId:null,target:{accountId:'account-1',workerName:'worker-1'}};
  const uncertain={kind:'update',updateId:'rejected-one',planDigest:digest,phase:'delivery-unknown',
    summary:null,finalUrl:null,registryStatus:'unknown',retryEligible:false,
    diagnostic:{phase:'wrangler',reason:'exit_nonzero',exitCode:1,apiCodes:[10021],
      validationIssue:'unknown_validation'}};
  const rejected={...uncertain,phase:'rejected',registryStatus:'pending',retryEligible:false};
  let preparation=0;
  const transport={
    async inspectUpdate(){return {ok:true,value:{...inspection}};},
    async prepareUpdate(){preparation++;return {ok:true,value:{kind:'update',
      updateId:preparation===1?'rejected-one':'corrected-two',planDigest:digest,summary}};},
    async startUpdate(input){calls.push(['start',input]);return {ok:true,value:uncertain};},
    async statusUpdate(id){calls.push(['status',id]);return {ok:true,value:rejected};},
    async rejectUpdate(input){calls.push(['reject',input]);inspection.activeUpdateId=null;
      return {ok:true,value:rejected};},
  };
  const persistence={read:()=>stored.value,save(value){stored.value=value;return true;}};
  let controller=createDeliveryUpdateController({access,transport,persistence});
  await controller.inspect();await controller.prepare();await controller.start();
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canReject,true);
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canRetry,false);
  assert.equal((await controller.reject()).ok,true);
  assert.deepEqual(calls.at(-1),['reject',{updateId:'rejected-one',planDigest:digest}]);
  assert.equal(controller.getSnapshot().update.phase,'rejected');
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canPrepare,true);
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canReconcile,false);
  assert.deepEqual(await controller.reject(),{ok:false,code:'update_not_ready'});
  controller.dispose();
  controller=createDeliveryUpdateController({access,transport,persistence});
  await controller.inspect();await controller.status();
  assert.equal(controller.getSnapshot().update.phase,'rejected');
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canPrepare,true);
  assert.equal((await controller.prepare()).ok,true);
  assert.equal(stored.value.updateId,'corrected-two');
  assert.equal(stored.value.started,false);
  controller.dispose();
});

test('legacy update transport hides checked refusal and blocks a 10021 retry',async()=>{
  let retries=0;
  const access={audience:'admin',getSnapshot:()=>({phase:'authenticated',pending:null,
    session:{audience:'admin',principalId:'admin-1'}}),subscribe:()=>()=>{}};
  const status={kind:'update',updateId:'legacy-one',planDigest:digest,
    phase:'delivery-unknown',summary:null,finalUrl:null,registryStatus:'unknown',
    retryEligible:true,diagnostic:{phase:'wrangler',reason:'exit_nonzero',exitCode:1,
      apiCodes:[10021],validationIssue:'unknown_validation'}};
  const transport={
    async inspectUpdate(){return {ok:true,value:{kind:'update',readiness:'ready',
      currentPublicationId:'baseline-1',activeUpdateId:'legacy-one',target:inspection.target}};},
    async statusUpdate(){return {ok:true,value:status};},
    async retryUpdate(){retries++;return {ok:true,value:status};},
  };
  const stored={kind:'update',owner:'admin-1',updateId:'legacy-one',
    planDigest:digest,started:true};
  const controller=createDeliveryUpdateController({access,transport,
    persistence:{read:()=>stored,save:()=>true}});
  await controller.inspect();await controller.status();
  assert.equal(controller.getSnapshot().rejectAvailable,false);
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canReject,false);
  assert.equal(deliveryUpdateViewModel(controller.getSnapshot()).canRetry,false);
  assert.deepEqual(await controller.reject(),{ok:false,code:'service_unavailable'});
  assert.deepEqual(await controller.retry(),{ok:false,code:'update_not_ready'});
  assert.equal(retries,0);
  controller.dispose();
});
