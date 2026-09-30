import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDeliveryReceipt} from '../../module/delivery.ts';

const row=(state='queued')=>({id:'intent-one',box_id:'box-one',direction:'outbound',state,
  folder:'outbox',provider_message_id:null,sent_at:null,revision:1});
function harness(message){
  const calls=[];
  return {calls,scope:{principalId:'alice',receivedAt:'2026-09-30T12:00:00.000Z',
    data:{async get(model,args){calls.push({model,args});return message;},
    planPatch(model,args){calls.push({model,args});return {kind:'data-plan'};}}}};
}
const input=receipt=>({boxId:'box-one',intentId:'intent-one',receipt});
test('accepted receipt creates only an owner-scoped CAS plan; no provider value becomes a key',async()=>{
  const h=harness(row());
  const plans=await projectDeliveryReceipt(input({kind:'accepted',providerMessageId:'remote-one'}),h.scope);
  assert.equal(plans.length,1);
  const patch=h.calls.find(x=>x.args.values);
  assert.deepEqual(patch.args.key,{owner_id:'alice',box_id:'box-one',id:'intent-one'});
  assert.equal(patch.args.compare.expected,1);
  assert.equal(patch.args.values.state,'sent');
  assert.equal(patch.args.values.provider_message_id,'remote-one');
});
test('unknown never says sent, later accepted can reconcile, terminal states do not regress',async()=>{
  const unknown=harness(row());
  await projectDeliveryReceipt(input({kind:'unknown'}),unknown.scope);
  assert.equal(unknown.calls.find(x=>x.args.values).args.values.state,'unknown');
  const accepted=harness({...row('unknown'),provider_message_id:null});
  await projectDeliveryReceipt(input({kind:'accepted',providerMessageId:'remote-one'}),accepted.scope);
  assert.equal(accepted.calls.find(x=>x.args.values).args.values.folder,'sent');
  await assert.rejects(projectDeliveryReceipt(input({kind:'unknown'}),
    harness({...row('delivered'),provider_message_id:'remote-one'}).scope),{code:'conflict'});
  const duplicate=harness({...row('sent'),provider_message_id:'remote-one'});
  assert.deepEqual(await projectDeliveryReceipt(input({kind:'accepted',providerMessageId:'remote-one'}),duplicate.scope),[]);
});
test('foreign or mismatched provider receipt is refused',async()=>{
  await assert.rejects(projectDeliveryReceipt(input({kind:'accepted',providerMessageId:'remote-one'}),
    harness(null).scope),{code:'unavailable'});
  await assert.rejects(projectDeliveryReceipt(input({kind:'bounced',providerMessageId:'other'}),
    harness({...row('sent'),provider_message_id:'remote-one'}).scope),{code:'conflict'});
});
