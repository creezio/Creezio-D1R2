import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_PERMISSION, ACCESS_POLICY_LIMITS, addsRetiredPermissionReferences, parseAccessPolicy, validPolicyCatalog, policySnapshot } from '../../core/authorization/policy.ts';
import { authorize } from '../../core/authorization/authorize.ts';
import { createAuthorizationService } from '../../core/authorization/service.ts';
import { issueOpaqueToken } from '../../core/identity/tokens.ts';

const READ = 'example.catalogue:read';
const permissions = [ACCESS_PERMISSION, { id: READ, actors: ['user'], audiences: ['app'] }];
const session = { id: 'session-1', principalId: 'user-1', audience: 'admin', expiresAtMs: 10000 };
const admin = { contextId: 'application', audience: 'admin', actors: ['user'], requiredPermissionIds: [ACCESS_PERMISSION.id], purpose: 'operation' };
function policy() {
  return {
    contexts: [{ id: 'application', status: 'active' }, { id: 'team', status: 'active' }],
    roles: [{ id: 'administrator', inherits: [], permissionIds: [ACCESS_PERMISSION.id], permissionOverrides: [] },
      { id: 'reader', inherits: [], permissionIds: [READ], permissionOverrides: [] }],
    memberships: [{ principalId: 'user-1', contextId: 'application', audience: 'admin', status: 'active' },
      { principalId: 'user-1', contextId: 'team', audience: 'app', status: 'active' }],
    assignments: [{ principalId: 'user-1', contextId: 'application', audience: 'admin', roleId: 'administrator' },
      { principalId: 'user-1', contextId: 'team', audience: 'app', roleId: 'reader' }],
    overrides: [],
  };
}

test('policy parsing copies and freezes data before async persistence without granting permission', () => {
  const input = policy(), parsed = parseAccessPolicy(input);
  assert.ok(parsed); assert.notEqual(parsed, input); assert.ok(Object.isFrozen(parsed.roles[0].permissionIds));
  input.roles[0].permissionIds.length = 0;
  assert.equal(parsed.roles[0].permissionIds[0], ACCESS_PERMISSION.id);
  assert.equal(validPolicyCatalog(parsed, permissions), true);
  assert.equal(authorize(policySnapshot(parsed, permissions, session), admin, 0).allowed, true);
});

test('policy parser refuses getters, cycles, custom prototypes, symbols, sparse arrays and foreign fields', () => {
  let getterCalls = 0;
  const accessor = policy(); Object.defineProperty(accessor.roles[0], 'id', { enumerable: true, get() { getterCalls++; return 'administrator'; } });
  const cyclic = policy(); cyclic.roles[0].inherits.push(cyclic);
  const symbol = policy(); symbol[Symbol('hidden')] = 1;
  const sparse = policy(); sparse.roles.length = 4;
  const prototype = policy(); Object.setPrototypeOf(prototype.contexts[0], { payload: true });
  for (const invalid of [null, {}, [], accessor, cyclic, symbol, sparse, prototype,
    { ...policy(), token: 'never-accepted' }, new Proxy({}, { ownKeys() { throw new Error('proxy'); } })])
    assert.equal(parseAccessPolicy(invalid), null);
  assert.equal(getterCalls, 0);
});

test('exact identifiers reject terminal newlines and wildcard grants in both policy and pure engine', () => {
  for (const suffix of ['\n', '\r', '\u2028', '\u2029', '*']) {
    const p = policy(); p.roles[0].permissionIds[0] += suffix;
    assert.equal(parseAccessPolicy(p), null);
    const snapshot = policySnapshot(policy(), permissions, session);
    snapshot.actor.id += suffix; snapshot.credential.subjectId += suffix;
    assert.equal(authorize(snapshot, admin, 0).reason, 'invalid_snapshot');
  }
});

test('policy references and composite identities cannot be missing, duplicated or cross audience', () => {
  const mutations = [
    p => p.contexts.push(p.contexts[0]), p => p.roles.push(p.roles[0]), p => p.memberships.push(p.memberships[0]),
    p => p.assignments.push(p.assignments[0]), p => { p.assignments[0].audience = 'app'; },
    p => { p.assignments[0].roleId = 'unknown'; }, p => { p.memberships[0].contextId = 'unknown'; },
    p => p.roles[0].inherits.push('missing'), p => p.roles[0].permissionIds.push(ACCESS_PERMISSION.id),
    p => p.overrides.push({ principalId: 'absent', contextId: 'team', audience: 'app', permissionId: READ, effect: 'allow' }),
    p => p.roles[0].permissionOverrides.push({ permissionId: READ, effect: 'allow' }, { permissionId: READ, effect: 'deny' }),
  ];
  for (const mutate of mutations) { const p = policy(); mutate(p); assert.equal(parseAccessPolicy(p), null); }
});

test('semantic catalog validation rejects unknown grants, conflicting definitions, cycles and excessive depth', () => {
  const unknown = policy(); unknown.roles[0].permissionIds.push('absent.module:permission');
  const cycle = policy(); cycle.roles[0].inherits = ['reader']; cycle.roles[1].inherits = ['administrator'];
  const depth = policy(); for (let i = 0; i < 17; i++) depth.roles.push({ id: `chain-${i}`,
    inherits: i ? [`chain-${i - 1}`] : [], permissionIds: [], permissionOverrides: [] });
  for (const input of [unknown, cycle, depth]) { const parsed = parseAccessPolicy(input); assert.ok(parsed); assert.equal(validPolicyCatalog(parsed, permissions), false); }
  assert.equal(validPolicyCatalog(policy(), [...permissions, ACCESS_PERMISSION]), false);
});

test('historical retired grants keep Access policy valid without becoming active permissions',()=>{
  const retired='example.removed:read',historical=policy();
  historical.roles[1].permissionIds.push(retired);
  historical.roles[1].permissionOverrides.push({permissionId:retired,effect:'allow'});
  historical.overrides.push({principalId:'user-1',contextId:'team',audience:'app',permissionId:retired,effect:'allow'});
  const parsed=parseAccessPolicy(historical);
  const catalog=[...permissions,{id:retired,audiences:[],actors:[],retired:true}];
  assert.ok(parsed);
  assert.equal(validPolicyCatalog(parsed,catalog),true);
  assert.equal(authorize(policySnapshot(parsed,catalog,{...session,audience:'app'}),
    {contextId:'team',audience:'app',actors:['user'],requiredPermissionIds:[READ],purpose:'operation'},0).allowed,true);
  assert.equal(validPolicyCatalog(parsed,permissions),false);
  assert.equal(addsRetiredPermissionReferences(parsed,parsed,catalog),false);
  const newRole=structuredClone(parsed);
  newRole.roles.push({id:'new-reader',inherits:[],permissionIds:[retired],permissionOverrides:[]});
  assert.equal(addsRetiredPermissionReferences(parsed,newRole,catalog),true);
  const lifted=structuredClone(parsed);
  lifted.roles[1].permissionOverrides[0].effect='deny';
  assert.equal(addsRetiredPermissionReferences(parsed,lifted,catalog),true);
});

test('membership is a context and audience pair, with no cross product or inactive fallback', () => {
  const p = policy();
  const snapshot = policySnapshot(p, permissions, session);
  assert.deepEqual(snapshot.actor.contextIds, ['application']);
  const target = { ...admin, contextId: 'team', audience: 'app', requiredPermissionIds: [READ] };
  assert.equal(authorize(snapshot, target, 0).allowed, false);
  const appSession = { ...session, audience: 'app' };
  assert.equal(authorize(policySnapshot(p, permissions, appSession), target, 0).allowed, true);
  p.memberships[1].status = 'disabled';
  assert.equal(authorize(policySnapshot(p, permissions, appSession), target, 0).reason, 'context_denied');
  p.memberships[1].status = 'active'; p.contexts[1].status = 'disabled';
  assert.equal(authorize(policySnapshot(p, permissions, appSession), target, 0).reason, 'context_denied');
});

test('policy count and serialized byte ceilings reject oversized persistent configurations', () => {
  const count = policy(); count.contexts = Array.from({length: ACCESS_POLICY_LIMITS.contexts + 1}, (_, i) => ({id: `c-${i}`, status: 'active'}));
  assert.equal(parseAccessPolicy(count), null);
  const bytes = policy(); bytes.roles[0].permissionIds = Array.from({ length: 500 }, (_, i) => `module.${'x'.repeat(180)}:permission-${i}`);
  assert.equal(parseAccessPolicy(bytes), null);
  let inspected = 0;
  const huge = policy(); huge.roles[0].inherits = new Proxy(new Array(1025), {
    ownKeys() { inspected++; throw new Error('Do not enumerate an oversized array'); },
  });
  assert.equal(parseAccessPolicy(huge), null); assert.equal(inspected, 0);
});

test('the expected policy epoch is captured before awaiting the server snapshot', async () => {
  const input = { expectedEpoch: 1, policy: policy() };
  const result = rows => ({ success: true, results: rows, meta: {changes: 0} });
  const p = policy();
  const rows = [
    result([{ ...session, displayName: 'Synthetic actor', authVersion: 1, createdAtMs: 0, epoch: 2, nowMs: 1000 }]),
    result([{id: 'user-1', kind: 'human', status: 'active', humanStatus: 'active'}]),
    result(p.contexts), result(p.roles.map(r => ({id: r.id}))), result([]),
    result(p.roles.flatMap(r => r.permissionIds.map(permissionId => ({roleId: r.id, permissionId})))),
    result([]), result(p.memberships), result(p.assignments), result([]),
  ];
  let batches = 0;
  const db = { prepare() { return {bind() { return {}; }}; }, async batch() {
    batches++; assert.equal(batches, 1, 'A stale request must never start a commit batch');
    input.expectedEpoch = 2; return rows;
  }};
  const token = await issueOpaqueToken('session');
  const service = createAuthorizationService(db, {permissions: permissions.slice(1)});
  assert.deepEqual(await service.replacePolicy(token.token, input), {ok: false, error: 'conflict'});
  assert.equal(batches, 1);
});

test('Access rejects a newly granted retired right while keeping a historical grant in D1',async()=>{
  const retired='old.module:read',p=policy();
  p.roles[1].permissionIds.push(retired);
  const result=rows=>({success:true,results:rows,meta:{changes:0}});
  const rows=[
    result([{...session,displayName:'Synthetic actor',authVersion:1,createdAtMs:0,epoch:2,nowMs:1000}]),
    result([{id:'user-1',kind:'human',status:'active',humanStatus:'active'}]),
    result(p.contexts),result(p.roles.map(role=>({id:role.id}))),result([]),
    result(p.roles.flatMap(role=>role.permissionIds.map(permissionId=>({roleId:role.id,permissionId})))),
    result([]),result(p.memberships),result(p.assignments),result([]),
  ];
  let batches=0;
  const db={prepare(){return {bind(){return {};}};},async batch(){batches++;return rows;}};
  const token=await issueOpaqueToken('session');
  const service=createAuthorizationService(db,{permissions:[permissions[1],
    {id:retired,audiences:[],actors:[],retired:true}]});
  const next=structuredClone(p);
  next.roles[0].permissionIds.push(retired);
  assert.deepEqual(await service.replacePolicy(token.token,{expectedEpoch:2,policy:next}),
    {ok:false,error:'invalid_input'});
  assert.equal(batches,1,'a new retired grant must not start a policy commit');
});

test('service rejects malformed policy requests and replacement of built-in authority without touching D1', async () => {
  const db = { prepare() { assert.fail('invalid input must not access D1'); }, batch() { assert.fail('invalid input must not access D1'); } };
  assert.throws(() => createAuthorizationService(db, { permissions: [ACCESS_PERMISSION] }), /Invalid server permission catalog/);
  const service = createAuthorizationService(db, { permissions: [] });
  for (const input of [null, {}, {expectedEpoch: 0, policy: policy()}, {expectedEpoch: 1, policy: policy()},
    {expectedEpoch: 1, policy: {}, actor: 'owner'}, new Proxy({}, { ownKeys() { throw new Error('proxy'); } })])
    assert.deepEqual(await service.replacePolicy('bad-token', input), { ok: false, error: 'invalid_input' });
  assert.deepEqual(await service.readPolicy('bad-token'), { ok: false, error: 'unauthorized' });
});
