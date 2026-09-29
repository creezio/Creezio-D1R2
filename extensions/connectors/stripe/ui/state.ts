export type Collection='customers'|'subscriptions'|'invoices';
export type Run={collection:Collection;runId:string|null;cursor:string|null;
  status:'partial'|'pages_exhausted';revision:number;updatedAt:string|null};
export type Config={origin:string;enabled:boolean;hasKey:boolean;revision:number;state:string};

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
    first.enabled===verified.enabled;
}
export function reconcileRuns(previous:readonly Run[],candidates:readonly Run[],configChanged:boolean):Run[]{
  return mergeRuns(configChanged?[]:previous,candidates);
}
