export type Collection='customers'|'subscriptions'|'invoices'|'products'|'prices_active'|'prices_inactive';
export type Run={collection:Collection;runId:string|null;cursor:string|null;
  status:'partial'|'pages_exhausted';revision:number;updatedAt:string|null};
export type Config={origin:string;enabled:boolean;hasKey:boolean;hasWebhookSecret:boolean;
  hasWebhookService:boolean;
  checkoutReturnOrigin:string|null;checkoutAppReturnPath:string;
  revision:number;state:string};

type OfferPriceCandidate={active:boolean;livemode:boolean;billing_scheme:string;custom_amount:boolean;
  usage_type:string|null;unit_amount_minor:number|null;product_id:string};
type OfferProductCandidate={id:string;active:boolean;livemode:boolean};
/** The server rechecks one projection generation; this only narrows the admin picker. */
export function offerPriceEligible(price:OfferPriceCandidate,products:readonly OfferProductCandidate[]):boolean{
  return price.active&&!price.livemode&&price.billing_scheme==='per_unit'&&!price.custom_amount&&
    price.usage_type!=='metered'&&price.unit_amount_minor!==null&&
    Number.isSafeInteger(price.unit_amount_minor)&&price.unit_amount_minor>0&&
    products.some(product=>product.id===price.product_id&&product.active&&!product.livemode);
}

type SubscriptionLifecycle={id:string;status:string;livemode:boolean;
  cancel_at_period_end:boolean|null;revision:number};
export function subscriptionLifecycleAction(subscription:SubscriptionLifecycle){
  if(subscription.livemode||!['active','trialing','past_due'].includes(subscription.status)||
    typeof subscription.cancel_at_period_end!=='boolean'||!subscription.id||
    !Number.isSafeInteger(subscription.revision)||subscription.revision<1)return null;
  const cancelAtPeriodEnd=!subscription.cancel_at_period_end;
  return {operation:'subscription.cancel.set',
    input:{subscriptionId:subscription.id,revision:subscription.revision,cancelAtPeriodEnd},
    label:cancelAtPeriodEnd?'Arrêter à l’échéance':'Maintenir l’abonnement',
    confirmation:cancelAtPeriodEnd
      ?`Programmer l’arrêt de l’abonnement ${subscription.id} à la fin de la période ?`
      :`Retirer l’arrêt programmé de l’abonnement ${subscription.id} et maintenir son renouvellement ?`};
}
type PlanSubscription={id:string;status:string;livemode:boolean;cancel_at_period_end:boolean|null;
  item_id:string|null;price_id:string|null;currency:string|null;interval:string|null;
  interval_count:number|null;quantity:number|null;unit_amount_minor:number|null;revision:number};
type PlanPrice={id:string;active:boolean;livemode:boolean;type:string;billing_scheme:string;
  custom_amount:boolean;usage_type:string|null;unit_amount_minor:number|null;currency:string;
  interval:string|null;interval_count:number|null};
export function subscriptionPlanPrices(subscription:PlanSubscription,prices:readonly PlanPrice[]):PlanPrice[]{
  if(subscription.livemode||subscription.status!=='active'||subscription.cancel_at_period_end!==false
    ||!subscription.item_id?.startsWith('si_')||!subscription.price_id?.startsWith('price_')
    ||!subscription.currency||!subscription.interval||!Number.isSafeInteger(subscription.interval_count)
    ||!Number.isSafeInteger(subscription.quantity)||!Number.isSafeInteger(subscription.revision)
    ||!Number.isSafeInteger(subscription.unit_amount_minor)||Number(subscription.unit_amount_minor)<1
    ||subscription.revision<1)return [];
  return prices.filter(price=>price.active&&!price.livemode&&price.type==='recurring'
    &&price.billing_scheme==='per_unit'&&!price.custom_amount&&price.usage_type==='licensed'
    &&Number.isSafeInteger(price.unit_amount_minor)&&Number(price.unit_amount_minor)>0
    &&price.currency===subscription.currency&&price.interval===subscription.interval
    &&price.interval_count===subscription.interval_count);
}
export function mergeProjectedPage<T extends {id:string}>(previous:readonly T[],incoming:readonly T[],
  append:boolean):T[]{
  if(!append)return [...incoming];
  const seen=new Set(previous.map(row=>row.id));
  return [...previous,...incoming.filter(row=>!seen.has(row.id))];
}

/** A late read cannot roll a confirmed command back to an older revision. */
export function latestConfig(previous:Config|null,candidate:Config):Config{
  return previous&&previous.revision>candidate.revision?previous:candidate;
}
export function mergeRuns(previous:readonly Run[],candidates:readonly Run[]):Run[]{
  const byCollection=new Map<Collection,Run>(previous.map(row=>[row.collection,row]));
  for(const row of candidates){
    const old=byCollection.get(row.collection);
    if(!old||row.revision>=old.revision)byCollection.set(row.collection,row);
  }
  return [...byCollection.values()];
}
export function externalConfigurationChanged(knownRevision:number,next:Config):boolean{
  return knownRevision>0&&next.revision>knownRevision;
}
export function sameConfiguration(first:Config,verified:Config):boolean{
  return first.revision===verified.revision&&first.hasKey===verified.hasKey&&
    first.enabled===verified.enabled&&first.checkoutReturnOrigin===verified.checkoutReturnOrigin&&
    first.checkoutAppReturnPath===verified.checkoutAppReturnPath;
}
export function reconcileRuns(previous:readonly Run[],candidates:readonly Run[],configChanged:boolean):Run[]{
  return mergeRuns(configChanged?[]:previous,candidates);
}
