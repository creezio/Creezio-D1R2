import {OperationError,type JsonValue,type OperationDataPort,type DataPlan} from '@creezio/sdk/operations/handler';

type Row=Record<string,JsonValue>;
export interface DeliveryProjectionScope {
  readonly principalId:string;
  readonly data:OperationDataPort;
  readonly receivedAt:string;
}
export interface DeliveryReceipt {
  readonly kind:'accepted'|'rejected'|'unknown'|'delivered'|'bounced';
  readonly providerMessageId?:string;
}
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const providerId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256
  &&value.isWellFormed()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(code:'invalid_input'|'unavailable'|'conflict'):never=>{throw new OperationError(code);};

/** Pure plan projection. The host binds this to its current scoped delivery lease. */
export async function projectDeliveryReceipt(input:Readonly<{boxId:string;intentId:string;receipt:DeliveryReceipt}>,
  scope:DeliveryProjectionScope):Promise<readonly DataPlan[]> {
  if(!identifier(input.boxId)||!identifier(input.intentId)||!input.receipt
    ||!['accepted','rejected','unknown','delivered','bounced'].includes(input.receipt.kind)
    ||(input.receipt.kind==='accepted'||input.receipt.kind==='delivered'||input.receipt.kind==='bounced')
      &&!providerId(input.receipt.providerMessageId)
    ||input.receipt.providerMessageId!==undefined&&!providerId(input.receipt.providerMessageId))fail('invalid_input');
  const key={owner_id:scope.principalId,box_id:input.boxId,id:input.intentId};
  const row=await scope.data.get('message',{key}) as Row|null;
  if(!row||row.direction!=='outbound'||row.id!==input.intentId)fail('unavailable');
  const message=row as Row;
  const current=String(message.state),next={accepted:'sent',rejected:'failed',unknown:'unknown',
    delivered:'delivered',bounced:'bounced'}[input.receipt.kind];
  const allowed:Record<string,readonly string[]>={queued:['sent','failed','unknown'],
    sending:['sent','failed','unknown'],unknown:['sent','failed','delivered','bounced'],
    sent:['delivered','bounced'],delivered:[],bounced:[],failed:[]};
  if(!Object.hasOwn(allowed,current))fail('unavailable');
  if(current===next){
    if(input.receipt.providerMessageId!==undefined&&message.provider_message_id!==input.receipt.providerMessageId)
      fail('conflict');
    return [];
  }
  if(!allowed[current].includes(next))fail('conflict');
  if(message.provider_message_id!==null&&input.receipt.providerMessageId!==undefined
    &&message.provider_message_id!==input.receipt.providerMessageId)fail('conflict');
  if((next==='delivered'||next==='bounced')&&message.provider_message_id!==null
    &&message.provider_message_id!==input.receipt.providerMessageId)fail('conflict');
  const values:Row={state:next,folder:['sent','delivered','bounced'].includes(next)?'sent':'outbox'};
  if(input.receipt.providerMessageId!==undefined)values.provider_message_id=input.receipt.providerMessageId;
  if(next==='sent'&&message.sent_at===null)values.sent_at=scope.receivedAt;
  return [scope.data.planPatch('message',{key,compare:{field:'revision',expected:Number(message.revision)},values})];
}
