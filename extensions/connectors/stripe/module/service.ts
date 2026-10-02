import {OperationError,type OperationContext,type JsonValue,type ProviderSecretsPort} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {STRIPE_CONNECTOR_ID,STRIPE_ORIGIN} from './storage.ts';
import {projectStripePage,type Collection} from './projection.ts';

type Row=Record<string,JsonValue>;
const args=(value:JsonValue):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:{};
const configKey=()=>({id:STRIPE_CONNECTOR_ID});
const config=async(context:OperationContext)=>await context.data.get('connector_config',{key:configKey()}) as Row|null;
const connectionId=(row:Row|null):string|null=>typeof row?.connection_id==='string'?row.connection_id:null;
const collections:Collection[]=['customers','subscriptions','invoices','products','prices_active','prices_inactive'];
const runModel=(id:Collection)=>id==='products'||id.startsWith('prices_')
  ?'stripe_catalog_sync_state':'sync_state';
const projectionModel=(id:Collection)=>id==='customers'?'stripe_customer':
  id==='subscriptions'?'stripe_subscription':id==='invoices'?'stripe_invoice':
    id==='products'?'stripe_product':'stripe_price';
const run=async(context:OperationContext,collection:Collection)=>await context.data.get(runModel(collection),
  {key:{id:collection}}) as Row|null;
const rev=(value:unknown,current:Row|null):number=>{
  if(!Number.isSafeInteger(value)||Number(value)<0||value!==(current?.revision??0))
    throw new OperationError('conflict');
  return Number(value);
};
const collection=(value:unknown):Collection=>{
  if(!collections.includes(value as Collection))throw new OperationError('invalid_input');
  return value as Collection;
};
const identifier=(value:unknown,max=128):string=>{
  if(typeof value!=='string'||!value||value.length>max||!value.isWellFormed()
    ||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value))throw new OperationError('invalid_input');
  return value;
};
const cursor=(value:unknown):string|null=>value===null?null:identifier(value);
const keySecret=(value:unknown):value is string=>typeof value==='string'&&value.length>=8
  &&value.length<=4096&&value.isWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(value);
const returnOrigin=(value:unknown):string|null=>{
  if(value===null)return null;
  if(typeof value!=='string'||value.length>512||!value.isWellFormed())throw new OperationError('invalid_input');
  let url:URL;try{url=new URL(value);}catch{throw new OperationError('invalid_input');}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash
    ||url.origin!==value||url.hostname==='localhost'||url.hostname.endsWith('.localhost')
    ||!url.hostname.includes('.'))throw new OperationError('invalid_input');
  return value;
};
const appReturnPath=(value:unknown):string|null=>{
  if(value===null)return null;
  if(typeof value!=='string'||value.length>256||!value.isWellFormed()
    ||!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(value))
    throw new OperationError('invalid_input');
  return value;
};
const now=()=>new Date().toISOString();
const configView=(row:Row|null)=>({origin:STRIPE_ORIGIN,enabled:row?.enabled===true,
  hasKey:typeof row?.key_ref==='string',
  hasWebhookSecret:typeof row?.webhook_key_ref==='string',
  hasWebhookService:typeof row?.webhook_service_token_ref==='string',
  checkoutReturnOrigin:typeof row?.checkout_return_origin==='string'?row.checkout_return_origin:null,
  checkoutAppReturnPath:typeof row?.checkout_app_return_path==='string'
    ?row.checkout_app_return_path:'/offers',
  revision:typeof row?.revision==='number'?row.revision:0,
  state:!row||!row.key_ref?'missing':row.enabled===true?'unverified':'configured'});
const runView=(row:Row|null,id:Collection)=>({collection:id,runId:typeof row?.run_id==='string'?row.run_id:null,
  cursor:typeof row?.cursor==='string'?row.cursor:null,
  status:row?.status==='pages_exhausted'?'pages_exhausted':'partial',
  revision:typeof row?.revision==='number'?row.revision:0,
  updatedAt:typeof row?.updated_at==='string'?row.updated_at:null});
const secrets=(context:OperationContext):ProviderSecretsPort=>{
  if(!context.providerSecrets)throw new OperationError('unsupported');
  return context.providerSecrets;
};
const webhookRefs=(row:Row)=>[
  [row.webhook_key_ref,row.webhook_secret_version],
  [row.webhook_previous_key_ref,row.webhook_previous_secret_version],
  [row.webhook_service_token_ref,row.webhook_service_token_version]
].filter((item):item is [string,number]=>typeof item[0]==='string'&&Number.isSafeInteger(item[1]));
const revokeWebhookSecrets=async(context:OperationContext,row:Row)=>Promise.all(webhookRefs(row)
  .map(async([reference,expectedVersion])=>(await secrets(context).prepareRevoke({
    providerId:STRIPE_CONNECTOR_ID,reference,expectedVersion})).plan));
const remote=async(context:OperationContext,request:Parameters<ConnectorPort['request']>[0]):Promise<JsonValue>=>{
  if(!context.connector)throw new OperationError('unavailable');
  const answer=await context.connector.request({...request,signal:context.signal});
  if(answer.kind==='ok')return answer.body;
  throw new OperationError(answer.code==='access_denied'?'forbidden':
    answer.code==='invalid_request'?'invalid_input':answer.code==='remote_not_found'?'not_found':'unavailable');
};
const mutation=async(context:OperationContext,request:Parameters<ConnectorPort['mutate']>[0]):Promise<JsonValue>=>{
  if(!context.connector)throw new OperationError('unavailable');
  const answer=await context.connector.mutate({...request,signal:context.signal});
  if(answer.kind==='ok')return answer.body;
  throw new OperationError(answer.code==='access_denied'?'forbidden':
    answer.code==='invalid_request'?'invalid_input':
    answer.code==='outcome_unknown'?'unknown':'unavailable');
};
const supplier=(value:JsonValue):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:(()=>{throw new OperationError('unavailable');})();
const testCheckout=(value:JsonValue,expectedMode:'payment'|'subscription')=>{
  const row=supplier(value),id=identifier(row.id),mode=row.mode;
  if(!id.startsWith('cs_test_')||row.object!=='checkout.session'||row.livemode!==false
    ||mode!==expectedMode||!['open','complete','expired'].includes(String(row.status))
    ||!['paid','unpaid','no_payment_required'].includes(String(row.payment_status)))
    throw new OperationError('unavailable');
  const url=row.url;
  if(url!==null&&url!==undefined&&(typeof url!=='string'||url.length>2048
    ||!url.startsWith('https://checkout.stripe.com/')))throw new OperationError('unavailable');
  return {id,url:typeof url==='string'?url:null,mode:expectedMode,
    status:String(row.status),paymentStatus:String(row.payment_status),livemode:false as const};
};
const linkedId=(value:unknown,prefix:string):string|null=>{
  if(value===null||value===undefined)return null;
  const id=identifier(value);
  if(!id.startsWith(prefix))throw new OperationError('unavailable');
  return id;
};
const offerView=(row:Row)=>({id:row.id,productId:row.product_id,priceId:row.price_id,
  name:row.product_name,mode:row.mode,enabled:row.enabled,unitAmountMinor:row.unit_amount_minor,
  currency:row.currency,interval:row.interval,intervalCount:row.interval_count,
  revision:row.revision});
const fixedPrice=async(context:OperationContext,id:string,mode:'payment'|'subscription',
  configuration:Row)=>{
  const price=await context.data.get('stripe_price',{key:{id}}) as Row|null;
  if(!price||price.connection_id!==configuration.connection_id||price.active!==true
    ||price.livemode!==false||price.type!==(mode==='payment'?'one_time':'recurring')
    ||price.billing_scheme!=='per_unit'||price.custom_amount!==false
    ||price.usage_type==='metered'||!Number.isSafeInteger(price.unit_amount_minor)
    ||Number(price.unit_amount_minor)<1)throw new OperationError('invalid_input');
  return price;
};
const offerProduct=async(context:OperationContext,price:Row,configuration:Row)=>{
  const id=identifier(price.product_id),product=await context.data.get('stripe_product',
    {key:{id}}) as Row|null;
  if(!product||product.connection_id!==configuration.connection_id||product.active!==true
    ||product.livemode!==false||typeof product.name!=='string'||!product.name)
    throw new OperationError('invalid_input');
  return product;
};
const offerProjectionReady=async(context:OperationContext,configuration:Row|null,offer:Row|null)=>{
  if(!configuration||configuration.enabled!==true||typeof configuration.connection_id!=='string'
    ||typeof configuration.checkout_return_origin!=='string')throw new OperationError('invalid_input');
  if(!offer||offer.enabled!==true||offer.connection_id!==configuration.connection_id
    ||!['payment','subscription'].includes(String(offer.mode)))throw new OperationError('not_found');
  const price=await fixedPrice(context,String(offer.price_id),offer.mode as 'payment'|'subscription',configuration);
  const product=await offerProduct(context,price,configuration);
  if(price.product_id!==offer.product_id||product.id!==offer.product_id
    ||price.unit_amount_minor!==offer.unit_amount_minor||price.currency!==offer.currency
    ||price.interval!==offer.interval||price.interval_count!==offer.interval_count)
    throw new OperationError('invalid_input');
  return {configuration,offer,price,product};
};
const offerReady=async(context:OperationContext,offerId:unknown)=>{
  const id=identifier(offerId),configuration=await config(context);
  const offer=await context.data.get('stripe_offer',{key:{id}}) as Row|null;
  return offerProjectionReady(context,configuration,offer);
};
const checkoutReady=async(context:OperationContext,priceId:unknown,mode:'payment'|'subscription',
  quantity:unknown,customerId:unknown)=>{
  const id=identifier(priceId),count=Number(quantity),configuration=await config(context);
  if(!id.startsWith('price_')||!Number.isSafeInteger(count)||count<1||count>100
    ||!configuration||configuration.enabled!==true||typeof configuration.connection_id!=='string'
    ||typeof configuration.checkout_return_origin!=='string')throw new OperationError('invalid_input');
  await fixedPrice(context,id,mode,configuration);
  let customer:string|undefined;
  if(customerId!==undefined){
    customer=identifier(customerId);
    if(!customer.startsWith('cus_'))throw new OperationError('invalid_input');
    const projected=await context.data.get('stripe_customer',{key:{id:customer}}) as Row|null;
    if(!projected||projected.connection_id!==configuration.connection_id||projected.livemode!==false)
      throw new OperationError('invalid_input');
  }
  return {configuration,id,count,customer};
};
export async function offerSet(value:JsonValue,context:OperationContext){
  const input=args(value),configuration=await config(context),at=now();
  if(!configuration||typeof configuration.connection_id!=='string'
    ||typeof input.enabled!=='boolean')throw new OperationError('invalid_input');
  const id=input.offerId===undefined?crypto.randomUUID():identifier(input.offerId);
  const prior=input.offerId===undefined?null:await context.data.get('stripe_offer',{key:{id}}) as Row|null;
  const revision=rev(input.revision,prior);
  if((prior===null)!==(input.offerId===undefined))throw new OperationError('conflict');
  const productId=identifier(input.productId),priceId=identifier(input.priceId);
  if(!productId.startsWith('prod_')||!priceId.startsWith('price_'))throw new OperationError('invalid_input');
  let values:Row;
  const plans=[];
  if(!input.enabled&&prior){
    if(prior.product_id!==productId||prior.price_id!==priceId
      ||prior.connection_id!==configuration.connection_id)throw new OperationError('invalid_input');
    values={enabled:false,updated_at:at};
  }else{
    const price=await context.data.get('stripe_price',{key:{id:priceId}}) as Row|null;
    if(!price||!['one_time','recurring'].includes(String(price.type)))
      throw new OperationError('invalid_input');
    const mode=price.type==='one_time'?'payment':'subscription';
    await fixedPrice(context,priceId,mode,configuration);
    const product=await offerProduct(context,price,configuration);
    if(price.product_id!==productId||product.id!==productId)throw new OperationError('invalid_input');
    values={connection_id:configuration.connection_id,product_id:productId,price_id:priceId,
      product_name:product.name,unit_amount_minor:price.unit_amount_minor,currency:price.currency,
      interval:price.interval,interval_count:price.interval_count,mode,enabled:input.enabled,updated_at:at};
    plans.push(context.data.planGet('stripe_price',{key:{id:priceId},required:true,
      where:{connection_id:configuration.connection_id,active:true,livemode:false,
        product_id:productId,unit_amount_minor:price.unit_amount_minor,currency:price.currency,
        type:price.type,billing_scheme:'per_unit',custom_amount:false,
        usage_type:price.usage_type??null,interval:price.interval??null,
        interval_count:price.interval_count??null}}));
    plans.push(context.data.planGet('stripe_product',{key:{id:productId},required:true,
      where:{connection_id:configuration.connection_id,active:true,livemode:false}}));
  }
  plans.push(context.data.planGet('connector_config',{key:configKey(),required:true,
    where:{connection_id:configuration.connection_id,revision:configuration.revision}}));
  plans.push(prior?context.data.planPatch('stripe_offer',{key:{id},
    compare:{field:'revision',expected:revision},values}):
    context.data.planCreate('stripe_offer',{values:{id,...values,revision:1}}));
  return {output:{offer:offerView({...(prior??{}),id,...values,revision:revision+1})},plans};
}
export async function offerList(value:JsonValue,context:OperationContext){
  const input=listInput(value),generation=connectionId(await config(context));
  if(input.limit>8)throw new OperationError('invalid_input');
  if(!generation)return {output:{items:[],nextCursor:null}};
  const page=await context.data.list('stripe_offer',{limit:input.limit,where:{connection_id:generation},
    ...(input.cursor?{after:{id:input.cursor}}:{})});
  return {output:{items:page.items.map(offerView),nextCursor:page.nextAfter?.id??null}};
}
export async function appOfferList(value:JsonValue,context:OperationContext){
  const input=listInput(value),configuration=await config(context),generation=connectionId(configuration);
  if(input.limit>8)throw new OperationError('invalid_input');
  if(!generation)return {output:{items:[],nextCursor:null}};
  const page=await context.data.list('stripe_offer',{limit:input.limit,
    where:{connection_id:generation,enabled:true},
    ...(input.cursor?{after:{id:input.cursor}}:{})});
  const items=[];
  for(const row of page.items){
    try{await offerProjectionReady(context,configuration,row);items.push(offerView(row));}
    catch(error){if(!(error instanceof OperationError))throw error;}
  }
  const final=await config(context);
  if(connectionId(final)!==generation||final?.revision!==configuration?.revision
    ||final?.enabled!==configuration?.enabled)throw new OperationError('conflict');
  return {output:{items,nextCursor:page.nextAfter?.id??null}};
}
export async function appCheckoutCreate(value:JsonValue,context:OperationContext){
  const input=args(value),{configuration,offer,price,product}=await offerReady(context,input.offerId);
  const mode=offer.mode as 'payment'|'subscription',returnUrl=String(configuration.checkout_return_origin)
    +(typeof configuration.checkout_app_return_path==='string'
      ?appReturnPath(configuration.checkout_app_return_path)??'/offers':'/offers');
  const body=await mutation(context,{resource:mode==='payment'?'checkout_payment_create':
    'checkout_subscription_create',fields:{priceId:offer.price_id,quantity:1,
    successUrl:`${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl:`${returnUrl}?checkout=cancel`,clientReferenceId:context.executionId}});
  const session=testCheckout(body,mode);
  if(session.status!=='open'||session.paymentStatus!=='unpaid'||!session.url
    ||supplier(body).client_reference_id!==context.executionId)throw new OperationError('unknown');
  const plans=[context.data.planGet('connector_config',{key:configKey(),required:true,
    where:{connection_id:configuration.connection_id,enabled:true,revision:configuration.revision}}),
  context.data.planGet('stripe_offer',{key:{id:offer.id},required:true,
    where:{connection_id:configuration.connection_id,enabled:true,revision:offer.revision,
      product_id:product.id,price_id:price.id}}),
  context.data.planGet('stripe_price',{key:{id:price.id},required:true,
    where:{connection_id:configuration.connection_id,active:true,livemode:false,
      product_id:product.id,unit_amount_minor:offer.unit_amount_minor,currency:offer.currency,
      type:price.type,billing_scheme:'per_unit',custom_amount:false,
      usage_type:price.usage_type??null,interval:offer.interval??null,
      interval_count:offer.interval_count??null}}),
  context.data.planGet('stripe_product',{key:{id:product.id},required:true,
    where:{connection_id:configuration.connection_id,active:true,livemode:false}}),
  context.data.planCreate('stripe_checkout',{values:{id:session.id,
    connection_id:configuration.connection_id,execution_id:context.executionId,
    price_id:price.id,quantity:1,mode,status:session.status,
    payment_status:session.paymentStatus,url:session.url,owner_principal_id:context.principalId,
    offer_id:offer.id,offer_revision:offer.revision,product_id:product.id,
    customer_id:null,subscription_id:null,livemode:false,revision:1,updated_at:now()}})];
  return {output:{offerId:offer.id,productId:product.id,session,subscriptionId:null},plans};
}
export async function appCheckoutRead(value:JsonValue,context:OperationContext){
  const id=identifier(args(value).sessionId),configuration=await config(context);
  const local=await context.data.get('stripe_checkout',{key:{id}}) as Row|null;
  if(!id.startsWith('cs_test_')||!local||local.connection_id!==configuration?.connection_id
    ||local.owner_principal_id!==context.principalId||typeof local.offer_id!=='string'
    ||typeof local.product_id!=='string'||!['payment','subscription'].includes(String(local.mode)))
    throw new OperationError('not_found');
  const body=await remote(context,{resource:'checkout_session',id});
  const session=testCheckout(body,local.mode as 'payment'|'subscription');
  if(session.id!==id)throw new OperationError('unavailable');
  const subscriptionId=linkedId(supplier(body).subscription,'sub_')
    ??linkedId(local.subscription_id,'sub_');
  return {output:{offerId:local.offer_id,productId:local.product_id,session,subscriptionId}};
}
async function checkoutCreate(value:JsonValue,context:OperationContext,mode:'payment'|'subscription'){
  const input=args(value),ready=await checkoutReady(context,input.priceId,mode,input.quantity,input.customerId);
  const returnUrl=String(ready.configuration.checkout_return_origin);
  const body=await mutation(context,{resource:mode==='payment'?'checkout_payment_create':
    'checkout_subscription_create',fields:{priceId:ready.id,quantity:ready.count,
    successUrl:`${returnUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl:`${returnUrl}/?checkout=cancel`,clientReferenceId:context.executionId,
    ...(ready.customer?{customerId:ready.customer}:{})}});
  const session=testCheckout(body,mode);
  if(session.status!=='open'||session.paymentStatus!=='unpaid'||!session.url
    ||supplier(body).client_reference_id!==context.executionId)throw new OperationError('unknown');
  const plan=context.data.planCreate('stripe_checkout',{values:{id:session.id,
    connection_id:ready.configuration.connection_id,execution_id:context.executionId,
    price_id:ready.id,quantity:ready.count,mode,status:session.status,
    payment_status:session.paymentStatus,url:session.url,livemode:false,
    revision:1,updated_at:now()}});
  return {output:{session},plans:[plan]};
}
export async function checkoutPaymentCreate(value:JsonValue,context:OperationContext){
  return checkoutCreate(value,context,'payment');
}
export async function checkoutSubscriptionCreate(value:JsonValue,context:OperationContext){
  return checkoutCreate(value,context,'subscription');
}
export async function checkoutRead(value:JsonValue,context:OperationContext){
  const id=identifier(args(value).sessionId),configuration=await config(context);
  const local=await context.data.get('stripe_checkout',{key:{id}}) as Row|null;
  if(!id.startsWith('cs_test_')||!local||local.connection_id!==configuration?.connection_id
    ||!['payment','subscription'].includes(String(local.mode)))throw new OperationError('not_found');
  const body=await remote(context,{resource:'checkout_session',id});
  const session=testCheckout(body,local.mode as 'payment'|'subscription');
  if(session.id!==id)throw new OperationError('unavailable');
  return {output:{session}};
}
async function subscriptionCancellation(value:JsonValue,context:OperationContext,
  cancelAtPeriodEnd:boolean,allowUnknownPrior=false){
  const input=args(value),id=identifier(input.subscriptionId),configuration=await config(context);
  const prior=await context.data.get('stripe_subscription',{key:{id}}) as Row|null;
  if(!id.startsWith('sub_')||!prior||prior.connection_id!==configuration?.connection_id
    ||prior.livemode!==false||!['active','trialing','past_due'].includes(String(prior.status)))
    throw new OperationError('invalid_input');
  const revision=rev(input.revision,prior);
  if(prior.cancel_at_period_end===cancelAtPeriodEnd
    ||(!allowUnknownPrior&&prior.cancel_at_period_end!==!cancelAtPeriodEnd))
    throw new OperationError('invalid_input');
  if(!cancelAtPeriodEnd&&typeof prior.period_end_at==='string'
    &&Date.parse(prior.period_end_at)<=Date.now())throw new OperationError('invalid_input');
  const body=supplier(await mutation(context,{resource:'subscription_schedule_cancel',id,
    fields:{cancelAtPeriodEnd}}));
  if(body.object!=='subscription'||body.id!==id||body.livemode!==false
    ||body.cancel_at_period_end!==cancelAtPeriodEnd||body.customer!==prior.customer_id
    ||(!cancelAtPeriodEnd&&!['active','trialing','past_due'].includes(String(body.status))))
    throw new OperationError('unknown');
  const plan=context.data.planPatch('stripe_subscription',{key:{id},
    compare:{field:'revision',expected:revision},
    values:{cancel_at_period_end:cancelAtPeriodEnd,updated_at:now()}});
  return {output:{subscriptionId:id,cancelAtPeriodEnd,livemode:false},plans:[plan]};
}
export async function subscriptionCancelSchedule(value:JsonValue,context:OperationContext){
  return subscriptionCancellation(value,context,true,true);
}
export async function subscriptionCancelSet(value:JsonValue,context:OperationContext){
  const cancelAtPeriodEnd=args(value).cancelAtPeriodEnd;
  if(typeof cancelAtPeriodEnd!=='boolean')throw new OperationError('invalid_input');
  return subscriptionCancellation(value,context,cancelAtPeriodEnd);
}
export async function eventReceive(value:JsonValue,context:OperationContext){
  const input=args(value),eventId=identifier(input.eventId),objectId=identifier(input.objectId),
    digest=input.bodyDigest,type=input.type,configuration=await config(context);
  if(!eventId.startsWith('evt_')||input.requestKey!==eventId||typeof digest!=='string'
    ||!/^[a-f0-9]{64}$/u.test(digest)||typeof type!=='string'||type.length>128
    ||input.livemode!==false||!configuration||configuration.enabled!==true
    ||typeof configuration.connection_id!=='string'||typeof configuration.webhook_key_ref!=='string')
    throw new OperationError('invalid_input');
  const existing=await context.data.get('stripe_event',{key:{id:eventId}}) as Row|null;
  if(existing){
    if(existing.body_digest!==digest)throw new OperationError('conflict');
    return {output:{eventId,recorded:true,checkoutUpdated:false}};
  }
  const plans=[context.data.planGet('connector_config',{key:configKey(),required:true,
    where:{connection_id:configuration.connection_id,enabled:true,
      revision:configuration.revision,webhook_key_ref:configuration.webhook_key_ref}})];
  plans.push(context.data.planCreate('stripe_event',{values:{id:eventId,
    connection_id:configuration.connection_id,type,object_id:objectId,
    body_digest:digest,livemode:false,revision:1,updated_at:now()}}));
  let checkoutUpdated=false;
  if(objectId.startsWith('cs_test_')&&input.sessionMode&&input.sessionStatus&&input.paymentStatus){
    const session=await context.data.get('stripe_checkout',{key:{id:objectId}}) as Row|null;
    const statusRank:Record<string,number>={open:0,expired:1,complete:2};
    const paymentRank:Record<string,number>={unpaid:0,no_payment_required:1,paid:2};
    if(session&&session.connection_id===configuration.connection_id
      &&session.mode===input.sessionMode&&session.livemode===false
      &&statusRank[String(input.sessionStatus)]!==undefined
      &&paymentRank[String(input.paymentStatus)]!==undefined
      &&statusRank[String(input.sessionStatus)]>=statusRank[String(session.status)]
      &&paymentRank[String(input.paymentStatus)]>=paymentRank[String(session.payment_status)]){
      const customerId=linkedId(input.customerId,'cus_'),subscriptionId=
        input.sessionMode==='subscription'?linkedId(input.subscriptionId,'sub_'):null;
      if(session.owner_principal_id&&((session.customer_id&&customerId&&session.customer_id!==customerId)
        ||(session.subscription_id&&subscriptionId&&session.subscription_id!==subscriptionId)))
        throw new OperationError('conflict');
      plans.push(context.data.planPatch('stripe_checkout',{key:{id:objectId},
        compare:{field:'revision',expected:Number(session.revision)},
        values:{status:String(input.sessionStatus),payment_status:String(input.paymentStatus),
          ...(session.owner_principal_id?{
            customer_id:customerId??session.customer_id??null,
            subscription_id:subscriptionId??session.subscription_id??null}:{}),
          updated_at:now()}}));
      checkoutUpdated=true;
    }
  }
  return {output:{eventId,recorded:true,checkoutUpdated},plans};
}

export async function configRead(_value:JsonValue,context:OperationContext){
  return {output:{config:configView(await config(context))}};
}
export async function configSet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(typeof input.enabled!=='boolean'||input.enabled&&typeof prior?.key_ref!=='string')
    throw new OperationError('invalid_input');
  const checkoutOrigin=input.checkoutReturnOrigin===undefined
    ?typeof prior?.checkout_return_origin==='string'?prior.checkout_return_origin:null
    :returnOrigin(input.checkoutReturnOrigin);
  const checkoutAppPath=input.checkoutAppReturnPath===undefined
    ?typeof prior?.checkout_app_return_path==='string'?prior.checkout_app_return_path:null
    :appReturnPath(input.checkoutAppReturnPath);
  const changes={origin:STRIPE_ORIGIN,enabled:input.enabled,
    checkout_return_origin:checkoutOrigin,checkout_app_return_path:checkoutAppPath,updated_at:now()};
  const plan=prior?context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes}):
    context.data.planCreate('connector_config',{values:{id:STRIPE_CONNECTOR_ID,...changes,
      key_ref:null,secret_version:null,connection_id:null,revision:1}});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},plans:[plan]};
}
export async function configKeySet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(!prior||!keySecret(input.apiKey))throw new OperationError('invalid_input');
  const vault=secrets(context),sealed=typeof prior.key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await vault.prepareReplace({providerId:STRIPE_CONNECTOR_ID,reference:prior.key_ref,
      expectedVersion:Number(prior.secret_version),secret:input.apiKey})
    :await vault.preparePut({providerId:STRIPE_CONNECTOR_ID,secret:input.apiKey});
  // A new credential invalidates every previous cursor and visible projection.
  const changes={key_ref:sealed.reference,secret_version:sealed.version,
    connection_id:crypto.randomUUID(),enabled:false,webhook_key_ref:null,
    webhook_secret_version:null,webhook_previous_key_ref:null,
    webhook_previous_secret_version:null,webhook_service_token_ref:null,
    webhook_service_token_version:null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},
    plans:[sealed.plan,...await revokeWebhookSecrets(context,prior),plan]};
}
export async function configKeyRevoke(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(!prior||typeof prior.key_ref!=='string'||!Number.isSafeInteger(prior.secret_version))
    throw new OperationError('invalid_input');
  const sealed=await secrets(context).prepareRevoke({providerId:STRIPE_CONNECTOR_ID,
    reference:prior.key_ref,expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,connection_id:null,enabled:false,
    webhook_key_ref:null,webhook_secret_version:null,
    webhook_previous_key_ref:null,webhook_previous_secret_version:null,
    webhook_service_token_ref:null,webhook_service_token_version:null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},
    plans:[sealed.plan,...await revokeWebhookSecrets(context,prior),plan]};
}
export async function configWebhookSet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(!prior||!keySecret(input.webhookSecret)||typeof input.webhookSecret!=='string'
    ||!/^whsec_[A-Za-z0-9_+\-/=]{16,512}$/u.test(input.webhookSecret)
    ||prior.enabled!==true||typeof prior.connection_id!=='string')
    throw new OperationError('invalid_input');
  const sealed=await secrets(context).preparePut({providerId:STRIPE_CONNECTOR_ID,
    secret:input.webhookSecret});
  const revoked=typeof prior.webhook_previous_key_ref==='string'
    &&Number.isSafeInteger(prior.webhook_previous_secret_version)
    ?[(await secrets(context).prepareRevoke({providerId:STRIPE_CONNECTOR_ID,
      reference:prior.webhook_previous_key_ref,
      expectedVersion:Number(prior.webhook_previous_secret_version)})).plan]:[];
  const changes={webhook_key_ref:sealed.reference,webhook_secret_version:sealed.version,
    webhook_previous_key_ref:typeof prior.webhook_key_ref==='string'?prior.webhook_key_ref:null,
    webhook_previous_secret_version:Number.isSafeInteger(prior.webhook_secret_version)
      ?Number(prior.webhook_secret_version):null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},
    plans:[sealed.plan,...revoked,plan]};
}
export async function configWebhookRevoke(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(!prior||typeof prior.webhook_key_ref!=='string')throw new OperationError('invalid_input');
  const changes={webhook_key_ref:null,webhook_secret_version:null,
    webhook_previous_key_ref:null,webhook_previous_secret_version:null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},
    plans:[...await Promise.all(webhookRefs(prior).filter(([reference])=>
      reference!==prior.webhook_service_token_ref).map(async([reference,expectedVersion])=>
      (await secrets(context).prepareRevoke({providerId:STRIPE_CONNECTOR_ID,
        reference,expectedVersion})).plan)),plan]};
}
export async function configWebhookServiceSet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(!prior||typeof input.serviceToken!=='string'
    ||!/^cz1a_[A-Za-z0-9_-]{43}$/u.test(input.serviceToken)
    ||prior.enabled!==true||typeof prior.connection_id!=='string')
    throw new OperationError('invalid_input');
  const sealed=await secrets(context).preparePut({providerId:STRIPE_CONNECTOR_ID,
    secret:input.serviceToken});
  const revoked=typeof prior.webhook_service_token_ref==='string'
    &&Number.isSafeInteger(prior.webhook_service_token_version)
    ?[(await secrets(context).prepareRevoke({providerId:STRIPE_CONNECTOR_ID,
      reference:prior.webhook_service_token_ref,
      expectedVersion:Number(prior.webhook_service_token_version)})).plan]:[];
  const changes={webhook_service_token_ref:sealed.reference,
    webhook_service_token_version:sealed.version,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},
    plans:[sealed.plan,...revoked,plan]};
}
export async function configWebhookServiceRevoke(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(!prior||typeof prior.webhook_service_token_ref!=='string'
    ||!Number.isSafeInteger(prior.webhook_service_token_version))throw new OperationError('invalid_input');
  const sealed=await secrets(context).prepareRevoke({providerId:STRIPE_CONNECTOR_ID,
    reference:prior.webhook_service_token_ref,
    expectedVersion:Number(prior.webhook_service_token_version)});
  const changes={webhook_service_token_ref:null,webhook_service_token_version:null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},
    plans:[sealed.plan,plan]};
}
export async function connectionCheck(_value:JsonValue,context:OperationContext){
  const body=await remote(context,{resource:'customers',limit:1});
  projectStripePage(body,'customers',1);
  return {output:{reachable:true}};
}
export async function syncState(_value:JsonValue,context:OperationContext){
  const [configuration,...rows]=await Promise.all([config(context),...collections.map(id=>run(context,id))]);
  const generation=connectionId(configuration);
  return {output:{states:collections.map((id,index)=>{
    const row=rows[index]??null;
    return runView(generation&&row?.connection_id===generation?row:
      row?{revision:row.revision}:null,id);
  })}};
}
export async function syncStart(value:JsonValue,context:OperationContext){
  const input=args(value),id=collection(input.collection),runId=identifier(input.runId);
  const prior=await run(context,id),revision=rev(input.revision,prior);
  const connection=await config(context);
  const generation=connectionId(connection);
  if(connection?.enabled!==true||typeof connection.key_ref!=='string'||!generation)
    throw new OperationError('unavailable');
  const changes={run_id:runId,connection_id:generation,cursor:null,status:'partial',updated_at:now()};
  const connectionGuard=context.data.planGet('connector_config',{key:configKey(),
    where:{connection_id:generation,enabled:true},required:true});
  const model=runModel(id);
  const plan=prior?context.data.planPatch(model,{key:{id},compare:{field:'revision',expected:revision},
    values:changes}):context.data.planCreate(model,{values:{id,...changes,revision:1}});
  return {output:{state:runView({...prior,...changes,revision:revision+1},id)},plans:[connectionGuard,plan]};
}
export async function syncPage(value:JsonValue,context:OperationContext){
  const input=args(value),id=collection(input.collection),runId=identifier(input.runId),
    expectedCursor=cursor(input.cursor),limit=input.limit,prior=await run(context,id),
    revision=rev(input.expectedRevision,prior);
  const generation=connectionId(await config(context));
  if(!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>8||!prior
    ||!generation||prior.connection_id!==generation||prior.run_id!==runId||
    prior.cursor!==expectedCursor||prior.status!=='partial')
    throw new OperationError('conflict');
  const body=await remote(context,{resource:id,cursor:expectedCursor??undefined,limit:Number(limit)});
  const page=projectStripePage(body,id,Number(limit));
  const model=projectionModel(id);
  const plans=[context.data.planGet('connector_config',{key:configKey(),
    where:{connection_id:generation,enabled:true},required:true})];
  for(const item of page.rows){
    const old=await context.data.get(model,{key:{id:item.id},fields:['id','revision']}) as Row|null;
    plans.push(old?context.data.planPatch(model,{key:{id:item.id},
      compare:{field:'revision',expected:Number(old.revision)},
      values:{...item.values,connection_id:generation,updated_at:now()}}):
      context.data.planCreate(model,{values:{id:item.id,...item.values,connection_id:generation,
        revision:1,updated_at:now()}}));
  }
  const changes={cursor:page.nextCursor,status:page.status,updated_at:now()};
  plans.push(context.data.planPatch(runModel(id),{key:{id},compare:{field:'revision',expected:revision},
    values:changes}));
  const state=runView({...prior,...changes,revision:revision+1},id);
  return {output:{state,processed:page.rows.length},plans};
}

const listInput=(value:JsonValue)=>{
  const input=args(value);
  if(!Number.isSafeInteger(input.limit)||Number(input.limit)<1||Number(input.limit)>25)
    throw new OperationError('invalid_input');
  return {limit:Number(input.limit),cursor:input.cursor===undefined?null:identifier(input.cursor)};
};
const localPage=async(context:OperationContext,model:string,value:JsonValue,fields:readonly string[],
  includeRevision=false)=>{
  const input=listInput(value),generation=connectionId(await config(context));
  if(!generation)return {output:{items:[],nextCursor:null}};
  const result=await context.data.list(model,{limit:input.limit,where:{connection_id:generation},
    ...(input.cursor?{after:{id:input.cursor}}:{}),fields});
  if(connectionId(await config(context))!==generation)throw new OperationError('conflict');
  const items=result.items.map(row=>({id:row.id,...Object.fromEntries(Object.entries(row)
    .filter(([name])=>name!=='id'&&(includeRevision||name!=='revision')).map(([name,val])=>[name,val]))}));
  const output={items,nextCursor:typeof result.nextAfter?.id==='string'?result.nextAfter.id:null};
  if(new TextEncoder().encode(JSON.stringify(output)).length>220_000)throw new OperationError('unavailable');
  return {output};
};
export async function customerList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_customer',value,['id','name','livemode','updated_at']);
}
export async function subscriptionList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_subscription',value,
    ['id','customer_id','status','currency','price_id','unit_amount_minor','interval',
      'interval_count','quantity','cancel_at_period_end','period_end_at','livemode','revision','updated_at'],true);
}
export async function invoiceList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_invoice',value,
    ['id','customer_id','status','currency','amount_due_minor','period_start_at','period_end_at',
      'livemode','updated_at']);
}
export async function productList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_product',value,
    ['id','name','active','default_price_id','livemode','updated_at']);
}
export async function priceList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_price',value,
    ['id','product_id','active','livemode','currency','type','billing_scheme','unit_amount_minor',
      'unit_amount_decimal','interval','interval_count','usage_type','tiers_mode','custom_amount','updated_at']);
}
export async function eventList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_event',value,
    ['id','type','object_id','body_digest','livemode','updated_at']);
}
