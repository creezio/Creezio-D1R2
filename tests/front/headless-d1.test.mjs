import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadlessOperationClient} from '../../sdk/front/headless.ts';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {createDeclaredHttpDispatcher} from '../../core/operations/http.ts';
import {createOperationFixture} from '../operations/fixtures/identity.mjs';
import {createFixtureRegistry} from '../operations/fixtures/handlers.mjs';
import {moduleId,operationComposition,permissions} from '../operations/fixtures/operations.mjs';

test('external headless bearer executes app operations in D1, reconciles a lost reply and obeys revocation', {timeout:60000},async()=>{
  const fixture=await createOperationFixture();
  try {
    const compiled=await createFixtureRegistry(),source=operationComposition();
    source.modules[0].contracts.api=[{id:'create-app',method:'POST',path:'/api/app/records',
      operation:{moduleId,kind:'operation',id:'create_record'},audience:'app',auth:['api-token'],parameters:[],
      input:{schemaId:'create-input'},output:{schemaId:'record-output'},rateLimit:{requests:30,windowSeconds:60}}];
    const bindings=compileHttpBindings({composition:source.composition,modules:source.modules,operationCatalog:compiled.compiled.catalog});
    const issued=await fixture.machines.issueToken(fixture.ownerSession.token,{principalId:fixture.machine.principal.id,label:'Headless recipe',ttlMs:600000,
      scopes:[{contextId:'application',audience:'app',permissionIds:[`${moduleId}:read`,`${moduleId}:edit`]}]});
    assert.equal(issued.ok,true,JSON.stringify(issued));
    const credential=issued.value??issued;
    const dispatcher=createDeclaredHttpDispatcher({registry:compiled.registry,dataCatalog:fixture.catalog,permissions,bindings,
      workspaceCatalog:{compositionDigest:compiled.compiled.catalog.compositionDigest,views:[],navigation:[]}});
    const origin='https://headless-d1.example',environment={profile:'sites',bindings:{DB:fixture.db}},raw={CREEZIO_APP_ORIGIN:origin};
    let calls=0,drop=true;
    const client=createHeadlessOperationClient({origin,bindings,credential:()=>({kind:'api-token',token:credential.token}),fetcher:async(url,init)=>{
      calls++;assert.equal(new Headers(init.headers).has('cookie'),false);
      const response=await dispatcher.dispatch(new Request(url,init),environment,raw,`headless-${calls}`);
      assert.ok(response);if(drop){drop=false;assert.equal(response.status,200,await response.clone().text());throw Error('Synthetic successful response lost');}
      return response;
    }});
    const input={id:'headless-record',title:'Headless app data',request_id:'headless-command'};
    const result=await client.invoke({bindingId:`${moduleId}:create-app`,contextId:'application',input});
    assert.deepEqual(result,{kind:'unknown',code:'outcome_unknown'});assert.equal((await fixture.record(input.id)).title,input.title);
    const status=await client.status({bindingId:`${moduleId}:create-app`,contextId:'application',requestKey:input.request_id});
    assert.equal(status.kind,'execution',JSON.stringify(status));assert.equal(status.execution.state,'succeeded');
    assert.equal(compiled.calls.get('create_record'),1);assert.equal(calls,2);
    const revoked=await fixture.machines.revokeToken(fixture.ownerSession.token,{credentialId:credential.credential.id});assert.equal(revoked.ok,true);
    const forbidden=await client.status({bindingId:`${moduleId}:create-app`,contextId:'application',executionId:status.execution.id});
    assert.equal(forbidden.kind,'rejected');assert.equal(forbidden.status,401);assert.equal(compiled.calls.get('create_record'),1);
  } finally {await fixture.dispose();}
});
