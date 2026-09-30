import test from 'node:test';
import assert from 'node:assert/strict';
import {startAnalyticsCollection} from '../../app/analytics/collection.ts';

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
