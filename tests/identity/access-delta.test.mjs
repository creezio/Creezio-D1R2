import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAccessPolicy} from '../../core/authorization/policy.ts';
import {applyAccessPolicyChanges, parseAccessPolicyChanges} from '../../core/authorization/delta.ts';

const policy = () => parseAccessPolicy({
  contexts:[{id:'application',status:'active'},{id:'team',status:'active'}],
  roles:[{id:'administrator',inherits:[],permissionIds:['creezio.access:manage'],permissionOverrides:[]},
    {id:'editor',inherits:[],permissionIds:['example.notes:read'],permissionOverrides:[]},
    {id:'reviewer',inherits:['editor'],permissionIds:[],permissionOverrides:[]}],
  memberships:[{principalId:'admin',contextId:'application',audience:'admin',status:'active'},
    {principalId:'alice',contextId:'team',audience:'app',status:'active'}],
  assignments:[{principalId:'admin',contextId:'application',audience:'admin',roleId:'administrator'},
    {principalId:'alice',contextId:'team',audience:'app',roleId:'editor'},
    {principalId:'alice',contextId:'team',audience:'app',roleId:'reviewer'}],
  overrides:[],
});

test('bounded delta preserves independent contexts, inherited grants and multiple assignments', () => {
  const before=policy(); assert.ok(before);
  const changes=parseAccessPolicyChanges([
    {kind:'role-override',roleId:'reviewer',permissionId:'example.notes:read',effect:'deny'},
    {kind:'principal-override',principalId:'alice',contextId:'team',audience:'app',permissionId:'example.notes:read',effect:'allow'},
  ]);
  assert.ok(changes);
  const after=applyAccessPolicyChanges(before,changes); assert.ok(after);
  assert.deepEqual(after.assignments,before.assignments);
  assert.deepEqual(after.contexts,before.contexts);
  assert.deepEqual(after.roles.find(r=>r.id==='reviewer').inherits,['editor']);
  assert.deepEqual(after.roles.find(r=>r.id==='reviewer').permissionOverrides,
    [{permissionId:'example.notes:read',effect:'deny'}]);
  assert.deepEqual(after.overrides,[{principalId:'alice',contextId:'team',audience:'app',
    permissionId:'example.notes:read',effect:'allow'}]);
  assert.equal(before.overrides.length,0);
});

test('delta rejects duplicate tuple keys, extra fields and unbounded input before policy mutation', () => {
  const item={kind:'role-grant',roleId:'editor',permissionId:'example.notes:read',present:false};
  assert.equal(parseAccessPolicyChanges([item,item]),null);
  assert.equal(parseAccessPolicyChanges([{...item,token:'forbidden'}]),null);
  assert.equal(parseAccessPolicyChanges(Array.from({length:33},()=>item)),null);
  let getterCalls=0; const getter={...item};
  Object.defineProperty(getter,'present',{enumerable:true,get(){getterCalls++;return true;}});
  assert.equal(parseAccessPolicyChanges([getter]),null);
  assert.equal(getterCalls,0);
  const unchanged=parseAccessPolicyChanges([{kind:'role-grant',roleId:'editor',permissionId:'example.notes:read',present:true}]);
  assert.equal(applyAccessPolicyChanges(policy(),unchanged),null,'no-op edits cannot create an audit event');
});
