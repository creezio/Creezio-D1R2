import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPERSONATION_LIMITS, normalizeImpersonationReason, parseImpersonationPermissions } from '../../core/identity/impersonation-policy.ts';
import { createImpersonationService } from '../../core/identity/impersonation.ts';
import { issueOpaqueToken } from '../../core/identity/tokens.ts';

test('impersonation scope is a detached, canonical and bounded permission list', () => {
  const input = ['example.catalog:write', 'example.catalog:read'];
  const captured = parseImpersonationPermissions(input);
  assert.deepEqual(captured, [...input].sort());
  input[0] = 'example.catalog:delete';
  assert.deepEqual(captured, ['example.catalog:read', 'example.catalog:write']);
  assert.ok(Object.isFrozen(captured));
  assert.equal(parseImpersonationPermissions(Array.from({length: 64}, (_, i) => `example.catalog:p${i}`)).length, 64);
  for (const value of [[], Array.from({length: 65}, (_, i) => `example.catalog:p${i}`), ['a:b','a:b'], ['a:*'], ['a:b\n'], ['a:b', null], {0:'a:b',length:1}])
    assert.equal(parseImpersonationPermissions(value), null);
});

test('permission parsing refuses executable, sparse or exotic arrays without calling their getters', () => {
  let reads = 0;
  const accessor = ['a:b'];
  Object.defineProperty(accessor, '0', {get() {reads++; return 'a:b';}, enumerable:true});
  const symbol = ['a:b']; symbol[Symbol('extra')] = true;
  const extra = ['a:b']; extra.extra = true;
  const prototype = ['a:b']; Object.setPrototypeOf(prototype, null);
  for (const value of [accessor,symbol,extra,prototype,new Array(1)]) assert.equal(parseImpersonationPermissions(value), null);
  assert.equal(reads, 0);
});

test('reason uses a byte limit and rejects control characters and malformed Unicode', () => {
  assert.equal(normalizeImpersonationReason('  Assistance demandée  '), 'Assistance demandée');
  assert.equal(normalizeImpersonationReason('é'.repeat(250)), 'é'.repeat(250));
  for (const value of ['é'.repeat(251), 'x'.repeat(501), 'a\nb', 'a\0b', '\ud800', '', '   ', {reason:'test'}])
    assert.equal(normalizeImpersonationReason(value), null);
  assert.equal(IMPERSONATION_LIMITS.maximumTtlMs, 15 * 60 * 1000);
});

test('service validates scopes, shape, TTL and native prohibitions before database I/O', async () => {
  let calls = 0;
  const db = {prepare() {calls++; throw Error('must not execute');}, async batch() {calls++; throw Error('must not execute');}};
  const service = createImpersonationService(db, {permissions:[
    {id:'example.catalog:read',actors:['user','impersonated-user'],audiences:['app']},
    {id:'example.catalog:only-user',actors:['user'],audiences:['app']},
    {id:'example.catalog:only-impersonation',actors:['impersonated-user'],audiences:['app']},
  ]});
  assert.deepEqual(Object.keys(service).sort(), ['check','start','stop']);
  const input = {subjectPrincipalId:'subject',contextId:'context',audience:'app',permissionIds:['example.catalog:read'],reason:'Support',ttlMs:60_000};
  const invalid = [null, {...input,ttlMs:999}, {...input,ttlMs:900001}, {...input,ttlMs:NaN}, {...input,extra:true},
    {...input,audience:'public'}, {...input,reason:' '}, {...input,permissionIds:[]},
    ...['creezio.access:manage','creezio.access:impersonate','example.catalog:unknown','example.catalog:only-user','example.catalog:only-impersonation']
      .map(permission => ({...input,permissionIds:[permission]}))];
  for (const value of invalid) assert.deepEqual(await service.start('invalid-token', value), {ok:false,error:'invalid_input'});
  const accessor = {...input}; Object.defineProperty(accessor, 'reason', {get(){calls++;return 'Support';},enumerable:true});
  assert.deepEqual(await service.start('invalid-token', accessor), {ok:false,error:'invalid_input'});
  assert.deepEqual(await service.start('invalid-token', input), {ok:false,error:'unauthorized'});
  const apiToken = await issueOpaqueToken('api-token');
  assert.deepEqual(await service.start(apiToken.token, input), {ok:false,error:'unauthorized'});
  assert.deepEqual(await service.stop(apiToken.token), {ok:false,error:'unauthorized'});
  assert.deepEqual(await service.check(apiToken.token, {contextId:'context',audience:'app',actors:['impersonated-user'],requiredPermissionIds:['example.catalog:read'],purpose:'operation'}), {allowed:false,reason:'credential_disabled'});
  assert.deepEqual(await service.check(apiToken.token, {audience:'app'}), {allowed:false,reason:'invalid_target'});
  assert.equal(calls, 0);
});
