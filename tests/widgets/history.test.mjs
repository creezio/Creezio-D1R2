import test from 'node:test';
import assert from 'node:assert/strict';
import {createWidgetOperationPort} from '../../core/widgets/host.ts';
import {compatibleWidgetVersion} from '../../core/widgets/snapshot.ts';
import {widgetActionJournal} from '../../sdk/widgets/action-journal.ts';
import {compileWidgetContextValidators} from '../../scripts/widgets/compile.mjs';

const hash = character => `sha256-${character.repeat(64)}`;
const uri = digest => `ui://creezio/example.purchase/card/1.0.0/${digest}.html`;
const oldResource = hash('a'), newResource = hash('b'), oldOperation = hash('c'), newOperation = hash('d');
const widget = Object.freeze({moduleId:'example.purchase',widgetId:'card',version:'1.0.0',
  compatibility:'^1.0.0',resourceUri:uri(newResource),resourceDigest:newResource,
  audiences:['admin','app'],permissions:['example.purchase:read'],transport:{maxPayloadBytes:4096},
  renderTools:[{operationModuleId:'example.purchase',operationId:'request.get',operationDigest:newOperation,
    audiences:['admin','app']}],actions:[]});
const stored = Object.freeze({kind:'creezio.widget-message',schemaVersion:1,instances:[{
  instanceId:'instance_1',instanceRevision:1,moduleId:'example.purchase',widgetId:'card',widgetVersion:'1.0.0',
  resourceUri:uri(oldResource),resourceDigest:oldResource,state:{view:'detail'},
  renderExecution:{moduleId:'example.purchase',operationId:'request.get',operationDigest:oldOperation,executionId:'execution_1'},
}]});
const validators = new Map([['example.purchase\u0000card\u00001.0.0',{
  state:value=>value?.view==='detail',input:value=>value?.id==='request_1',actionInputs:new Map(),
}]]);
function port(options={}) {
  return createWidgetOperationPort({catalog:{widgets:[options.widget??widget],resources:[]},validators,
    audience:options.audience??'app',authorize:options.authorize??(()=>{}),
    readHistoricalRender:options.read??(async()=>({output:{id:'request_1'}}))});
}

test('declared semver range projects old native resource to current HTML while retaining the old execution identity',async()=>{
  assert.equal(compatibleWidgetVersion('^1.0.0','1.0.0'),true);
  assert.equal(compatibleWidgetVersion('>=1.0.0 <2.0.0','1.3.2'),true);
  assert.equal(compatibleWidgetVersion('^2.0.0','1.0.0'),false);
  let calls=0;
  const host=port({read:async(render,current)=>{
    calls++;
    assert.equal(render.operationDigest,oldOperation);
    assert.equal(render.executionId,'execution_1');
    assert.equal(current.resourceDigest,newResource);
    return {output:{id:'request_1'}};
  }});
  assert.equal(host.projectSnapshot(stored),null);
  const projected=host.projectHistory(stored);
  assert.equal(projected.instances[0].resourceUri,uri(newResource));
  assert.equal(projected.instances[0].resourceDigest,newResource);
  assert.deepEqual({...projected.instances[0].renderExecution},stored.instances[0].renderExecution);
  assert.deepEqual({...await host.readHistory(stored,'instance_1').then(value=>value?.output)},{id:'request_1'});
  assert.equal(calls,1);
});

test('static and mixed native messages survive an HTML update without inventing an execution',()=>{
  const staticInstance={...stored.instances[0],instanceId:'static_1'};
  delete staticInstance.renderExecution;
  const host=port();
  const projected=host.projectHistory({...stored,instances:[staticInstance,stored.instances[0]]});
  assert.deepEqual(projected.instances.map(item=>item.instanceId),['static_1','instance_1']);
  assert.equal(projected.instances[0].renderExecution,undefined);
  assert.equal(projected.instances[0].resourceDigest,newResource);
  assert.equal(projected.instances[1].renderExecution.operationDigest,oldOperation);
});

test('history rejects incompatible, altered, revoked or invalid state and never supplies a render result',async()=>{
  let calls=0;
  const read=async()=>{calls++;return {output:{id:'request_1'}};};
  const cases=[
    [port({widget:{...widget,compatibility:'^2.0.0'},read}),stored],
    [port({authorize:()=>{throw Error('revoked');},read}),stored],
    [port({read}),{...stored,instances:[{...stored.instances[0],resourceUri:'ui://creezio/foreign/card/1.0.0/x.html'}]}],
    [port({read}),{...stored,instances:[{...stored.instances[0],state:{view:'unknown'}}]}],
    [port({read}),{...stored,instances:[{...stored.instances[0],renderExecution:{...stored.instances[0].renderExecution,operationId:'request.delete'}}]}],
  ];
  for(const [host,source] of cases){
    assert.equal(host.projectHistory(source),null);
    assert.equal(await host.readHistory(source,'instance_1'),null);
  }
  assert.equal(calls,0);
  assert.equal(await port({read:async()=>({output:{id:'wrong'}})}).readHistory(stored,'instance_1'),null);
});

test('a pending command remains in the same instance journal after renderer projection',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),
    removeItem:key=>values.delete(key)};
  const scope={sessionId:'session_1',principalId:'owner_1',audience:'app',contextId:'application',
    conversationId:'conversation_1',messageId:'message_1',instanceId:'instance_1',instanceRevision:1};
  const pending={bindingId:'example.purchase:app.request.submit',operationDigest:oldOperation,
    toolName:'request_submit',requestKey:'request_1'};
  assert.equal(widgetActionJournal(scope,storage).write(pending),true);
  const projected=port().projectHistory(stored).instances[0];
  assert.deepEqual(widgetActionJournal({...scope,instanceId:projected.instanceId,
    instanceRevision:projected.instanceRevision},storage).read(),pending);
});

test('saved historical context is admitted only by the current action and input schema',()=>{
  const action={id:'pick',mode:'context',target:{namespace:'module-instance',fields:['id','revision']}};
  const current={...widget,actions:[action]};
  const currentValidators=new Map([['example.purchase\u0000card\u00001.0.0',{
    state:()=>true,input:()=>true,actionInputs:new Map([['pick',value=>value?.id==='request_1'
      &&Number.isSafeInteger(value?.revision)&&Object.keys(value).sort().join(',')==='id,revision']]),
    contextValues:new Map([['pick',value=>value?.id==='request_1'
      &&Number.isSafeInteger(value?.revision)&&Object.keys(value).sort().join(',')==='id,revision']]),
  }]]);
  const host=createWidgetOperationPort({catalog:{widgets:[current],resources:[]},validators:currentValidators,
    audience:'app',authorize:()=>{}});
  const instance=host.projectHistory(stored).instances[0];
  assert.equal(host.contextActionAvailable(instance,'pick'),true);
  assert.equal(host.contextActionAvailable(instance,'removed'),false);
  assert.equal(createWidgetOperationPort({catalog:{widgets:[current],resources:[]},validators:currentValidators,
    audience:'app',authorize:()=>{throw Error('revoked');}}).contextActionAvailable(instance,'pick'),false);
  assert.equal(createWidgetOperationPort({catalog:{widgets:[{...current,actions:[]}],resources:[]},
    validators:currentValidators,audience:'app',authorize:()=>{}}).contextActionAvailable(instance,'pick'),false);
  assert.equal(createWidgetOperationPort({catalog:{widgets:[current],resources:[]},
    validators:new Map(),audience:'app',authorize:()=>{}}).contextActionAvailable(instance,'pick'),false);
  assert.deepEqual({...host.contextValue(instance,'pick',{id:'request_1',revision:5})},
    {id:'request_1',revision:5});
  assert.equal(host.contextValue(instance,'pick',{oldField:'request_1'}),null);
  assert.equal(host.contextValue(instance,'pick',{id:'request_1',revision:5,oldField:'legacy'}),null);
  assert.equal(host.contextValue(instance,'removed',{id:'request_1',revision:5}),null);
});

test('compiled context projection validates retained fields and local nested refs without requiring discarded action inputs',async()=>{
  const action={id:'pick',mode:'context',input:{schema:{type:'object',additionalProperties:false,
    properties:{id:{$ref:'#/$defs/identity'},revision:{type:'integer',minimum:1},
      alias:{$ref:'#/properties/nonce'},nonce:{type:'string',pattern:'^token_[0-9]+$'}},
    required:['id','revision','nonce'],$defs:{identity:{type:'string',pattern:'^request_[0-9]+$'}}},
    schemaId:'pick-input',digest:hash('e')},target:{namespace:'module-instance',fields:['id','revision','alias']}};
  const compiled=compileWidgetContextValidators({widgets:[{actions:[action]}]});
  const validators=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
  const validate=validators[compiled.names.get('0:pick')];
  assert.equal(validate({id:'request_1',revision:5,alias:'token_4'}),true);
  assert.equal(validate({id:'wrong',revision:5,alias:'token_4'}),false);
  assert.equal(validate({id:'request_1',revision:0,alias:'token_4'}),false);
  assert.equal(validate({id:'request_1',revision:5,alias:'wrong'}),false);
  assert.equal(validate({id:'request_1',revision:5,alias:'token_4',nonce:'unexpected'}),false);
  assert.equal(validate({id:'request_1'}),false);
});
