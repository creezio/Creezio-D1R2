import test from 'node:test';
import assert from 'node:assert/strict';
import {createModuleSettingsClient,MODULE_SETTINGS_BINDINGS} from '../../sdk/module-settings/client.ts';
import {createModuleSettingsController} from '../../sdk/module-settings/controller.ts';

const hash='sha256-'+'a'.repeat(64);
const succeeded=output=>({kind:'execution',execution:{id:'execution-1',state:'succeeded',output,errorCode:null}});
const session={id:'session-1',principalId:'owner',displayName:'Owner',audience:'admin',
  createdAtMs:1,expiresAtMs:9999999999999};
function harness() {
  let state={phase:'authenticated',session,pending:null,error:null,coordination:'document'};
  const listeners=new Set();
  const access={audience:'admin',origin:'https://example.invalid',getSnapshot:()=>state,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
  const calls=[];
  let stored=null, lookup={kind:'unknown',code:'execution_not_observed'};
  const persistence={read:()=>stored,save(value){stored=value;return true;}};
  const operations={audience:'admin',origin:access.origin,
    async invoke(request){calls.push({kind:'invoke',request,stored});return {kind:'unknown',code:'outcome_unknown'};},
    async status(request){calls.push({kind:'status',request,stored});return lookup;}};
  return {access,operations,persistence,calls,getStored:()=>stored,setLookup:value=>{lookup=value;},
    setState(value){state=value;for(const listener of listeners) listener();}};
}

test('typed module client uses six declared T06 bindings and validates output',async()=>{
  const calls=[];
  const operations={audience:'admin',origin:'https://example.invalid',
    async invoke(request){calls.push(request);return succeeded({items:[],nextAfterId:null,
      compositionDigest:hash,lockDigest:hash,inventoryDigest:hash,revision:0});},
    async status(){throw new Error('unused');}};
  const client=createModuleSettingsClient(operations);
  const result=await client.list({limit:20});
  assert.equal(result.ok,true);
  assert.equal(calls[0].bindingId,MODULE_SETTINGS_BINDINGS.catalogList);
  assert.equal(calls[0].contextId,'application');
  operations.invoke=async()=>succeeded({items:[],nextAfterId:null,compositionDigest:hash,
    inventoryDigest:hash,revision:0});
  assert.deepEqual(await client.list({limit:20}),{ok:false,error:'invalid_response'},
    'a missing lock digest cannot silently become an intent base');
});

test('catalog titles accept 4000 Unicode code points and reject 4001',async()=>{
  let title='🧩'.repeat(4000), description='🧩'.repeat(4096);
  const operations={audience:'admin',origin:'https://example.invalid',
    async invoke(){return succeeded({items:[{moduleId:'module.one',title,description,
      origin:'https://example.invalid/module',version:'1.0.0',candidateKey:null,
      codePresent:true,enabled:false,configuration:'unknown',operational:'unknown',visibility:'available'}],
      nextAfterId:null,compositionDigest:hash,lockDigest:hash,inventoryDigest:hash,revision:0});},
    async status(){throw new Error('unused');}};
  const client=createModuleSettingsClient(operations);
  assert.equal((await client.list({limit:1})).ok,true,
    '4000 supplementary Unicode characters must count as 4000 code points');
  title='a'.repeat(4000);
  assert.equal((await client.list({limit:1})).ok,true);
  title+='a';
  assert.deepEqual(await client.list({limit:1}),{ok:false,error:'invalid_response'});
  title='🧩'.repeat(4001);
  assert.deepEqual(await client.list({limit:1}),{ok:false,error:'invalid_response'});
  title='Module'; description='🧩'.repeat(4097);
  assert.deepEqual(await client.list({limit:1}),{ok:false,error:'invalid_response'});
});

test('catalog detail accepts a diagnostic message of 4096 Unicode code points',async()=>{
  let message='🧩'.repeat(4096);
  const operations={audience:'admin',origin:'https://example.invalid',
    async invoke(){return succeeded({module:{moduleId:'module.one',title:'Module',description:'',
      origin:'https://example.invalid/module',version:'1.0.0',candidateKey:null,
      codePresent:true,enabled:false,configuration:'unknown',operational:'unknown',visibility:'available'},
      dependsOn:[],usedBy:[],optionalIntegrations:[],
      diagnostics:[{code:'module.warning',severity:'warning',moduleId:null,message}]});},
    async status(){throw new Error('unused');}};
  const client=createModuleSettingsClient(operations);
  assert.equal((await client.detail('module.one')).ok,true);
  message='🧩'.repeat(4097);
  assert.deepEqual(await client.detail('module.one'),{ok:false,error:'invalid_response'});
});

test('controller persists request key before invoke, reconciles unknown without replay, and keeps stable snapshots',async()=>{
  const h=harness(), controller=createModuleSettingsController({operations:h.operations,
    access:h.access,persistence:h.persistence});
  const first=controller.getSnapshot();
  assert.equal(controller.getSnapshot(),first);
  assert.equal(first.authorized,true);
  let notifications=0; controller.subscribe(()=>notifications++);
  const outcome=await controller.accept({expectedRevision:0,expectedPlanDigest:hash,
    intent:{schemaVersion:1,base:{revision:0,compositionDigest:hash,lockDigest:hash,inventoryDigest:hash},actions:[]}});
  assert.equal(outcome.kind,'unknown');
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].kind,'invoke');
  assert.equal(h.calls[0].stored.requestKey,h.calls[0].request.input.requestKey);
  assert.equal(controller.getSnapshot().pendingCommand.requestKey,outcome.requestKey);
  assert.ok(notifications>=2);
  const blocked=await controller.accept({expectedRevision:0,expectedPlanDigest:hash,
    intent:{schemaVersion:1,base:{revision:0,compositionDigest:hash,lockDigest:hash,inventoryDigest:hash},actions:[]}});
  assert.equal(blocked.kind,'unknown');
  assert.equal(h.calls.length,1);
  const fresh=createModuleSettingsController({operations:h.operations,access:h.access,persistence:h.persistence});
  assert.equal(fresh.getSnapshot().pendingCommand.requestKey,outcome.requestKey);
  h.setLookup(succeeded({planId:'plan-1',revision:1,status:'accepted_pending_publication',planDigest:hash}));
  const reconciled=await fresh.reconcilePending();
  assert.equal(reconciled.kind,'accepted');
  assert.deepEqual(h.calls.map(call=>call.kind),['invoke','status']);
  assert.equal(h.getStored(),null);
  assert.equal(fresh.getSnapshot().pendingCommand,null);
  h.setState({...h.access.getSnapshot(),phase:'anonymous',session:null});
  assert.equal(fresh.getSnapshot().authorized,false);
  assert.equal(fresh.getSnapshot().pendingCommand,null);
  fresh.dispose(); controller.dispose();
});

test('controller refuses mutation if pending key cannot be stored',async()=>{
  const h=harness(); h.persistence.save=()=>false;
  const controller=createModuleSettingsController({operations:h.operations,access:h.access,persistence:h.persistence});
  const result=await controller.accept({expectedRevision:0,expectedPlanDigest:hash,
    intent:{schemaVersion:1,base:{revision:0,compositionDigest:hash,lockDigest:hash,inventoryDigest:hash},actions:[]}});
  assert.deepEqual(result,{kind:'rejected',code:'persistence_unavailable'});
  assert.equal(h.calls.length,0);
  controller.dispose();
});
