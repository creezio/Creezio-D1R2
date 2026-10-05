import test from 'node:test';
import assert from 'node:assert/strict';
import { changedEffects, draftRefreshDecision, matrixFromPolicy, principalScope, rolePermissionKey, rolePermissionTuple,
  shouldPurgeAdminView }
  from '../../ui/projection.ts';

const policy = {
  epoch: 7,
  permissions: [
    {id: 'alpha:read', moduleId: 'alpha', title: 'Lire', audiences: ['admin', 'app'], actors: ['user']},
    {id: 'beta:write', moduleId: 'beta', title: 'Écrire', audiences: ['admin'], actors: ['user']}
  ],
  policy: {
    contexts: [{id: 'application', status: 'active'}],
    roles: [
      {id: 'a', inherits: [], permissionIds: ['alpha:read'], permissionOverrides: []},
      {id: 'ab', inherits: ['a'], permissionIds: [],
        permissionOverrides: [{permissionId: 'alpha:read', effect: 'deny'}, {permissionId: 'beta:write', effect: 'allow'}]}
    ],
    memberships: [{principalId: 'person', contextId: 'application', audience: 'admin', status: 'active'}],
    assignments: [
      {principalId: 'person', contextId: 'application', audience: 'admin', roleId: 'a'},
      {principalId: 'person', contextId: 'application', audience: 'admin', roleId: 'ab'}
    ],
    overrides: [{principalId: 'person', contextId: 'application', audience: 'admin',
      permissionId: 'alpha:read', effect: 'allow'}]
  }
};

test('role-permission keys remain unambiguous for adjacent IDs', () => {
  const first = rolePermissionKey('a', 'bc'), second = rolePermissionKey('ab', 'c');
  assert.notEqual(first, second);
  assert.deepEqual(rolePermissionTuple(first), ['a', 'bc']);
  assert.deepEqual(rolePermissionTuple(second), ['ab', 'c']);
});

test('matrix and account projection preserve inheritance, role denial and multi-role scope', () => {
  const matrix = matrixFromPolicy(policy);
  assert.deepEqual(matrix.roles[1].defaults, ['alpha:read']);
  assert.deepEqual(matrix.roles[1].effective, ['beta:write']);
  assert.equal(matrix.groups.length, 2);
  assert.equal(matrix.groups[0].permissions[0].label, 'Lire');
  const scope = principalScope(policy, 'person', 'application', 'admin');
  assert.deepEqual(scope.assignmentIds, ['a', 'ab']);
  assert.deepEqual(scope.baseline, ['beta:write']);
  assert.deepEqual(scope.effective.sort(), ['alpha:read', 'beta:write']);
  assert.equal(principalScope(policy, 'person', 'application', 'app').assignmentIds.length, 0);
});

test('retired rights remain visible as history but leave every account scope',()=>{
  const historical=structuredClone(policy);
  historical.permissions.push({id:'old.module:read',moduleId:'old.module',title:'old.module:read (retiré)',
    audiences:[],actors:[]});
  historical.policy.roles[0].permissionIds.push('old.module:read');
  const matrix=matrixFromPolicy(historical);
  assert.equal(matrix.groups.find(group=>group.id==='old.module').permissions[0].retired,true);
  assert.ok(!principalScope(historical,'person','application','admin').effective.includes('old.module:read'));
});

test('draft comparison keeps reset-to-inherited changes', () => {
  const initial = new Map([[rolePermissionKey('ab', 'alpha:read'), 'deny']]);
  assert.deepEqual(changedEffects(initial, new Map()),
    [{key: rolePermissionKey('ab', 'alpha:read'), effect: 'inherit'}]);
});

test('external epoch preserves a dirty draft until explicit discard; clean state adopts it', () => {
  const initial = new Map([[rolePermissionKey('ab', 'alpha:read'), 'deny']]);
  const draft = new Map(initial);
  draft.set(rolePermissionKey('ab', 'alpha:read'), 'allow');
  assert.equal(draftRefreshDecision(7, 8, initial, draft), 'preserve-stale');
  assert.equal(draftRefreshDecision(7, 8, initial, new Map(initial)), 'adopt');
  assert.equal(draftRefreshDecision(7, 7, initial, draft), 'same');
});

test('workspace verification retains a dirty draft; confirmed identity loss purges it', () => {
  const identityVersion = 3;
  assert.equal(shouldPurgeAdminView({authorized: false, suspended: true, identityVersion}, identityVersion), false);
  assert.equal(shouldPurgeAdminView({authorized: true, suspended: false, identityVersion}, identityVersion), false);
  assert.equal(shouldPurgeAdminView({authorized: false, suspended: false, identityVersion: 4}, identityVersion), true);
  assert.equal(shouldPurgeAdminView({authorized: true, suspended: false, identityVersion: 4}, identityVersion), true);
});
