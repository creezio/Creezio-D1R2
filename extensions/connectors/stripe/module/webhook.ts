/** Build-selected Stripe adapter; called only after host verification of the raw signed body. */
export function stripeWebhookInput(event:Record<string,unknown>,eventId:string,bodyDigest:string){
  const data=event.data;
  const object=data&&typeof data==='object'&&!Array.isArray(data)
    ?(data as Record<string,unknown>).object:null;
  const subject=object&&typeof object==='object'&&!Array.isArray(object)
    ?object as Record<string,unknown>:null;
  if(event.object!=='event'||event.id!==eventId||event.livemode!==false
    ||typeof event.type!=='string'||event.type.length>128||!subject
    ||typeof subject.id!=='string'||subject.id.length>128)
    throw new Error('Invalid Stripe event');
  const session=subject.object==='checkout.session'&&subject.id.startsWith('cs_test_');
  const mode=session&&['payment','subscription'].includes(String(subject.mode))
    ?subject.mode as 'payment'|'subscription':null;
  const status=session&&['open','complete','expired'].includes(String(subject.status))
    ?String(subject.status):null;
  const payment=session&&['paid','unpaid','no_payment_required'].includes(String(subject.payment_status))
    ?String(subject.payment_status):null;
  const customerId=session&&typeof subject.customer==='string'&&subject.customer.startsWith('cus_')
    &&subject.customer.length<=128?subject.customer:null;
  const subscriptionId=session&&mode==='subscription'&&typeof subject.subscription==='string'
    &&subject.subscription.startsWith('sub_')&&subject.subscription.length<=128
    ?subject.subscription:null;
  return {requestKey:eventId,eventId,bodyDigest,type:event.type,objectId:subject.id,
    livemode:false,sessionMode:mode,sessionStatus:status,paymentStatus:payment,
    customerId,subscriptionId};
}
