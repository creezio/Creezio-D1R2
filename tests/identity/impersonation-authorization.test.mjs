import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, copyAuthorizationTarget } from '../../core/authorization/authorize.ts';
import { MANAGE_ACCESS, IMPERSONATE_ACCESS, NATIVE_ACCESS_PERMISSIONS, parseAccessPolicy, policySnapshot } from '../../core/authorization/policy.ts';
import { createNativeAuthorizationResolver, IMPERSONATION_TARGET } from '../../core/authorization/resolver.ts';

const READ='example.catalogue:read', WRITE='example.catalogue:write', now=1000;
const actors=['user','machine','delegated-user','impersonated-user'];
const target=(overrides={})=>({contextId:'workspace-a',audience:'app',actors:[...actors],requiredPermissionIds:[READ],purpose:'operation',...overrides});
function snapshot(){return {
 actor:{id:'subject',kind:'human',enabled:true,contextIds:['workspace-a'],audiences:['app']},
 credential:{id:'impersonation-1',subjectId:'subject',kind:'impersonation',actorPrincipalId:'administrator',sourceSessionId:'source-session',
  enabled:true,expiresAtMs:2000,contextIds:['workspace-a'],audiences:['app'],permissionIds:[READ]},
 permissions:[{id:READ,audiences:['app','admin'],actors:[...actors]},{id:WRITE,audiences:['app','admin'],actors:[...actors]},...structuredClone(NATIVE_ACCESS_PERMISSIONS)],
 roles:[{id:'reader',inherits:[],permissionIds:[READ,WRITE],permissionOverrides:[]}],
 assignments:[{roleId:'reader',contextId:'workspace-a',audiences:['app']}],overrides:[],
};}
const reason=(state,operation=target(),time=now)=>authorize(state,operation,time).reason;

test('impersonation uses an explicit actor while native, machine and OAuth operation eligibility stay distinct',()=>{
 const state=snapshot(),before=structuredClone(state);
 assert.equal(reason(state),'allowed');assert.deepEqual(state,before);
 for(const eligible of [['user'],['machine'],['delegated-user']]) assert.equal(reason(state,target({actors:eligible})),'actor_denied');
 state.permissions[0].actors=['user','delegated-user'];assert.equal(reason(state),'actor_denied');
 const operation=target();assert.deepEqual(copyAuthorizationTarget(operation),operation);
 assert.ok(Object.isFrozen(copyAuthorizationTarget(operation).actors));
});

test('impersonation requires exact provenance, a distinct initiating human and one context/audience',()=>{
 for(const modify of [
  s=>delete s.credential.actorPrincipalId,s=>delete s.credential.sourceSessionId,
  s=>{s.credential.actorPrincipalId='subject';},s=>{s.credential.sourceSessionId='';},
  s=>{s.credential.contextIds.push('workspace-b');},s=>{s.credential.audiences.push('admin');},
  s=>{s.credential.permissionIds=[];},s=>{s.credential.extra=true;},
  s=>{Object.defineProperty(s.credential,'actorPrincipalId',{enumerable:true,get(){assert.fail('Accessor executed');}});},
 ]){const state=snapshot();modify(state);assert.equal(reason(state),'invalid_snapshot');}
 const machine=snapshot();machine.actor.kind='service';assert.equal(reason(machine),'credential_kind');
 for(const kind of ['session','api-token','oauth']){const state=snapshot();state.credential.kind=kind;assert.equal(reason(state),'invalid_snapshot','ordinary credentials cannot carry impersonation provenance');}
});

test('impersonation cannot grant approvals or native administration even under a permissive host catalog',()=>{
 const state=snapshot();
 assert.equal(reason(state,target({purpose:'human-approval',requiredPermissionIds:[]})),'human_approval_required');
 for(const permission of [MANAGE_ACCESS,IMPERSONATE_ACCESS]){
  const malicious=snapshot();malicious.permissions.find(p=>p.id===permission).actors=[...actors];
  malicious.permissions.find(p=>p.id===permission).audiences=['app','admin'];
  malicious.roles[0].permissionIds.push(permission);malicious.credential.permissionIds.push(permission);
  assert.equal(reason(malicious,target({requiredPermissionIds:[permission]})),'actor_denied');
 }
});

test('current subject grants remain intersected with the immutable impersonation ceiling',()=>{
 const state=snapshot();assert.equal(reason(state,target({requiredPermissionIds:[WRITE]})),'scope_denied');
 state.roles[0].permissionIds=[];assert.equal(reason(state),'permission_denied');
 state.overrides=[{contextId:'workspace-a',audiences:['app'],permissionId:READ,effect:'allow'}];assert.equal(reason(state),'allowed');
 state.overrides.push({contextId:'workspace-a',audiences:['app'],permissionId:READ,effect:'deny'});assert.equal(reason(state),'permission_denied');
 assert.equal(reason(snapshot(),target({contextId:'workspace-b',requiredPermissionIds:[]})),'context_denied');
 assert.equal(reason(snapshot(),target({audience:'admin',requiredPermissionIds:[]})),'audience_denied');
 const expired=snapshot();assert.equal(reason(expired,target(),2000),'credential_expired');
 expired.credential.enabled=false;assert.equal(reason(expired),'credential_disabled');
 const disabled=snapshot();disabled.actor.enabled=false;assert.equal(reason(disabled),'actor_disabled');
});

test('impersonation permits at most 64 unique explicit permission identifiers',()=>{
 const state=snapshot();
 state.permissions=Array.from({length:64},(_,i)=>({id:`example.catalogue:read-${i}`,audiences:['app'],actors:['impersonated-user']}));
 state.credential.permissionIds=state.permissions.map(p=>p.id);state.roles[0].permissionIds=[...state.credential.permissionIds];
 assert.equal(reason(state,target({requiredPermissionIds:[state.credential.permissionIds[0]]})),'allowed');
 state.permissions.push({id:'example.catalogue:extra',audiences:['app'],actors:['impersonated-user']});
 state.credential.permissionIds.push('example.catalogue:extra');assert.equal(reason(state),'invalid_snapshot');
 const duplicate=snapshot();duplicate.credential.permissionIds.push(READ);assert.equal(reason(duplicate),'invalid_snapshot');
});

test('native impersonation permission is reserved and does not become a bootstrap grant',()=>{
 let calls=0;const db={prepare(){calls++;throw new Error('Unexpected database read');},batch(){calls++;throw new Error('Unexpected database read');}};
 for(const id of [MANAGE_ACCESS,IMPERSONATE_ACCESS])assert.throws(()=>createNativeAuthorizationResolver(db,{permissions:[{id,audiences:['admin'],actors:['machine']}]}),/Invalid server permission catalog/);
 const resolver=createNativeAuthorizationResolver(db,{permissions:[]});
 assert.deepEqual(resolver.permissions,NATIVE_ACCESS_PERMISSIONS);
 assert.ok(Object.isFrozen(resolver.permissions)&&resolver.permissions.every(p=>Object.isFrozen(p)&&Object.isFrozen(p.actors)));
 assert.deepEqual(IMPERSONATION_TARGET,{contextId:'application',audience:'admin',actors:['user'],requiredPermissionIds:[IMPERSONATE_ACCESS],purpose:'operation'});
 const policy=parseAccessPolicy({contexts:[{id:'application',status:'active'}],roles:[{id:'administrator',inherits:[],permissionIds:[MANAGE_ACCESS],permissionOverrides:[]}],
  memberships:[{principalId:'administrator',contextId:'application',audience:'admin',status:'active'}],
  assignments:[{principalId:'administrator',contextId:'application',audience:'admin',roleId:'administrator'}],overrides:[]});
 const state=policySnapshot(policy,resolver.permissions,{id:'native-session',principalId:'administrator',audience:'admin',expiresAtMs:2000});
 assert.equal(reason(state,IMPERSONATION_TARGET),'permission_denied');
 assert.equal(calls,0);
});
