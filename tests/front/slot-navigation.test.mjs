import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currentProtectedSlot,protectedSlotNavigation} from '../../app/front/slot-navigation.ts';

const catalog=JSON.parse(readFileSync(new URL('../../.creezio/generated/composition.json',import.meta.url),'utf8'));
const view=catalog.frontCatalog.views.find(item=>item.id==='creezio.pages-navigation:editorial-nav');
const slot=catalog.frontCatalog.slots.find(item=>item.id==='creezio.pages-navigation:published-navigation');
const session={id:'session-app',principalId:'owner',audience:'app'};
const state={phase:'authenticated',pending:null,session};
const projection={sessionId:session.id,principalId:session.principalId,audience:'app',
  contextId:'application',compositionDigest:catalog.compositionDigest,
  viewIds:[view.id],slotIds:[slot.id]};
const scope={active:true,authorized:true,visible:true,contextId:'application',
  compositionDigest:catalog.compositionDigest,slotId:slot.id,viewId:view.id};

test('generated protected slot uses its already qualified view ID and live projection',()=>{
  assert.equal(slot.viewId,view.id);
  assert.equal(currentProtectedSlot(state,projection,scope),true);
  assert.equal(currentProtectedSlot(state,projection,{...scope,active:false}),false);
  assert.equal(currentProtectedSlot(state,{...projection,viewIds:[]},scope),false);
  assert.equal(currentProtectedSlot(state,{...projection,slotIds:[]},scope),false);
  assert.equal(currentProtectedSlot({...state,session:{...session,id:'other'}},projection,scope),false);
});

test('protected slot keeps local panel state and routes through the current host only',()=>{
  const calls=[];let current=true;
  const local={back:()=>true,forward:()=>true,readPanelState:()=>({draft:'kept'}),
    savePanelState:value=>{calls.push(['state',value]);return true;},
    open:()=>{throw Error('local slot route used');},visit:()=>{throw Error('local slot route used');}};
  const navigation=protectedSlotNavigation(local,{isCurrent:()=>current,
    open:(...args)=>{calls.push(['open',...args]);return true;},
    visit:(...args)=>{calls.push(['visit',...args]);return true;}});
  assert.equal(navigation.open('creezio.pages-navigation:front',{slug:'/aide'}),true);
  assert.equal(navigation.visit('/pages?slug=%2Faide',{replace:true}),true);
  assert.deepEqual(navigation.readPanelState(),{draft:'kept'});
  assert.equal(navigation.savePanelState({draft:'new'}),true);
  current=false;
  assert.equal(navigation.open('creezio.pages-navigation:front',{}),false);
  assert.equal(navigation.visit('/pages'),false);
  assert.deepEqual(calls,[['open','creezio.pages-navigation:front',{slug:'/aide'},undefined],
    ['visit','/pages?slug=%2Faide',{replace:true}],['state',{draft:'new'}]]);
});
