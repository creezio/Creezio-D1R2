import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccessAdminController} from '../../sdk/access/admin-controller.ts';

const execution = output => ({kind: 'execution', execution: {id: crypto.randomUUID(), state: 'succeeded',
  output, errorCode: null}});
const policy = {contexts: [{id: 'application', status: 'active'}],
  roles: [{id: 'administrator', inherits: [], permissionIds: ['creezio.access:manage'], permissionOverrides: []}],
  memberships: [], assignments: [], overrides: []};
const digest = `sha256:${'a'.repeat(64)}`;
function accessFixture() {
  let phase = 'authenticated';
  const listeners = new Set();
  return {origin: 'https://app.example.invalid', audience: 'admin',
    getSnapshot: () => ({phase, pending: null, session: phase === 'authenticated'
      ? {id: 'session-1', principalId: 'owner-1', audience: 'admin'} : null}),
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    setPhase(next) {phase = next; for (const listener of listeners) listener();}};
}
function persistenceFixture() {
  let value = null;
  return {read: () => value, save(next) {value = next; return true;}};
}

test('Access admin SDK uses only declared T06 bindings and validates paged read output', async () => {
  const access = accessFixture(), calls = [];
  const operations = {origin: access.origin, audience: 'admin',
    async invoke(request) {
      calls.push(request);
      if (request.bindingId === 'creezio.access:policy.read') return execution({epoch: 1, policy});
      if (request.bindingId === 'creezio.access:permissions.list') return execution({items: [
        {id: 'creezio.access:manage', moduleId: 'creezio.access', title: 'Gérer les accès',
          audiences: ['admin'], actors: ['user']}], nextAfterId: null, catalogDigest: digest});
      if (request.bindingId === 'creezio.access:audit.list') return execution({items: [{id: 'audit-1',
        action: 'authorization-updated', principalId: 'owner-1', actorDisplayName: 'Owner',
        targetPrincipalId: null, createdAtMs: 1, summary: 'authorization-updated', detailAvailable: true}],
      nextCursor: null});
      throw new Error('Unexpected binding');
    }, async status() {throw new Error('No mutation in this test');}};
  const controller = createAccessAdminController({client: operations, access, persistence: persistenceFixture()});
  try {
    const read = await controller.readPolicy();
    assert.equal(read.ok, true); assert.equal(read.value.epoch, 1);
    const audit = await controller.listAudit({limit: 20, before: {createdAtMs: 4, id: 'audit-4'}});
    assert.equal(audit.ok, true); assert.equal(audit.value.items[0].detailAvailable, true);
    assert.deepEqual(calls.map(call => call.bindingId), ['creezio.access:policy.read',
      'creezio.access:permissions.list', 'creezio.access:audit.list']);
    assert.ok(calls.every(call => call.contextId === 'application'));
    assert.deepEqual(calls[1].input, {limit: 50});
    assert.deepEqual(calls[2].input, {limit: 20, beforeCreatedAtMs: 4, beforeId: 'audit-4'});
    assert.deepEqual(await controller.listAudit({limit: 51, before: null}), {ok: false, error: 'invalid_input'});
    assert.equal(calls.length, 3, 'invalid input never reaches T06');
  } finally {controller.dispose();}
});

test('an unknown Access mutation keeps its request key and uses lookup before any new command', async () => {
  const access = accessFixture(), invoked = [], lookedUp = [];
  let lookupResult = {kind: 'unknown', code: 'execution_not_observed'};
  const operations = {origin: access.origin, audience: 'admin',
    async invoke(request) {invoked.push(request); return {kind: 'unknown', code: 'outcome_unknown'};},
    async status(request) {lookedUp.push(request); return lookupResult;}};
  const persistence = persistenceFixture();
  const controller = createAccessAdminController({client: operations, access, persistence});
  try {
    assert.equal(controller.getSnapshot(), controller.getSnapshot(), 'snapshot stays referentially stable');
    const change = {kind: 'role-override', roleId: 'administrator', permissionId: 'creezio.access:manage', effect: 'allow'};
    const pending = await controller.applyDelta({expectedEpoch: 1, changes: [change]});
    assert.equal(pending.kind, 'unknown'); assert.match(pending.requestKey, /^[a-f0-9-]{36}$/);
    assert.equal(controller.getSnapshot().pendingCommand.requestKey, pending.requestKey);
    assert.equal(persistence.read().requestKey, pending.requestKey, 'key is persisted before outcome');
    const blocked = await controller.setHumanStatus({principalId: 'user-1', expectedAuthVersion: 1, status: 'disabled'});
    assert.equal(blocked.kind, 'unknown'); assert.equal(blocked.requestKey, pending.requestKey);
    assert.equal(invoked.length, 1, 'a second command never emits while the first is uncertain');
    assert.equal((await controller.reconcilePending()).kind, 'unknown');
    assert.deepEqual(lookedUp[0], {bindingId: 'creezio.access:policy.apply-delta',
      contextId: 'application', requestKey: pending.requestKey});
    lookupResult = {kind: 'rejected', code: 'rate_limited', status: 429};
    assert.deepEqual(await controller.reconcilePending(), {kind: 'unknown', requestKey: pending.requestKey,
      code: 'rate_limited'});
    assert.equal(persistence.read().requestKey, pending.requestKey);
    lookupResult = {kind: 'rejected', code: 'unauthorized', status: 401};
    assert.equal((await controller.reconcilePending()).kind, 'unknown');
    assert.equal((await controller.revokeSession({sessionId: 'session-2'})).requestKey, pending.requestKey);
    assert.equal(invoked.length, 1, 'refused lookup cannot release another POST');
    lookupResult = execution({epoch: 2, auditId: 'audit-2', changedCount: 1});
    const recovered = await controller.reconcilePending();
    assert.equal(recovered.kind, 'succeeded'); assert.equal(recovered.requestKey, pending.requestKey);
    assert.equal(controller.getSnapshot().pendingCommand, null);
    assert.equal(persistence.read(), null);
    assert.equal(invoked.length, 1, 'lookup does not replay the mutation');
  } finally {controller.dispose();}
});

test('Access pages reject valid rows beyond the requested page size', async () => {
  const access = accessFixture();
  const principal = id => ({id, kind: 'human', displayName: id, status: 'active', authVersion: 1,
    humanStatus: 'active', loginIdentifier: `${id}@example.invalid`, createdAtMs: 1});
  const audit = id => ({id, action: 'authorization-updated', principalId: 'owner-1',
    actorDisplayName: 'Owner', targetPrincipalId: null, createdAtMs: 1,
    summary: 'authorization-updated', detailAvailable: false});
  const operations = {origin: access.origin, audience: 'admin',
    async invoke(request) {
      if (request.bindingId === 'creezio.access:principals.list')
        return execution({items: [principal('user-1'), principal('user-2')], nextAfterId: null});
      if (request.bindingId === 'creezio.access:audit.list')
        return execution({items: [audit('audit-1'), audit('audit-2')], nextCursor: null});
      throw new Error('Unexpected binding');
    }, async status() {throw new Error('Unexpected status');}};
  const controller = createAccessAdminController({client: operations, access, persistence: persistenceFixture()});
  try {
    assert.deepEqual(await controller.listPrincipals({kind: 'all', limit: 1, afterId: null}),
      {ok: false, error: 'invalid_response'});
    assert.deepEqual(await controller.listAudit({limit: 1, before: null}),
      {ok: false, error: 'invalid_response'});
  } finally {controller.dispose();}
});

test('Access admin read result becomes stale and private state hides when session is revoked', async () => {
  const access = accessFixture();
  let release;
  const operations = {origin: access.origin, audience: 'admin',
    invoke: () => new Promise(resolve => {release = resolve;}), status: async () => ({kind: 'unknown', code: 'unused'})};
  const controller = createAccessAdminController({client: operations, access, persistence: persistenceFixture()});
  try {
    const version = controller.getSnapshot().identityVersion;
    const pending = controller.readPolicy();
    await Promise.resolve();
    access.setPhase('anonymous');
    release(execution({epoch: 1, policy}));
    assert.deepEqual(await pending, {ok: false, error: 'stale'});
    assert.equal(controller.getSnapshot().authorized, false);
    assert.equal(controller.getSnapshot().suspended, false);
    assert.ok(controller.getSnapshot().identityVersion > version, 'confirmed anonymous invalidates local identity');
  } finally {controller.dispose();}
});

test('pending Access command survives controller reload and must be looked up before another POST', async () => {
  const access = accessFixture(), persistence = persistenceFixture();
  const invoked = [], lookedUp = [];
  const operations = {origin: access.origin, audience: 'admin',
    async invoke(request) {invoked.push(request); return {kind: 'unknown', code: 'outcome_unknown'};},
    async status(request) {lookedUp.push(request); return execution({epoch: 2, auditId: 'audit-2', changedCount: 1});}};
  const first = createAccessAdminController({client: operations, access, persistence});
  const pending = await first.applyDelta({expectedEpoch: 1, changes: [
    {kind: 'role-grant', roleId: 'administrator', permissionId: 'creezio.access:manage', present: true}]});
  first.dispose();
  const second = createAccessAdminController({client: operations, access, persistence});
  try {
    assert.equal(second.getSnapshot().pendingCommand.requestKey, pending.requestKey);
    assert.equal(second.getSnapshot(), second.getSnapshot());
    assert.equal((await second.revokeSession({sessionId: 'session-2'})).kind, 'unknown');
    assert.equal(invoked.length, 1);
    const recovered = await second.reconcilePending();
    assert.equal(recovered.kind, 'succeeded');
    assert.equal(lookedUp[0].requestKey, pending.requestKey);
    assert.equal(persistence.read(), null);
  } finally {second.dispose();}
});

test('transient session revalidation blocks effects without losing an uncertain command or draft identity', async () => {
  const access = accessFixture(), stored = persistenceFixture();
  let readable = true, reads = 0, invoked = 0;
  const persistence = {read() {reads++; return readable ? stored.read() : null;}, save: value => stored.save(value)};
  const operations = {origin: access.origin, audience: 'admin',
    async invoke() {invoked++; return {kind: 'unknown', code: 'outcome_unknown'};},
    async status() {return execution({epoch: 2, auditId: 'audit-2', changedCount: 1});}};
  const controller = createAccessAdminController({client: operations, access, persistence});
  try {
    const result = await controller.applyDelta({expectedEpoch: 1, changes: [
      {kind: 'role-grant', roleId: 'administrator', permissionId: 'creezio.access:manage', present: true}]});
    assert.equal(result.kind, 'unknown');
    const version = controller.getSnapshot().identityVersion, readsBeforeRefresh = reads;
    readable = false;
    access.setPhase('loading');
    assert.equal(controller.getSnapshot().authorized, false);
    assert.equal(controller.getSnapshot().suspended, true);
    assert.equal(controller.getSnapshot().identityVersion, version);
    assert.equal((await controller.revokeSession({sessionId: 'session-2'})).kind, 'rejected');
    assert.equal(invoked, 1);
    access.setPhase('unavailable');
    assert.equal(controller.getSnapshot().suspended, true);
    access.setPhase('authenticated');
    assert.equal(controller.getSnapshot().authorized, true);
    assert.equal(controller.getSnapshot().suspended, false);
    assert.equal(controller.getSnapshot().identityVersion, version);
    assert.equal(controller.getSnapshot().pendingCommand.requestKey, result.requestKey);
    assert.equal(reads, readsBeforeRefresh, 'same-session recovery never reads an unavailable panel');
    assert.equal((await controller.revokeSession({sessionId: 'session-2'})).requestKey, result.requestKey);
    assert.equal(invoked, 1);
    readable = true;
    assert.equal((await controller.reconcilePending()).kind, 'succeeded');
    assert.equal(stored.read(), null);
  } finally {controller.dispose();}
});

test('Access mutation refuses to emit when qualified panel state cannot save the key', async () => {
  const access = accessFixture();
  let invoked = 0;
  const operations = {origin: access.origin, audience: 'admin',
    async invoke() {invoked++; return {kind: 'unknown', code: 'outcome_unknown'};},
    async status() {throw new Error('Unexpected status');}};
  const controller = createAccessAdminController({client: operations, access,
    persistence: {read: () => null, save: () => false}});
  try {
    const outcome = await controller.revokeSession({sessionId: 'session-2'});
    assert.equal(outcome.kind, 'rejected'); assert.equal(outcome.code, 'persistence_unavailable');
    assert.equal(invoked, 0);
  } finally {controller.dispose();}
});

test('malformed policy graph is refused before an Access panel can render it', async () => {
  const access = accessFixture();
  const operations = {origin: access.origin, audience: 'admin',
    async invoke() {return execution({epoch: 1, policy: {...policy, roles: [{id: 'administrator'}]}});},
    async status() {throw new Error('Unexpected status');}};
  const controller = createAccessAdminController({client: operations, access, persistence: persistenceFixture()});
  try {assert.deepEqual(await controller.readPolicy(), {ok: false, error: 'invalid_response'});}
  finally {controller.dispose();}
});

test('permission pagination rejects a catalog digest change and never returns mixed pages', async () => {
  const access = accessFixture();
  const operations = {origin: access.origin, audience: 'admin',
    async invoke(request) {
      if (request.bindingId === 'creezio.access:policy.read') return execution({epoch: 1, policy});
      if (request.bindingId === 'creezio.access:permissions.list') return execution(request.input.afterId == null
        ? {items: [{id: 'creezio.access:manage', moduleId: 'creezio.access', title: 'Manage',
          audiences: ['admin'], actors: ['user']}], nextAfterId: 'creezio.access:manage', catalogDigest: digest}
        : {items: [{id: 'creezio.access:other', moduleId: 'creezio.access', title: 'Other',
          audiences: ['admin'], actors: ['user']}], nextAfterId: null, catalogDigest: `sha256:${'b'.repeat(64)}`});
      throw new Error('Unexpected binding');
    }, async status() {throw new Error('Unexpected status');}};
  const controller = createAccessAdminController({client: operations, access, persistence: persistenceFixture()});
  try {assert.deepEqual(await controller.readPolicy(), {ok: false, error: 'invalid_response'});}
  finally {controller.dispose();}
});
