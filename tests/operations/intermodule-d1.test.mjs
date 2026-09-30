import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationFixture,quote} from './fixtures/identity.mjs';
import {createFixtureRegistry} from './fixtures/handlers.mjs';
import {moduleId,permissions} from './fixtures/operations.mjs';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {OPERATION_TABLES} from '../../core/operations/models.ts';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';

test('nested public queries reuse native identity and D1 journal without caller-controlled authority',{timeout:60000},async t=>{
  const f=await createOperationFixture(),base=await createFixtureRegistry(),targetId='example.public-contact';
  const validators={...await import(`data:text/javascript;base64,${Buffer.from(base.compiled.validatorsCode).toString('base64')}`)};
  const request=(extra={})=>({credential:f.credentials.session,moduleId,operationId:'read_record',
    contextId:'application',audience:'admin',input:{id:'contact-1'},...extra});
  const seen=[];
  async function engine({before=async()=>{},targetPublic=true,targetEnabled=true,permission='read',override}={}){
    const catalog=structuredClone(base.compiled.catalog),data=structuredClone(f.catalog);
    const parent=catalog.modules[0].operations.find(entry=>entry.operation.id==='read_record');
    const target=structuredClone(parent);
    target.operation.public=targetPublic;
    target.operation.effects={reads:[],writes:[],emits:[],calls:[],providers:[]};
    target.operation.permissions=[{moduleId,kind:'permission',id:permission}];
    target.contractDigest=contractIntegrity(target.operation);
    parent.operation.effects={reads:[],writes:[],emits:[],providers:[],calls:[{moduleId:targetId,kind:'operation',id:'read_record'}]};
    parent.contractDigest=contractIntegrity(parent.operation);
    catalog.modules[0].operations=[parent];
    catalog.modules.push({moduleId:targetId,version:'1.0.0',enabled:targetEnabled,
      schemas:structuredClone(catalog.modules[0].schemas),operations:[{...target,active:targetEnabled}]});
    data.modules.push({moduleId:targetId,version:'1.0.0',enabled:targetEnabled,permissions:[],models:[]});
    const handlers={
      [`${moduleId}:read_record`]:async(input,context)=>{await before();return{output:await context.operations.query({
        moduleId:targetId,operationId:'read_record',input,...override})};},
      ...(targetEnabled?{[`${targetId}:read_record`]:async(input,context)=>{
        seen.push({contextId:context.contextId,audience:context.audience,principalId:context.principalId,actorPrincipalId:context.actorPrincipalId});
        return{output:{id:input.id,title:context.contextId,revision:0}};
      }}:{}),
    };
    const registry=createOperationRegistry({catalog,validators,handlers});
    return createOperationEngine({db:f.db,catalog:data,registry,permissions});
  }
  try{
    await t.test('session and machine preserve audience, principal and context in both journal entries',async()=>{
      const e=await engine();
      for(const extra of [{},{credential:f.credentials.machine,contextId:'other',audience:'app'}]){
        const result=await e.invoke(request(extra));assert.equal(result.execution.state,'succeeded',JSON.stringify(result));
        const identity=seen.at(-1);assert.equal(identity.contextId,extra.contextId??'application');
        assert.equal(identity.audience,extra.audience??'admin');assert.equal(result.execution.output.title,identity.contextId);
        assert.equal(identity.principalId,result.execution.principalId);assert.equal(identity.actorPrincipalId,result.execution.actorPrincipalId);
      }
      const rows=await f.db.prepare(`SELECT module_id,context_id,audience FROM ${quote(OPERATION_TABLES.executions)} WHERE module_id=?`).bind(targetId).all();
      assert.equal(rows.results.length,2);assert.deepEqual(new Set(rows.results.map(row=>`${row.context_id}:${row.audience}`)),new Set(['application:admin','other:app']));
    });
    await t.test('child permissions are checked separately with the original limited machine scope',async()=>{
      const before=seen.length,e=await engine({permission:'edit'});
      const result=await e.invoke(request({credential:f.credentials.machine,contextId:'other',audience:'app'}));
      assert.equal(result.execution.state,'failed');assert.equal(result.execution.errorCode,'forbidden');assert.equal(seen.length,before);
    });
    await t.test('private and disabled providers do not execute',async()=>{
      for(const options of [{targetPublic:false},{targetEnabled:false}]){
        const before=seen.length,e=await engine(options),result=await e.invoke(request());
        assert.equal(result.execution.state,'failed');assert.equal(seen.length,before);
      }
    });
    await t.test('nested request cannot override the resolved context',async()=>{
      const before=seen.length,e=await engine({override:{contextId:'other'}}),result=await e.invoke(request());
      assert.equal(result.execution.state,'failed');assert.equal(result.execution.errorCode,'invalid_input');assert.equal(seen.length,before);
    });
    await t.test('revocation between parent and child prevents the child from starting',async()=>{
      const before=seen.length,e=await engine({before:()=>f.revoke('session')});
      await assert.rejects(e.invoke(request()),error=>['unauthorized','forbidden'].includes(error.code));assert.equal(seen.length,before);
    });
  }finally{await f.dispose();}
});
