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
