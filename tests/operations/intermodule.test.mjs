import test from 'node:test';
import assert from 'node:assert/strict';
import {createModuleQueryPort,queryTraversal,INTERMODULE_LIMITS} from '../../core/operations/intermodule.ts';
import {OperationError} from '../../core/operations/types.ts';

const operation=(moduleId,id,extra={})=>({moduleId,declaration:{id,kind:'query',public:true,
  effects:{reads:[],writes:[],emits:[],calls:[],providers:[]},approval:{mode:'none'},...extra}});
const ref=(moduleId,id)=>({moduleId,id,kind:'operation'});
function fixture({target=operation('example.crm','contact.read'),invoke=async()=>({id:'contact-1'}),traversal}={}){
  const source=operation('example.support','contact.read',{effects:{calls:[ref('example.crm','contact.read')]}});
  let spent=0,active=true,calls=0;
  const port=createModuleQueryPort({source,traversal:traversal??queryTraversal(source),
    registry:{resolve(moduleId,id){if(moduleId!==target.moduleId||id!==target.declaration.id)throw new OperationError('not_found');return target;}},
    ensureActive(){if(!active)throw new OperationError('cancelled');},spend(){spent++;},
    async invoke(request,path){calls++;return invoke(request,path);}});
  return{port,source,spent:()=>spent,calls:()=>calls,close(){active=false;}};
}
const request=()=>({moduleId:'example.crm',operationId:'contact.read',input:{id:'contact-1'}});

test('module query exposes only declared canonical input/output, copied before and after the host call',async()=>{
  let seen,path;const output={id:'contact-1',name:'Name'};
  const f=fixture({invoke:async(input,trace)=>{seen=input;path=trace;return output;}});
  const input=request(),result=await f.port.query(input);
  assert.equal(JSON.stringify(seen),JSON.stringify(input));assert.notEqual(seen.input,input.input);
  assert.deepEqual(path.path,['example.support:contact.read','example.crm:contact.read']);
  output.name='Changed';assert.equal(result.name,'Name');assert.equal(f.spent(),1);
  assert.deepEqual(Object.keys(seen).sort(),['input','moduleId','operationId']);
});

test('module query rejects identity/context injection and undeclared calls before invocation',async()=>{
  const f=fixture();
  for(const extra of [{contextId:'other'},{audience:'admin'},{credential:{kind:'session',token:'synthetic'}},{signal:'x'}])
    await assert.rejects(f.port.query({...request(),...extra}),{code:'invalid_input'});
  await assert.rejects(f.port.query({...request(),operationId:'contact.delete'}),{code:'forbidden'});
  let getterCalled=false;
  await assert.rejects(f.port.query({...request(),get input(){getterCalled=true;return{};}}),{code:'invalid_input'});
  assert.equal(getterCalled,false);
  assert.equal(f.calls(),0);assert.equal(f.spent(),0);
});

test('private operations, commands and effectful queries cannot be nested',async()=>{
  for(const extra of [{public:false},{kind:'command'},
    {effects:{reads:[],writes:[ref('example.crm','contact')],emits:[],calls:[],providers:[]}},
    {effects:{reads:[],writes:[],emits:[ref('example.crm','changed')],calls:[],providers:[]}},
    {approval:{mode:'required'}}]){
    const f=fixture({target:operation('example.crm','contact.read',extra)});
    await assert.rejects(f.port.query(request()),{code:'forbidden'});assert.equal(f.calls(),0);
  }
});

test('cycles and depth are rejected while sibling calls share a global budget',async()=>{
  for(const path of [['example.crm:contact.read'],['a:read','b:read','c:read','d:read']]){
    const f=fixture({traversal:{path,budget:{remaining:16}}});
    await assert.rejects(f.port.query(request()),{code:'rate_limited'});assert.equal(f.calls(),0);
  }
  const f=fixture();
  await Promise.all(Array.from({length:INTERMODULE_LIMITS.calls},()=>f.port.query(request())));
  await assert.rejects(f.port.query(request()),{code:'rate_limited'});
  assert.equal(f.calls(),INTERMODULE_LIMITS.calls);
});

test('late nested output is refused after parent completion or cancellation',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture({invoke:()=>pending});
  const result=f.port.query(request());f.close();release({id:'contact-1'});
  await assert.rejects(result,{code:'cancelled'});
  await assert.rejects(f.port.query(request()),{code:'cancelled'});assert.equal(f.calls(),1);
});
