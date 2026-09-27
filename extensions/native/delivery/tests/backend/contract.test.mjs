import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryController} from '../../../../../sdk/delivery/controller.ts';

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
