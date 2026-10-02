import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema,inspectCompositionSchema} from '../../scripts/data/apply-schema.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const current=json('../../extensions/native/messaging/module/manifest.json');
function planFor(models){
  const composition=json('../../configuration/composition.json');
  const lock=json('../../configuration/composition.lock.json');
  lock.sdkVersion=composition.sdk.version;
  const module=structuredClone(current);
  module.contracts.models=models;
  const access=json('../../extensions/native/access/module/manifest.json');
  const selection=composition.modules.find(item=>item.moduleId===module.identity.id);
  const pinned=lock.modules.find(item=>item.moduleId===module.identity.id);
  assert.ok(selection&&pinned);
  composition.modules=composition.modules.filter(item=>
    ['creezio.access',module.identity.id].includes(item.moduleId));
  lock.modules=lock.modules.filter(item=>
    ['creezio.access',module.identity.id].includes(item.moduleId))
    .map(item=>item.moduleId===module.identity.id
      ?{...item,contractIntegrity:contractIntegrity(module)}:item);
  for(const audience of ['admin','app'])
    composition.exposure[audience].moduleIds=['creezio.access',module.identity.id];
  lock.compositionIntegrity=contractIntegrity(composition);
  return compileCompositionSchema({composition,lock,modules:[access,module]});
}
const table=(plan,id)=>plan.runtimeCatalog.modules.find(module=>module.moduleId==='creezio.messaging')
  .models.find(item=>item.modelId===id).table;

test('existing Messaging snapshot adopts nullable deletion marker without losing its rows',
  {timeout:30000},async()=>{
    const prior=structuredClone(current.contracts.models);
    prior.find(model=>model.id==='inbound_snapshot').fields=
      prior.find(model=>model.id==='inbound_snapshot').fields.filter(field=>field.id!=='deleted_at');
    for(const model of prior.filter(model=>['message','message_attachment'].includes(model.id)))
      model.deletion.mode='soft';
    const before=planFor(prior),after=planFor(current.contracts.models);
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'messaging-deletion-schema'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      assert.equal((await applyCompositionSchema(db,before,{expectedPlanDigest:before.planDigest})).ok,true);
      const at='2026-09-30T00:00:00.000Z';
      await db.prepare(`INSERT INTO "${table(before,'box')}"
        (context_id,owner_id,id,name,address,kind,created_at,updated_at,revision)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind('application','owner','box','Boîte','sender@example.test',
        'local',at,at,1).run();
      await db.prepare(`INSERT INTO "${table(before,'inbound_snapshot')}"
        (context_id,owner_id,box_id,id,email_id,box_address,box_revision,connection_id,
          config_revision,from_addr,to_addr,subject,text_body,html_body,received_at,
          attachments,snapshot_digest,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('application','owner','box','in-proof',
        'email-proof','sender@example.test',1,'connection-proof',1,'from@example.test',
        'sender@example.test','Historique','Corps conservé','<p>Corps</p>',at,'[]','a'.repeat(64),at).run();
      const inspected=await inspectCompositionSchema(db,after);
      assert.equal(inspected.state,'additive');
      assert.deepEqual(inspected.columnAdditions.map(item=>item.columns.map(column=>column.name)),
        [['deleted_at']]);
      assert.equal((await applyCompositionSchema(db,after,{expectedPlanDigest:after.planDigest})).ok,true);
      const row=await db.prepare(`SELECT id,text_body,deleted_at FROM "${table(after,'inbound_snapshot')}"
        WHERE id='in-proof'`).first();
      assert.deepEqual({...row},{id:'in-proof',text_body:'Corps conservé',deleted_at:null});
      assert.equal((await inspectCompositionSchema(db,after)).state,'ready');
    }finally{await runtime.dispose();}
  });
