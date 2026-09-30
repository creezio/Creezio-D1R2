import test from 'node:test';
import assert from 'node:assert/strict';
import {issueOpaqueToken} from '../../core/identity/tokens.ts';
import {dispatchAccessHttp} from '../../core/identity/http.ts';
import {dispatchOAuthHttp} from '../../core/oauth/http.ts';

const origin='http://127.0.0.1:5173',path='/api/access/admin/logout';
const unavailable=()=>{throw new Error('Storage must not be used by an injected logout transport.');};
const db={prepare:unavailable,batch:unavailable};
const raw={CREEZIO_APP_ORIGIN:origin};
const environment={profile:'local',bindings:{DB:db,BUCKET:{get:unavailable,head:unavailable,
  put:unavailable,delete:unavailable}},storageAuthority:{inventory:[{identity:{
    installationId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',contextId:'tenant-a',slot:1},db}],
    storageMutation:{}}};
const request=token=>new Request(origin+path,{method:'POST',headers:{origin,
  'x-creezio-request':'1','content-type':'application/json',
  cookie:`creezio-local-admin=${token}`},body:'{}'});

test('native logout requires the routed revocation receipt before clearing a cookie',async()=>{
  const token=(await issueOpaqueToken('session')).token;
  const args=[environment,raw,{admin:true,app:true},'synthetic-request-id',path];
  const absent=await dispatchAccessHttp(request(token),...args);
  assert.equal(absent.status,503);
  assert.equal(absent.headers.has('set-cookie'),false);
  let received;
  const pending=await dispatchAccessHttp(request(token),...args,async(value,audience)=>{
    received={value,audience};return {state:'pending'};
  });
  assert.deepEqual(received,{value:token,audience:'admin'});
  assert.equal(pending.status,503);
  assert.equal(pending.headers.has('set-cookie'),false);
  assert.equal((await pending.json()).error.code,'storage_revocation_pending');
  const confirmed=await dispatchAccessHttp(request(token),...args,async()=>({state:'revoked'}));
  assert.equal(confirmed.status,200);
  assert.match(confirmed.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await confirmed.json()).ok,true);
});

test('routed OAuth token and revocation endpoints require the host mutation port',async()=>{
  for(const path of ['/oauth/token','/oauth/revoke']){
    const response=await dispatchOAuthHttp(new Request(origin+path,{method:'POST'}),environment,raw,
      [],'synthetic-request-id',path,{admin:true,app:true});
    assert.equal(response.status,503);
    assert.equal((await response.json()).error,'temporarily_unavailable');
  }
});
