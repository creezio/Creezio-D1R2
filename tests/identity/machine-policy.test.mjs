import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMachineScopes, parseStoredMachineScopeRows, MACHINE_SCOPE_LIMITS } from '../../core/identity/machine-policy.ts';

const tuple = (contextId = 'workspace-a', audience = 'app', permissionIds = ['example.notes:read']) => ({ contextId, audience, permissionIds });

test('machine scope parsing preserves exact pairs and returns a detached deeply frozen copy', () => {
  const input = [tuple('workspace-a', 'app', ['example.notes:read']), tuple('workspace-a', 'admin', ['example.notes:write']),
    tuple('workspace-b', 'app', ['example.notes:write'])];
  const parsed = parseMachineScopes(input);
  assert.deepEqual(parsed, input); assert.notEqual(parsed, input); assert.notEqual(parsed[0], input[0]);
  input[0].contextId = 'changed'; input[0].permissionIds.push('example.notes:write'); input.push(tuple('extra'));
  assert.equal(parsed.length, 3); assert.equal(parsed[0].contextId, 'workspace-a');
  assert.deepEqual(parsed[0].permissionIds, ['example.notes:read']);
  assert.deepEqual(parsed[1].permissionIds, ['example.notes:write']);
  assert.throws(() => parsed.push(tuple()), TypeError);
  assert.throws(() => { parsed[0].audience = 'admin'; }, TypeError);
  assert.throws(() => parsed[0].permissionIds.push('example.notes:write'), TypeError);
});

test('null-prototype records remain supported but arrays and values must be plain inert data', () => {
  assert.deepEqual(parseMachineScopes([Object.assign(Object.create(null), tuple())]), [tuple()]);
  const foreignArray = [tuple()]; Object.setPrototypeOf(foreignArray, Object.create(Array.prototype));
  const noPrototypeArray = [tuple()]; Object.setPrototypeOf(noPrototypeArray, null);
  for (const value of [null, undefined, {}, [], 1, true, 'scope', new Set([tuple()]), foreignArray, noPrototypeArray,
    [Object.create(tuple())], [new Date()], [tuple('a', 'app', new Set(['example.notes:read']))]]) {
    assert.equal(parseMachineScopes(value), null);
  }
});

test('wildcards, malformed qualified IDs, empty grants and duplicate exact tuples are rejected', () => {
  for (const contextId of ['', '*', 'space context', '../escape', 'c\n', 'a'.repeat(129), null])
    assert.equal(parseMachineScopes([tuple(contextId)]), null);
  for (const audience of ['', '*', 'owner', 'admin\n', ['admin'], null])
    assert.equal(parseMachineScopes([tuple('a', audience)]), null);
  for (const permission of ['', '*', 'example.notes:*', 'example..notes:read', 'Example.notes:read',
    'example.notes', 'example.notes:read\n', 'example.notes:read\u2028', `example.notes:${'a'.repeat(256)}`, null])
    assert.equal(parseMachineScopes([tuple('a', 'app', [permission])]), null);
  assert.equal(parseMachineScopes([tuple('a', 'app', [])]), null);
  assert.equal(parseMachineScopes([tuple('a', 'app', ['example.notes:read', 'example.notes:read'])]), null);
  assert.equal(parseMachineScopes([tuple('a'), tuple('a', 'app', ['example.notes:write'])]), null);
  assert.deepEqual(parseMachineScopes([tuple('a'), tuple('b')]), [tuple('a'), tuple('b')]);
});

test('closed tuples and dense arrays reject hidden fields, symbols, sparse arrays and cycles', () => {
  const extra = { ...tuple(), permissionId: 'example.notes:write' };
  const hidden = Object.defineProperty(tuple(), 'extra', { value: 'hidden' });
  const symbol = { ...tuple(), [Symbol('scope')]: 'extra' };
  const sparse = Array(1), sparsePermissions = tuple('a', 'app', Array(1));
  const ownIterator = [tuple()]; ownIterator[Symbol.iterator] = () => { assert.fail('Do not execute input iterators'); };
  const extraArrayProperty = [tuple()]; extraArrayProperty.extra = true;
  const cycle = []; cycle.push(cycle);
  const tupleCycle = tuple(); tupleCycle.permissionIds = [tupleCycle];
  const hiddenPermission = ['example.notes:read']; Object.defineProperty(hiddenPermission, '0', { enumerable: false });
  for (const value of [[extra], [hidden], [symbol], sparse, [sparsePermissions], ownIterator, extraArrayProperty,
    cycle, [tupleCycle], [tuple('a', 'app', hiddenPermission)]]) assert.equal(parseMachineScopes(value), null);
});

test('getters are never executed and exceptions from hostile proxy reflection fail closed', () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty(tuple(), 'contextId', { enumerable: true, get() { getterCalls++; throw new Error('Getter'); } });
  const permissions = ['example.notes:read'];
  Object.defineProperty(permissions, '0', { enumerable: true, get() { getterCalls++; throw new Error('Getter'); } });
  const tuples = [tuple()]; Object.defineProperty(tuples, '0', { enumerable: true, get() { getterCalls++; throw new Error('Getter'); } });
  for (const value of [[accessor], [tuple('a', 'app', permissions)], tuples,
    new Proxy([tuple()], { getPrototypeOf() { throw new Error('Proxy'); } }),
    [new Proxy(tuple(), { ownKeys() { throw new Error('Proxy'); } })],
    [tuple('a', 'app', new Proxy(['example.notes:read'], { getOwnPropertyDescriptor() { throw new Error('Proxy'); } }))]])
    assert.equal(parseMachineScopes(value), null);
  assert.equal(getterCalls, 0);
  const noPropertyReads = new Proxy(tuple(), { get() { assert.fail('Descriptor parsing must not read proxy properties'); } });
  assert.deepEqual(parseMachineScopes([noPropertyReads]), [tuple()]);
});

test('tuple and total permission budgets are exact, summed across repeated permissions in different pairs', () => {
  assert.deepEqual(MACHINE_SCOPE_LIMITS, { tuples: 64, permissions: 256 });
  const maximum = Array.from({ length: 64 }, (_, n) => tuple(`c${n}`, 'app',
    ['example.notes:read', 'example.notes:write', 'example.notes:export', 'example.notes:delete']));
  assert.equal(parseMachineScopes(maximum).length, 64);
  assert.equal(parseMachineScopes([...maximum, tuple('extra')]), null);
  maximum[63].permissionIds.push('example.notes:archive'); assert.equal(parseMachineScopes(maximum), null);
  assert.equal(parseMachineScopes([tuple('one', 'app', Array.from({ length: 256 }, (_, n) => `example.notes:p${n}`))])[0].permissionIds.length, 256);
  assert.equal(parseMachineScopes([tuple('one', 'app', Array.from({ length: 257 }, (_, n) => `example.notes:p${n}`))]), null);
});

test('oversized arrays are rejected before own-key enumeration and there is no catalogue lookup or normalization', () => {
  let inspected = 0;
  const oversized = new Proxy(Array(65), { ownKeys() { inspected++; throw new Error('Must not enumerate'); } });
  const oversizedPermissions = new Proxy(Array(257), { ownKeys() { inspected++; throw new Error('Must not enumerate'); } });
  assert.equal(parseMachineScopes(oversized), null);
  assert.equal(parseMachineScopes([tuple('a', 'app', oversizedPermissions)]), null);
  assert.equal(inspected, 0);
  const declaration = tuple('Opaque:Context-A', 'admin', ['unknown.connector:future-action']);
  assert.deepEqual(parseMachineScopes([declaration]), [declaration], 'catalogue, actor and effective rights are enforced by the server service');
});

test('stored scope rows regroup only their exact context/audience pairs into the same immutable contract', () => {
  const rows = [
    { contextId: 'a', audience: 'app', permissionId: 'example.notes:read' },
    { contextId: 'b', audience: 'admin', permissionId: 'example.notes:write' },
    { contextId: 'a', audience: 'app', permissionId: 'example.notes:export' },
    { contextId: 'a', audience: 'admin', permissionId: 'example.notes:write' },
  ];
  const result = parseStoredMachineScopeRows(rows);
  assert.deepEqual(result, [tuple('a', 'app', ['example.notes:read', 'example.notes:export']),
    tuple('b', 'admin', ['example.notes:write']), tuple('a', 'admin', ['example.notes:write'])]);
  rows[0].permissionId = 'example.notes:delete';
  assert.deepEqual(result[0].permissionIds, ['example.notes:read', 'example.notes:export']);
  assert.throws(() => result[0].permissionIds.push('example.notes:delete'), TypeError);
});

test('stored scope projections reject corruption, duplicate rows, hidden fields, accessors and overflow sentinels', () => {
  const row = { contextId: 'a', audience: 'app', permissionId: 'example.notes:read' };
  const getter = Object.defineProperty({ ...row }, 'permissionId', { enumerable: true, get() { assert.fail('Getter must not run'); } });
  for (const value of [null, [], {}, [row, row], [{ ...row, audience: '*' }], [{ ...row, permissionId: 'example.notes:*' }],
    [{ ...row, secret_hash: 'Unexpected storage projection' }], [getter], Array(1),
    new Proxy([row], { ownKeys() { throw new Error('Reflection failure'); } }),
    Array.from({ length: 65 }, (_, n) => ({ ...row, contextId: `c${n}` })),
    Array.from({ length: 257 }, (_, n) => ({ ...row, permissionId: `example.notes:p${n}` }))])
    assert.equal(parseStoredMachineScopeRows(value), null);
  assert.equal(parseStoredMachineScopeRows(Array.from({ length: 256 }, (_, n) => ({ ...row, permissionId: `example.notes:p${n}` })))[0].permissionIds.length, 256);
});
