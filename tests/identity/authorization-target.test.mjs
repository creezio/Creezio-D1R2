import test from 'node:test';
import assert from 'node:assert/strict';
import { copyAuthorizationTarget } from '../../core/authorization/authorize.ts';
import { createAuthorizationService } from '../../core/authorization/service.ts';
import { issueOpaqueToken } from '../../core/identity/tokens.ts';

const permission = 'example.reports:read';
const target = () => ({contextId:'application',audience:'admin',actors:['user'],requiredPermissionIds:[permission],purpose:'operation'});

test('operation targets are copied and frozen without executing accessors or accepting malformed shapes',()=>{
  const input=target(), copied=copyAuthorizationTarget(input);
  input.contextId='changed';input.actors.push('machine');input.requiredPermissionIds.length=0;
  assert.equal(copied.contextId,'application');assert.deepEqual(copied.actors,['user']);
  assert.deepEqual(copied.requiredPermissionIds,[permission]);assert.ok(Object.isFrozen(copied.requiredPermissionIds));
  let calls=0; const getter=target();Object.defineProperty(getter,'contextId',{enumerable:true,get(){calls++;return'application';}});
  const sparse=target();sparse.actors.length=2;
  for(const bad of [null,{},[],getter,sparse,{...target(),owner:true},{...target(),contextId:'application\n'},
    {...target(),requiredPermissionIds:['*']},new Proxy({}, {ownKeys(){throw new Error('untrusted');}})])
    assert.equal(copyAuthorizationTarget(bad),null);
  assert.equal(calls,0);
});

test('changing a native operation target during its D1 read cannot drop the required permission',async()=>{
  const input=target(), row=results=>({success:true,results,meta:{changes:0}});
  const db={prepare(){return{bind(){return{};}};},async batch(){
    input.requiredPermissionIds.length=0;input.actors.push('machine');
    return [row([{id:'session',principalId:'owner',displayName:'Owner',audience:'admin',authVersion:1,
      createdAtMs:0,expiresAtMs:10000,epoch:1,nowMs:1000}]),
    row([{id:'owner',kind:'human',status:'active',humanStatus:'active'}]),
    row([{id:'application',status:'active'}]),row([{id:'administrator'}]),row([]),
    row([{roleId:'administrator',permissionId:'creezio.access:manage'}]),row([]),
    row([{principalId:'owner',contextId:'application',audience:'admin',status:'active'}]),
    row([{principalId:'owner',contextId:'application',audience:'admin',roleId:'administrator'}]),row([])];
  }};
  const service=createAuthorizationService(db,{permissions:[{id:permission,actors:['user'],audiences:['admin']}]});
  assert.deepEqual(await service.check((await issueOpaqueToken('session')).token,input),{allowed:false,reason:'permission_denied'});
});
