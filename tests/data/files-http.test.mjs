import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchFileHttp} from '../../core/files/http.ts';
import {createFileService} from '../../core/files/service.ts';
import {fileOwnerId} from '../../core/files/catalog.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {createStorageFixture, moduleId, catalog, category, permissions, table} from './fixtures/storage.mjs';

const origin='http://127.0.0.1:8787';
const bytes=new TextEncoder().encode('Private HTTP fixture bytes');
const fileCatalog={compositionDigest:catalog.compositionDigest,categories:[{moduleId,category,audiences:['admin','app']}]} ;
const path=audience=>`${origin}/api/files/${audience}/${moduleId}/${category.id}`;
const params=ref=>new URLSearchParams(ref).toString();
const cookie=(token,audience='admin')=>`${audience==='admin'?'creezio-local-admin':'creezio-local-app'}=${token}`;
const check=async (response,status,code) => {
  assert.equal(response.status,status);
  if(code) assert.equal((await response.json()).error.code,code);
  return response;
};

test('private file HTTP transport enforces native identity, scope and bounded binary staging on real D1/R2',
  {timeout:60000},async()=>{
    const fixture=await createStorageFixture();
    const raw={CREEZIO_APP_ORIGIN:origin};
    const environment=(bucket=fixture.bucket)=>({profile:'local',bindings:{DB:fixture.db,BUCKET:bucket}});
    const dispatch=(request,bucket=fixture.bucket,files=fileCatalog,dataCatalog=catalog)=>
      dispatchFileHttp(request,environment(bucket),raw,'file-http-test',{catalog:dataCatalog,files,permissions});
    const base=(token=fixture.signed.token,audience='admin',context='application')=>({
      cookie:cookie(token,audience),'x-creezio-context':context,
    });
    const put=(intent,{token=fixture.signed.token,audience='admin',context='application',body=bytes,
      generation='1',name='private épreuve.pdf',extra={}}={})=>new Request(path(audience),{method:'PUT',headers:{
      ...base(token,audience,context),origin,'x-creezio-request':'1','x-creezio-file-intent':intent,
      'x-creezio-file-generation':generation,'x-creezio-file-name':encodeURIComponent(name),
      'content-type':'application/pdf',...extra},body});
    const get=(ref,{token=fixture.signed.token,audience='admin',context='application',extra={}}={})=>new Request(
      `${path(audience)}?${params(ref)}`,{headers:{...base(token,audience,context),...extra}});
    const remove=ref=>new Request(`${path('admin')}?${params(ref)}`,{method:'DELETE',headers:{
      ...base(),origin,'x-creezio-request':'1'}});
    try {
      const anonymous=()=>new Request(path('admin'),{method:'PUT',headers:{origin,'x-creezio-request':'1',
        'x-creezio-context':'application','x-creezio-file-intent':'anonymous','x-creezio-file-generation':'1',
        'x-creezio-file-name':'x.pdf','content-type':'application/pdf'},body:bytes});
      await check(await dispatch(anonymous()),401,'authentication_required');
      const malformedUnrelatedCatalog=structuredClone(catalog);
      malformedUnrelatedCatalog.modules[0].models.find(model=>model.modelId==='record').model.fields[0].type='unsupported';
      await check(await dispatch(anonymous(),fixture.bucket,fileCatalog,malformedUnrelatedCatalog),401,'authentication_required');
      await check(await dispatch(put('cross-origin',{extra:{origin:'https://other.invalid'}})),403,'origin_denied');
      const missingRequest=put('missing-request');missingRequest.headers.delete('x-creezio-request');
      await check(await dispatch(missingRequest),403,'origin_denied');
      await check(await dispatch(put('session-bearer',{extra:{authorization:`Bearer ${fixture.signed.token}`}})),401,'authentication_required');
      await check(await dispatch(put('too-large',{body:new Uint8Array(category.maxBytes+1)})),413,'body_too_large');
      await check(await dispatch(put('wrong-mime',{extra:{'content-type':'text/html'}})),400,'invalid_input');
      let emptyPulls=0,uploadCancelled=false;
      const endlessEmptyBody=new ReadableStream({pull(controller){emptyPulls++;controller.enqueue(new Uint8Array());},
        cancel(){uploadCancelled=true;}});
      const emptyRequest=new Request(path('admin'),{method:'PUT',duplex:'half',headers:{...base(),origin,
        'x-creezio-request':'1','x-creezio-file-intent':'empty-stream','x-creezio-file-generation':'1',
        'x-creezio-file-name':'empty.pdf','content-type':'application/pdf'},body:endlessEmptyBody});
      await check(await dispatch(emptyRequest),413,'body_too_large');
      assert.equal(uploadCancelled,true);assert.ok(emptyPulls<=16386,`unbounded empty upload stream: ${emptyPulls}`);
      const stage=await dispatch(put('private-stage'));
      assert.equal(stage.status,201);assert.equal(stage.headers.get('cache-control'),'no-store');
      const staged=(await stage.json()).reference;
      assert.deepEqual(Object.keys(staged).sort(),['digest','fileId','generation','intentId']);
      await check(await dispatch(get(staged)),404,'not_found');
      await check(await dispatch(get({...staged,generation:'wrong'})),404,'not_found');
      assert.deepEqual((await (await dispatch(put('private-stage'))).json()).reference,staged);
      await check(await dispatch(put('private-stage',{body:new Uint8Array([1,2,3])})),409,'conflict');

      let failPut=true;
      const failingBucket={...fixture.bucket,put(...args){if(failPut)throw new Error('synthetic late R2 failure');return fixture.bucket.put(...args);},
        get:(...args)=>fixture.bucket.get(...args),delete:(...args)=>fixture.bucket.delete(...args)};
      await check(await dispatch(put('late-r2',{generation:'failed'}),failingBucket),503,'unavailable');
      const pending=await fixture.db.prepare(`SELECT * FROM ${table('file_metadata')} WHERE generation='failed'`).first();
      assert.equal(pending.state,'staging');
      failPut=false;
      const resumed=await dispatch(put('late-r2',{generation:'failed'}),failingBucket);
      assert.equal(resumed.status,201);
      assert.equal((await resumed.json()).reference.fileId,pending.id);

      const lease=await fixture.lease();
      const files=createFileService({data:fixture.data,catalog,moduleId,category,bucket:fixture.bucket,
        ownerId:await fileOwnerId(fixture.owner.principalId,'admin')});
      await fixture.data.commitBatch(lease,[await files.publicationProof(lease,staged)]);
      const download=await dispatch(get(staged));
      assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),bytes);
      assert.equal(download.headers.get('content-type'),'application/octet-stream');
      assert.equal(download.headers.get('cache-control'),'private, no-store');
      assert.match(download.headers.get('content-disposition'),/^attachment;/);
      assert.match(download.headers.get('content-disposition'),/%C3%A9preuve\.pdf/);
      await check(await dispatch(get(staged,{context:'other'})),404,'not_found');

      const acl=createAuthorizationService(fixture.db,{permissions});
      const current=await acl.readPolicy(fixture.signed.token);assert.equal(current.ok,true);
      const policy=structuredClone(current.policy);
      policy.memberships.push({principalId:fixture.owner.principalId,contextId:'application',audience:'app',status:'active'});
      policy.assignments.push({principalId:fixture.owner.principalId,contextId:'application',audience:'app',roleId:'storage'});
      const lifecycle=createAccountLifecycleService(fixture.db,{permissions});
      const invitation=await lifecycle.issueInvitation(fixture.signed.token,{loginIdentifier:'file-peer@example.invalid',displayName:'File peer'});
      assert.equal(invitation.ok,true);
      const peer=await lifecycle.redeem({token:invitation.token,purpose:'invitation',password:'Synthetic file peer password'});
      assert.equal(peer.ok,true);
      policy.memberships.push({principalId:peer.principalId,contextId:'application',audience:'admin',status:'active'});
      policy.assignments.push({principalId:peer.principalId,contextId:'application',audience:'admin',roleId:'storage'});
      assert.equal((await acl.replacePolicy(fixture.signed.token,{expectedEpoch:current.epoch,policy})).ok,true);
      const app=await fixture.accounts.login({loginIdentifier:'storage@example.invalid',password:'Synthetic storage qualification password',audience:'app'});
      const peerSession=await fixture.accounts.login({loginIdentifier:'file-peer@example.invalid',password:'Synthetic file peer password',audience:'admin'});
      assert.equal(app.ok,true);assert.equal(peerSession.ok,true);
      await check(await dispatch(get(staged,{token:app.token,audience:'app'})),404,'not_found');
      await check(await dispatch(get(staged,{token:peerSession.token})),404,'not_found');

      const abandoned=(await (await dispatch(put('abandon-me'))).json()).reference;
      const deletion=await dispatch(remove(abandoned));
      assert.equal(deletion.status,200);assert.equal((await deletion.json()).state,'abandoned');
      await check(await dispatch(get(abandoned)),404,'not_found');
      await fixture.changePermissions(['records','secrets']);
      await check(await dispatch(get(staged)),403,'forbidden');
      await fixture.changePermissions(['records','files','secrets']);
      await fixture.revoke();
      await check(await dispatch(get(staged)),401,'unauthorized');
    } finally {await fixture.dispose();}
  });
