import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, AUTHORIZATION_LIMITS } from '../../core/authorization/index.ts';

const NOW = 1_000_000;
const READ = 'example.catalogue:read', WRITE = 'example.catalogue:write';
const APPROVE = 'creezio.tasks:approve', ADMIN = 'creezio.access:manage';
const ALL_ACTORS = ['user', 'machine', 'delegated-user'];
const target = changes => ({ contextId: 'workspace-a', audience: 'app', actors: [...ALL_ACTORS], requiredPermissionIds: [READ], purpose: 'operation', ...changes });
function snapshot() {
  return {
    actor: { id: 'account-1', kind: 'human', enabled: true, contextIds: ['workspace-a'], audiences: ['app'] },
    credential: { id: 'credential-1', subjectId: 'account-1', kind: 'session', enabled: true, expiresAtMs: NOW + 60_000,
      contextIds: ['workspace-a'], audiences: ['app'], permissionIds: [READ, WRITE, APPROVE, ADMIN] },
    permissions: [
      { id: READ, audiences: ['app'], actors: [...ALL_ACTORS] },
      { id: WRITE, audiences: ['app'], actors: [...ALL_ACTORS] },
      { id: APPROVE, audiences: ['app'], actors: [...ALL_ACTORS] },
      { id: ADMIN, audiences: ['admin'], actors: ['user', 'delegated-user'] },
    ],
    roles: [
      { id: 'reader', inherits: [], permissionIds: [READ], permissionOverrides: [] },
      { id: 'editor', inherits: ['reader'], permissionIds: [WRITE], permissionOverrides: [] },
      { id: 'approver', inherits: [], permissionIds: [APPROVE], permissionOverrides: [] },
      { id: 'administrator', inherits: [], permissionIds: [ADMIN], permissionOverrides: [] },
    ],
    assignments: [{ roleId: 'reader', contextId: 'workspace-a', audiences: ['app'] }],
    overrides: [],
  };
}
function expect(reason, state = snapshot(), policy = target(), at = NOW) {
  assert.deepEqual(authorize(state, policy, at), { allowed: reason === 'allowed', reason });
}
const override = (effect, changes) => ({ permissionId: WRITE, contextId: 'workspace-a', audiences: ['app'], effect, ...changes });

test('a fresh native session uses only exact current grants and returns an immutable decision', () => {
  const state = snapshot(), policy = target(), before = structuredClone({ state, policy });
  expect('allowed', state, policy);
  expect('permission_denied', state, target({ requiredPermissionIds: [WRITE] }));
  assert.deepEqual({ state, policy }, before);
  assert.ok(Object.isFrozen(authorize(state, policy, NOW)));
});

test('all required permissions must be granted; role inheritance and diamond graphs are deterministic', () => {
  const state = snapshot(); state.assignments[0].roleId = 'editor';
  state.roles.push({ id: 'double-reader', inherits: ['reader'], permissionIds: [], permissionOverrides: [] },
    { id: 'composite', inherits: ['editor', 'double-reader'], permissionIds: [], permissionOverrides: [] });
  state.assignments[0].roleId = 'composite';
  expect('allowed', state, target({ requiredPermissionIds: [READ, WRITE] }));
  state.roles.reverse(); expect('allowed', state, target({ requiredPermissionIds: [READ, WRITE] }));
  expect('permission_denied', state, target({ requiredPermissionIds: [READ, WRITE, APPROVE] }));
});

test('an account allow can add a known grant but cannot override an account deny, regardless of order', () => {
  const state = snapshot(); state.overrides = [override('allow')];
  expect('allowed', state, target({ requiredPermissionIds: [WRITE] }));
  state.overrides.push(override('deny'));
  expect('permission_denied', state, target({ requiredPermissionIds: [WRITE] }));
  state.overrides.reverse(); expect('permission_denied', state, target({ requiredPermissionIds: [WRITE] }));
  state.assignments[0].roleId = 'editor'; expect('permission_denied', state, target({ requiredPermissionIds: [WRITE] }));
});

test('role overrides replace defaults, inherit denials, and explicitly lift a parent denial', () => {
  const state = snapshot(); state.assignments[0].roleId = 'editor';
  state.roles[0].permissionOverrides = [{ permissionId: READ, effect: 'deny' }];
  state.roles[1].permissionIds.push(READ); // A default grant does not erase inherited denial.
  expect('permission_denied', state);
  state.roles[1].permissionOverrides = [{ permissionId: READ, effect: 'allow' }];
  expect('allowed', state);
  state.roles[1].permissionOverrides = []; expect('permission_denied', state);
  state.roles[0].permissionOverrides = []; expect('allowed', state);
  state.roles[1].permissionOverrides = [{ permissionId: WRITE, effect: 'deny' }];
  expect('permission_denied', state, target({ requiredPermissionIds: [WRITE] }));
});

test('parent conflicts are deterministic and require an explicit child override', () => {
  const state = snapshot(); state.assignments[0].roleId = 'combined';
  state.roles.push({ id: 'blocked', inherits: [], permissionIds: [], permissionOverrides: [{ permissionId: READ, effect: 'deny' }] },
    { id: 'combined', inherits: ['reader', 'blocked'], permissionIds: [], permissionOverrides: [] });
  expect('permission_denied', state);
  state.roles.at(-1).inherits.reverse(); expect('permission_denied', state);
  state.roles.at(-1).permissionOverrides = [{ permissionId: READ, effect: 'allow' }]; expect('allowed', state);
  state.roles.reverse(); expect('allowed', state);
});

test('conflicts between assigned roles deny independently of role and assignment order', () => {
  const state = snapshot(); state.roles[0].permissionOverrides = [{ permissionId: READ, effect: 'deny' }];
  state.roles[1].permissionOverrides = [{ permissionId: READ, effect: 'allow' }];
  state.assignments.push({ roleId: 'editor', contextId: 'workspace-a', audiences: ['app'] });
  expect('permission_denied', state);
  state.roles.reverse(); state.assignments.reverse(); expect('permission_denied', state);
  state.assignments.find(item => item.roleId === 'reader').contextId = 'workspace-b'; expect('allowed', state);
});

test('account allow can lift a role denial, while any matching account deny wins', () => {
  const state = snapshot(); state.roles[0].permissionOverrides = [{ permissionId: READ, effect: 'deny' }];
  expect('permission_denied', state);
  state.overrides = [override('allow', { permissionId: READ })]; expect('allowed', state);
  state.overrides.push(override('deny', { permissionId: READ })); expect('permission_denied', state);
  state.overrides.reverse(); expect('permission_denied', state);
  state.overrides = [override('allow', { permissionId: READ, contextId: 'workspace-b' })]; expect('permission_denied', state);
});

test('role and account overrides cannot bypass credential scope, actor, audience or context restrictions', () => {
  for (const level of ['role', 'account']) {
    const state = snapshot(); state.roles[0].permissionIds = [];
    if (level === 'role') state.roles[0].permissionOverrides = [{ permissionId: READ, effect: 'allow' }];
    else state.overrides = [override('allow', { permissionId: READ })];
    expect('allowed', state);
    state.credential.permissionIds = []; expect('scope_denied', state);
    state.credential.permissionIds = [READ]; state.credential.contextIds = []; expect('scope_denied', state);
    state.credential.contextIds = ['workspace-a']; state.credential.audiences = []; expect('scope_denied', state);
    state.credential.audiences = ['app']; state.permissions[0].actors = ['machine']; expect('actor_denied', state);
    state.permissions[0].actors = ALL_ACTORS; state.permissions[0].audiences = ['admin']; expect('audience_denied', state);
    state.permissions[0].audiences = ['app']; state.actor.contextIds = []; expect('context_denied', state);
  }
});

test('role overrides are explicit bounded declarations and duplicate permissions are invalid', () => {
  for (const mutate of [
    state => { delete state.roles[0].permissionOverrides; },
    state => { state.roles[0].permissionOverrides = [{ permissionId: READ, effect: 'inherit' }]; },
    state => { state.roles[0].permissionOverrides = [{ permissionId: READ, effect: 'allow', owner: true }]; },
    state => { state.roles[0].permissionOverrides = Array(1001).fill({ permissionId: READ, effect: 'allow' }); },
  ]) { const state = snapshot(); mutate(state); expect('invalid_snapshot', state); }
  for (const effect of ['allow', 'deny']) {
    const state = snapshot();
    state.roles[0].permissionOverrides = [{ permissionId: READ, effect: 'allow' }, { permissionId: READ, effect }];
    expect('invalid_snapshot', state); state.roles[0].permissionOverrides.reverse(); expect('invalid_snapshot', state);
  }
});

test('a role name or account identity called owner never creates a fallback permission', () => {
  const state = snapshot(); state.actor.id = 'owner'; state.credential.subjectId = 'owner';
  state.roles = [{ id: 'owner', inherits: [], permissionIds: [], permissionOverrides: [] }]; state.assignments[0].roleId = 'owner';
  expect('permission_denied', state);
  state.roles = []; state.assignments = []; expect('permission_denied', state);
});

test('permission identifiers are exact, with no wildcard, prefix or case normalization', () => {
  const state = snapshot();
  expect('permission_unknown', state, target({ requiredPermissionIds: ['example.catalogue:read-other'] }));
  expect('invalid_target', state, target({ requiredPermissionIds: ['example.catalogue:*'] }));
  expect('invalid_target', state, target({ requiredPermissionIds: ['Example.catalogue:read'] }));
  state.roles[0].permissionIds = ['example.catalogue:*']; expect('invalid_snapshot', state);
});

test('actor membership, credential scope and grant context each independently constrain access', () => {
  const state = snapshot();
  expect('context_denied', state, target({ contextId: 'workspace-b' }));
  state.actor.contextIds.push('workspace-b'); expect('scope_denied', state, target({ contextId: 'workspace-b' }));
  state.credential.contextIds.push('workspace-b'); expect('permission_denied', state, target({ contextId: 'workspace-b' }));
  state.assignments.push({ roleId: 'reader', contextId: 'workspace-b', audiences: ['app'] });
  expect('allowed', state, target({ contextId: 'workspace-b' }));
  state.overrides = [override('deny', { permissionId: READ, contextId: 'workspace-b' })];
  expect('permission_denied', state, target({ contextId: 'workspace-b' })); expect('allowed', state);
});

test('a workspace operator cannot enter system administration by changing the requested audience', () => {
  const state = snapshot(), administration = target({ audience: 'admin', requiredPermissionIds: [ADMIN] });
  expect('audience_denied', state, administration);
  state.actor.audiences.push('admin'); expect('scope_denied', state, administration);
  state.credential.audiences.push('admin'); expect('permission_denied', state, administration);
  state.assignments.push({ roleId: 'administrator', contextId: 'workspace-a', audiences: ['app'] });
  expect('permission_denied', state, administration);
  state.assignments.at(-1).audiences = ['admin']; expect('allowed', state, administration);
  expect('audience_denied', state, target({ requiredPermissionIds: [ADMIN] }));
});

test('overrides apply only to their exact context and audience', () => {
  const state = snapshot();
  state.overrides = [override('allow', { contextId: 'workspace-b' }), override('allow', { audiences: ['admin'] })];
  expect('permission_denied', state, target({ requiredPermissionIds: [WRITE] }));
  state.overrides = [override('deny', { permissionId: READ, audiences: ['admin'] })]; expect('allowed', state);
});

test('disabled identities, revoked credentials and expired sessions are denied on every fresh decision', () => {
  const state = snapshot(); expect('allowed', state);
  state.actor.enabled = false; expect('actor_disabled', state);
  state.actor.enabled = true; state.credential.enabled = false; expect('credential_disabled', state);
  state.credential.enabled = true; state.credential.expiresAtMs = NOW; expect('credential_expired', state);
  state.credential.expiresAtMs = NOW + 1; expect('allowed', state);
  expect('credential_expired', state, target(), NOW + 1);
});

test('credential subject must equal the already resolved actor', () => {
  const state = snapshot(); state.credential.subjectId = 'another-account'; expect('credential_subject', state);
});

test('API credentials and OAuth scopes intersect current permissions and cannot replace removed grants', () => {
  for (const kind of ['api-token', 'oauth']) {
    const state = snapshot(); state.credential.kind = kind; expect('allowed', state);
    state.credential.permissionIds = []; expect('scope_denied', state);
    state.credential.permissionIds = [READ]; state.roles[0].permissionIds = []; expect('permission_denied', state);
    state.roles[0].permissionIds = [READ]; expect('allowed', state);
    state.overrides = [override('deny', { permissionId: READ })]; expect('permission_denied', state);
  }
});

test('session maximum scope is also intersected with fresh authorization state', () => {
  const state = snapshot(); state.credential.permissionIds = []; expect('scope_denied', state);
  state.overrides = [override('allow', { permissionId: READ })]; expect('scope_denied', state);
});

test('service accounts use machine credentials, never an invented browser session or delegated human', () => {
  const state = snapshot(); state.actor.kind = 'service';
  expect('credential_kind', state);
  state.credential.kind = 'oauth'; expect('credential_kind', state);
  state.credential.kind = 'api-token'; expect('allowed', state);
  expect('actor_denied', state, target({ actors: ['user', 'delegated-user'] }));
});

test('an API token owned by a human still acts through the machine channel', () => {
  const state = snapshot(); state.credential.kind = 'api-token';
  expect('actor_denied', state, target({ actors: ['user'] }));
  expect('allowed', state, target({ actors: ['machine'] }));
  state.permissions[0].actors = ['user']; expect('actor_denied', state);
});

test('OAuth delegation remains distinct from the native browser session', () => {
  const state = snapshot(); state.credential.kind = 'oauth';
  expect('actor_denied', state, target({ actors: ['user'] }));
  expect('allowed', state, target({ actors: ['delegated-user'] }));
  state.permissions[0].actors = ['user']; expect('actor_denied', state);
});

test('human session or delegated OAuth may be eligible to approve, but no approval receipt is fabricated', () => {
  const state = snapshot(), policy = target({ requiredPermissionIds: [APPROVE], purpose: 'human-approval' });
  state.assignments[0].roleId = 'approver';
  for (const kind of ['session', 'oauth']) {
    state.credential.kind = kind; expect('allowed', state, policy);
    assert.deepEqual(Object.keys(authorize(state, policy, NOW)).sort(), ['allowed', 'reason']);
  }
  state.credential.kind = 'api-token'; expect('human_approval_required', state, policy);
  state.actor.kind = 'service'; expect('human_approval_required', state, policy);
});

test('authenticated operations with no specific permission remain constrained by identity, actor, audience and context', () => {
  const state = snapshot(), policy = target({ requiredPermissionIds: [], actors: ['user'] });
  state.permissions = []; state.roles = []; state.assignments = []; state.credential.permissionIds = [];
  expect('allowed', state, policy);
  state.credential.kind = 'api-token'; expect('actor_denied', state, policy);
  state.credential.kind = 'session'; expect('context_denied', state, { ...policy, contextId: 'workspace-b' });
  expect('audience_denied', state, { ...policy, audience: 'admin' });
  state.credential.audiences = []; expect('scope_denied', state, policy);
  state.credential.enabled = false; expect('credential_disabled', state, policy);
});

test('empty required permissions do not exempt a machine from a human approval restriction', () => {
  const state = snapshot(); state.credential.kind = 'api-token';
  expect('human_approval_required', state, target({ requiredPermissionIds: [], purpose: 'human-approval' }));
});

test('missing role parents and assignments fail closed, including unused invalid roles', () => {
  const state = snapshot(); state.roles[1].inherits = ['missing']; expect('role_missing', state);
  state.roles[1].inherits = ['reader']; state.assignments[0].roleId = 'missing'; expect('role_missing', state);
});

test('inheritance cycles cannot be hidden by another valid grant', () => {
  const state = snapshot(); state.roles[0].inherits = ['editor']; expect('role_cycle', state);
  state.roles[0].inherits = ['reader']; expect('role_cycle', state);
});

test('inheritance depth stays bounded independently of role ordering and memoized ancestors', () => {
  const state = snapshot();
  state.roles = Array.from({ length: AUTHORIZATION_LIMITS.roleDepth }, (_, index) => ({ id: `role-${index}`,
    inherits: index ? [`role-${index - 1}`] : [], permissionIds: index ? [] : [READ], permissionOverrides: [] }));
  state.assignments[0].roleId = state.roles.at(-1).id; expect('allowed', state);
  state.roles.push({ id: 'too-deep', inherits: [state.roles.at(-1).id], permissionIds: [], permissionOverrides: [] }); expect('role_depth', state);
  state.roles.reverse(); expect('role_depth', state);
});

test('unknown permission references and duplicate identities cannot become implicit grants', () => {
  for (const mutate of [
    state => { state.roles[0].permissionIds.push('example.catalogue:missing'); },
    state => { state.roles[0].permissionOverrides.push({ permissionId: 'example.catalogue:missing', effect: 'allow' }); },
    state => { state.credential.permissionIds.push('example.catalogue:missing'); },
    state => { state.overrides.push(override('allow', { permissionId: 'example.catalogue:missing' })); },
  ]) { const state = snapshot(); mutate(state); expect('permission_unknown', state); }
  for (const mutate of [state => state.permissions.push(state.permissions[0]), state => state.roles.push(state.roles[0])]) {
    const state = snapshot(); mutate(state); expect('invalid_snapshot', state);
  }
});

test('bounded plain snapshots reject malformed, oversized and incomplete state instead of guessing defaults', () => {
  for (const state of [null, {}, [], { ...snapshot(), actor: null }, { ...snapshot(), owner: true }]) expect('invalid_snapshot', state);
  for (const mutate of [
    state => { delete state.credential.enabled; },
    state => { state.actor.kind = 'owner'; },
    state => { state.actor.kind = Object.create(null); },
    state => { state.actor.contextIds = ['*']; },
    state => { state.roles = Array.from({ length: AUTHORIZATION_LIMITS.roles + 1 }, (_, index) => ({ id: `role-${index}`, inherits: [], permissionIds: [], permissionOverrides: [] })); },
    state => { state.actor.id = 'x'.repeat(257); },
    state => { state.permissions.push(...Array(1000).fill(state.permissions[0])); },
  ]) { const state = snapshot(); mutate(state); expect('invalid_snapshot', state); }
  for (const policy of [null, {}, { ...target(), actors: [] }, { ...target(), purpose: undefined }]) expect('invalid_target', snapshot(), policy);
  for (const time of [NaN, Infinity, -1, 0.1, '1000000']) expect('invalid_time', snapshot(), target(), time);
});

test('data inspection does not invoke accessors and rejects cycles or executable inputs', () => {
  let calls = 0; const state = snapshot();
  Object.defineProperty(state.actor, 'enabled', { enumerable: true, get() { calls++; return true; } });
  expect('invalid_snapshot', state); assert.equal(calls, 0);
  const cyclic = snapshot(); cyclic.roles[0].inherits = [cyclic]; expect('invalid_snapshot', cyclic);
  const executable = snapshot(); executable.actor.enabled = () => true; expect('invalid_snapshot', executable);
  const custom = snapshot(); Object.setPrototypeOf(custom.actor, { enabled: true }); expect('invalid_snapshot', custom);
});

test('array prototypes cannot run custom methods or make malformed state throw', () => {
  let calls = 0; const state = snapshot();
  const prototype = Object.create(Array.prototype);
  prototype.includes = () => { calls++; return true; };
  prototype.every = () => { calls++; return true; };
  Object.setPrototypeOf(state.actor.contextIds, prototype);
  expect('invalid_snapshot', state); assert.equal(calls, 0);
  const nullPrototype = snapshot(); Object.setPrototypeOf(nullPrototype.actor.contextIds, null);
  expect('invalid_snapshot', nullPrototype);
  const policy = target(); Object.setPrototypeOf(policy.actors, prototype);
  expect('invalid_target', snapshot(), policy); assert.equal(calls, 0);
});

test('a fresh decision sees removed grants and membership without any module-level cache', () => {
  const state = snapshot(); expect('allowed', state);
  const revoked = structuredClone(state); revoked.assignments = []; expect('permission_denied', revoked);
  expect('allowed', state);
  revoked.assignments = structuredClone(state.assignments); revoked.actor.contextIds = []; expect('context_denied', revoked);
  state.credential.enabled = false; expect('credential_disabled', state);
});
