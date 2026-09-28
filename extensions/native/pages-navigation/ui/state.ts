export type PageScope={sessionId:string;client:unknown;access:unknown;audience:string;contextId:string;
  phase?:'loading'|'anonymous'|'authenticated'|'unavailable'};

/** Panel selection is local UI state, but still belongs to a verified identity. */
export function panelBelongsToScope(data:unknown,scope:Pick<PageScope,'sessionId'|'audience'|'contextId'>):boolean {
  if(!scope.sessionId||!data||typeof data!=='object'||Array.isArray(data))return false;
  const saved=data as Record<string,unknown>;
  return saved.sessionId===scope.sessionId&&saved.audience===scope.audience&&
    saved.contextId===scope.contextId;
}

/** Inactive panels keep local drafts; an established identity never lends them to another scope. */
export function requiresPageReset(previous:PageScope,current:PageScope):boolean {
  return previous.audience!==current.audience||previous.contextId!==current.contextId||
    !!previous.sessionId&&(current.sessionId?previous.sessionId!==current.sessionId:
      current.phase!=='loading'&&current.phase!=='unavailable');
}

/** A temporary access refresh must not forget the established identity it is refreshing. */
export function pageScopeAfter<T extends PageScope>(previous:T,current:T & PageScope):T {
  return !current.sessionId&&(current.phase==='loading'||current.phase==='unavailable')&&
    previous.audience===current.audience&&previous.contextId===current.contextId?previous:current;
}

export function samePageSelection(pageId:string,selectedId:string,expectedSerial:number,currentSerial:number):boolean {
  return pageId===selectedId&&expectedSerial===currentSerial;
}

/** A later read or mutation invalidates an earlier response for the same selection. */
export function createReadGeneration(){
  let value=0;
  return {begin:()=>++value,invalidate:()=>{value++;},accepts:(token:number)=>token===value};
}

/** Keep malformed structured content local; never silently save the previous parsed value. */
export function parseContentInput(raw:string):{valid:true;value:unknown}|{valid:false} {
  try{return {valid:true,value:JSON.parse(raw) as unknown};}
  catch{return {valid:false};}
}
