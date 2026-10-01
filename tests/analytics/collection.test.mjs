import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {startAnalyticsCollection} from '../../app/analytics/collection.ts';

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
  assert.deepEqual(analyticsIds,['analytics.refresh']);
  assert.deepEqual(catalogIds,['catalog.product.open']);
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
        route:declaredRoute('../../extensions/common/catalog/module/manifest.json','front')}]){
      const listeners=new Map(),calls=[];
      const target={addEventListener(name,fn){listeners.set(name,fn);},
        removeEventListener(name){listeners.delete(name);},contains(){return true}};
      let clicks=false;
      const client={async invoke(input){calls.push(input);
        return {kind:'execution',execution:{state:'succeeded',
          output:input.bindingId.endsWith('collection.effective')
            ?{navigation:false,clicks}: {}}};}};
      const collector=startAnalyticsCollection({client,contextId:'application',
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
      assert.deepEqual({type:emitted[0].input.type,surface:emitted[0].input.surface,
        path:emitted[0].input.path,actionId:emitted[0].input.actionId},
      {type:'click',surface:scenario.surface,path:scenario.route,actionId:scenario.id});
      assert.deepEqual(Object.keys(emitted[0].input).sort(),
        ['actionId','path','requestKey','surface','type']);
      collector.dispose();assert.equal(listeners.size,0);
    }
  }finally{globalThis.Element=oldElement;}
});
