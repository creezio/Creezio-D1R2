import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {startAnalyticsCollection} from '../../app/analytics/collection.ts';
import {createWorkspaceController} from '../../sdk/workspace/controller.ts';

function actionIdsFromButtons(path){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const ids=[];
  const visit=node=>{
    if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))
      &&node.tagName.getText(file)==='button'){
      for(const attribute of node.attributes.properties){
        if(ts.isJsxAttribute(attribute)&&attribute.name.text==='data-creezio-analytics-id'){
          assert.ok(attribute.initializer&&ts.isStringLiteral(attribute.initializer),
            'click action IDs must be static JSX string literals');
          ids.push(attribute.initializer.text);
        }
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(file);
  return ids;
}
function declaredRoute(path,viewId){
  const manifest=JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
  const route=manifest.contracts.ui.views.find(view=>view.id===viewId)?.route;
  assert.equal(typeof route,'string',`missing declared route for ${viewId}`);
  return route;
}

test('optional collection uses only declared routes and explicit stable IDs',async()=>{
  const oldElement=globalThis.Element;
  class FakeElement{
    constructor(id){this.id=id;}
    closest(){return this;}
    getAttribute(name){return name==='data-creezio-analytics-id'?this.id:null;}
  }
  globalThis.Element=FakeElement;
  const listeners=new Map(),calls=[];
  const target={addEventListener(name,fn){listeners.set(name,fn);},
    removeEventListener(name){listeners.delete(name);},contains(){return true}};
  let flags={navigation:false,clicks:false};
  const client={async invoke(input){calls.push(input);
    if(input.bindingId.endsWith('collection.effective'))return {kind:'execution',
      execution:{state:'succeeded',output:flags}};
    return {kind:'execution',execution:{state:'succeeded',output:{}}};}};
  try{
    const collector=startAnalyticsCollection({client,contextId:'space-one',audience:'app',surface:'front',target});
    collector.location({viewId:'creezio.catalog:detail',route:'/catalog/:id'});
    await collector.refresh();
    assert.equal(calls.filter(call=>call.bindingId.endsWith('event.record')).length,0);
    flags={navigation:true,clicks:true};await collector.refresh();
    listeners.get('click')({target:new FakeElement('catalog.open')});
    listeners.get('click')({target:new FakeElement('private text <script>')});
    collector.location({viewId:'creezio.catalog:detail',route:'/catalog/:id?token=secret'});
    await collector.refresh();
    const recorded=calls.filter(call=>call.bindingId.endsWith('event.record')).map(call=>call.input);
    assert.deepEqual(recorded.map(item=>item.type),['page_view','click']);
    assert.deepEqual(recorded.map(item=>item.path),['/catalog/:id','/catalog/:id']);
    assert.equal(recorded[1].actionId,'catalog.open');
    assert.equal(JSON.stringify(recorded).includes('secret'),false);
    assert.equal(JSON.stringify(recorded).includes('private text'),false);
    collector.dispose();assert.equal(listeners.size,0);
  }finally{globalThis.Element=oldElement;}
});

test('real workspace and front buttons opt in only with stable, policy-enabled IDs',async()=>{
  const analyticsIds=actionIdsFromButtons('../../extensions/native/analytics/ui/index.tsx');
  const catalogIds=actionIdsFromButtons('../../extensions/common/catalog/ui/front.tsx');
  const supportIds=actionIdsFromButtons('../../extensions/native/support/ui/index.tsx');
  const crmIds=actionIdsFromButtons('../../extensions/native/crm/ui/index.tsx');
  assert.deepEqual(analyticsIds,['analytics.refresh']);
  assert.deepEqual(catalogIds,['catalog.product.open']);
  assert.deepEqual(supportIds,['support.ticket.open']);
  assert.deepEqual(crmIds,['crm.record.open']);
  const oldElement=globalThis.Element;
  class FakeElement{
    constructor(id){this.id=id;}
    closest(){return this;}
    getAttribute(name){return name==='data-creezio-analytics-id'?this.id:null;}
  }
  globalThis.Element=FakeElement;
  try{
    for(const scenario of [
      {id:analyticsIds[0],audience:'admin',surface:'workspace',
        route:declaredRoute('../../extensions/native/analytics/module/manifest.json','admin')},
      {id:catalogIds[0],audience:'app',surface:'front',
        route:declaredRoute('../../extensions/common/catalog/module/manifest.json','front')},
      ...(['workspace','front']).map(viewId=>({id:supportIds[0],
        audience:viewId==='workspace'?'admin':'app',surface:viewId,
        route:declaredRoute('../../extensions/native/support/module/manifest.json',viewId)})),
      ...(['workspace','front']).map(viewId=>({id:crmIds[0],
        audience:viewId==='workspace'?'admin':'app',surface:viewId,
        route:declaredRoute('../../extensions/native/crm/module/manifest.json',viewId)}))]){
      const listeners=new Map(),calls=[];
      const target={addEventListener(name,fn){listeners.set(name,fn);},
        removeEventListener(name){listeners.delete(name);},contains(){return true}};
      let clicks=false;
      const client={async invoke(input){calls.push(input);
        return {kind:'execution',execution:{state:'succeeded',
          output:input.bindingId.endsWith('collection.effective')
            ?{navigation:false,clicks}: {}}};}};
      const contextId=`context-${scenario.id}-${scenario.audience}`;
      const collector=startAnalyticsCollection({client,contextId,
        audience:scenario.audience,surface:scenario.surface,target});
      collector.location({viewId:`view:${scenario.surface}`,route:scenario.route});
      await collector.refresh();
      listeners.get('click')({target:new FakeElement(scenario.id)});
      assert.equal(calls.filter(call=>call.bindingId.endsWith('event.record')).length,0);
      clicks=true;await collector.refresh();
      listeners.get('click')({target:new FakeElement(scenario.id)});
      const emitted=calls.filter(call=>call.bindingId.endsWith('event.record'));
      assert.equal(emitted.length,1);
      assert.equal(emitted[0].bindingId,`creezio.analytics:${scenario.audience}.event.record`);
      assert.equal(emitted[0].contextId,contextId);
      assert.deepEqual({type:emitted[0].input.type,surface:emitted[0].input.surface,
        path:emitted[0].input.path,actionId:emitted[0].input.actionId},
      {type:'click',surface:scenario.surface,path:scenario.route,actionId:scenario.id});
      assert.deepEqual(Object.keys(emitted[0].input).sort(),
        ['actionId','path','requestKey','surface','type']);
      collector.dispose();assert.equal(listeners.size,0);
    }
  }finally{globalThis.Element=oldElement;}
});

test('panel state publication preserves the click before document bubbling',async()=>{
  const originalElement=globalThis.Element;
  class FakeElement{
    constructor(id){this.id=id;}
    closest(){return this;}
    getAttribute(name){return name==='data-creezio-analytics-id'?this.id:null;}
  }
  globalThis.Element=FakeElement;
  const listeners=new Map(),calls=[];
  const target={addEventListener(name,fn,capture){listeners.set(name,{fn,capture});},
    removeEventListener(name,fn,capture){assert.deepEqual(listeners.get(name),{fn,capture});
      listeners.delete(name);},contains(){return true}};
  const client={async invoke(input){calls.push(input);return {kind:'execution',
    execution:{state:'succeeded',output:input.bindingId.endsWith('collection.effective')
      ?{navigation:false,clicks:true}:{}}};}};
  const session={id:'session-one',principalId:'owner-one',audience:'admin'};
  const access={audience:'admin',getSnapshot:()=>({phase:'authenticated',pending:null,session}),
    subscribe:()=>()=>{}};
  const view={id:'creezio.support:admin',moduleId:'creezio.support',title:'Support',
    route:'/admin/support',surfaces:['workspace'],audiences:['admin'],
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend'},
    validateInput:()=>true,validateState:data=>typeof data?.ticketId==='string',component:()=>null};
  const crm={...view,id:'creezio.crm:admin',moduleId:'creezio.crm',title:'CRM',
    route:'/admin/crm'};
  const projection={sessionId:session.id,principalId:session.principalId,audience:'admin',
    contextId:'application',compositionDigest:`sha256-${'a'.repeat(64)}`,epoch:1,
    viewIds:[view.id,crm.id],navigationIds:[]};
  const entries=new Map(),storage={getItem:key=>entries.get(key)??null,
    setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key),
    get length(){return entries.size;},key:index=>[...entries.keys()][index]??null};
  let collector=null,analyticsUrl=null;
  try{
    const controller=createWorkspaceController({access,views:[view,crm],contextId:'application',
      projection,initialUrl:'/admin/support',storage,onLocationChange:url=>{
        analyticsUrl=url;
        if(collector){const selected=url==='/admin/crm'?crm:view;
          collector.location({viewId:selected.id,route:selected.route});
          void collector.refresh();}
      }});
    collector=startAnalyticsCollection({client,contextId:'application',audience:'admin',
      surface:'workspace',target});
    collector.location({viewId:view.id,route:view.route});await collector.refresh();
    assert.equal(analyticsUrl,'/admin/support');
    const listener=listeners.get('click'),supportClick={target:new FakeElement('support.ticket.open')};
    if(listener.capture)listener.fn(supportClick);
    assert.equal(controller.savePanelState({data:{ticketId:'existing-ticket'}}),true);
    if(!listener.capture)listener.fn(supportClick);
    assert.equal(calls.filter(call=>call.bindingId.endsWith('event.record')).length,1);
    assert.equal(controller.visit('/admin/crm'),true);
    listener.fn({target:new FakeElement('crm.record.open')});
    assert.equal(calls.filter(call=>call.bindingId.endsWith('event.record')).length,1,
      'a real route change immediately suspends collection until refresh');
    await collector.refresh();
    listener.fn({target:new FakeElement('crm.record.open')});
    assert.deepEqual(calls.filter(call=>call.bindingId.endsWith('event.record'))
      .map(call=>call.input.path),['/admin/support','/admin/crm']);
    collector.dispose();controller.dispose();
    assert.equal(listeners.size,0);
  }finally{globalThis.Element=originalElement;}
});
