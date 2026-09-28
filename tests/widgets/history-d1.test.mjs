import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createOperationStore} from '../../core/operations/store.ts';
import {createOperationFixture} from '../operations/fixtures/identity.mjs';
import {createFixtureRegistry} from '../operations/fixtures/handlers.mjs';
import {moduleId,permissions} from '../operations/fixtures/operations.mjs';

test('historical execution read is confined by real D1 actor, principal, audience and context; normal status stays digest-strict',
  {timeout:60000},async()=>{
    const fixture=await createOperationFixture();
    try{
      const {registry}=await createFixtureRegistry();
      const engine=createOperationEngine({db:fixture.db,catalog:fixture.catalog,registry,permissions});
      const request=(operationId,input)=>({credential:fixture.credentials.session,moduleId,operationId,
        contextId:'application',audience:'admin',input});
      const created=await engine.invoke(request('create_record',{id:'request_1',title:'Historical',request_id:'create_1'}));
      assert.equal(created.execution.state,'succeeded');
      const old=await engine.invoke(request('read_record',{id:'request_1'}));
      assert.equal(old.execution.state,'succeeded');
      const executionId=old.execution.id,oldDigest=old.execution.operationVersion;
      const upgraded={...registry,resolve:(mod,id)=>{
        const current=registry.resolve(mod,id);
        return id==='read_record'?{...current,contractDigest:`sha256-${'f'.repeat(64)}`}:current;
      }};
      const upgradedEngine=createOperationEngine({db:fixture.db,catalog:fixture.catalog,registry:upgraded,permissions});
      await assert.rejects(upgradedEngine.status({credential:fixture.credentials.session,moduleId,
        operationId:'read_record',contextId:'application',audience:'admin',executionId}),{code:'conflict'});
      const data=fixture.createData(),store=createOperationStore({db:fixture.db,data});
      const authorize=(credential,contextId='application',audience='admin',actors=['user'])=>
        data.authorize(credential,{contextId,audience,actors,requiredPermissionIds:[`${moduleId}:read`],
          purpose:'operation'},{moduleId});
      const own=await authorize(fixture.credentials.session);
      const historical=await store.read(own,executionId);
      assert.equal(historical.operationVersion,oldDigest);
      assert.equal(historical.state,'succeeded');
      assert.equal(historical.output.id,'request_1');
      data.dispose(own);
      const foreign=await authorize(fixture.credentials.machine,'application','admin',['machine']);
      assert.equal(await store.read(foreign,executionId),null);data.dispose(foreign);
      const wrongContext=await authorize(fixture.credentials.session,'other');
      assert.equal(await store.read(wrongContext,executionId),null);data.dispose(wrongContext);
      const app=await fixture.accounts.login({loginIdentifier:'operations-subject@example.invalid',
        password:'Synthetic operation qualification password',audience:'app'});
      assert.equal(app.ok,true);
      const wrongAudience=await authorize({kind:'session',token:app.token},'application','app');
      assert.equal(await store.read(wrongAudience,executionId),null);data.dispose(wrongAudience);
      await fixture.revoke('session');
      await assert.rejects(authorize(fixture.credentials.session));
    }finally{await fixture.runtime.dispose();}
  });
