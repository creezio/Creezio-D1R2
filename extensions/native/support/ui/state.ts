import type {PendingCommand} from '@creezio/sdk/operations/command-journal';

export type SupportScope={sessionId:string;client:unknown;access:unknown;audience:string;contextId:string};

/** An unresolved refresh hides the view but does not establish a new identity. */
export function supportScopeForAccess<T extends SupportScope>(previous:SupportScope,current:T,
  phase:'loading'|'unavailable'|'anonymous'|'authenticated'):T {
  return (phase==='loading'||phase==='unavailable')&&!current.sessionId&&
    previous.audience===current.audience&&previous.contextId===current.contextId
    ?{...current,sessionId:previous.sessionId}:current;
}

/** First authentication may restore a panel; an established identity may not carry state into another scope. */
export function requiresSupportReset(previous:SupportScope,current:SupportScope):boolean {
  return previous.audience!==current.audience||previous.contextId!==current.contextId||
    !!previous.sessionId&&previous.sessionId!==current.sessionId;
}

export function supportPanelBelongsToScope(data:unknown,scope:Pick<SupportScope,'sessionId'|'audience'|'contextId'>):boolean {
  if(!scope.sessionId||!data||typeof data!=='object'||Array.isArray(data))return false;
  const saved=data as Record<string,unknown>;
  return saved.sessionId===scope.sessionId&&saved.audience===scope.audience&&
    saved.contextId===scope.contextId;
}

/** Selection and outstanding command metadata must be saved as one panel state. */
export function supportPanelData(scope:Pick<SupportScope,'sessionId'|'audience'|'contextId'>,
  ticketId:string|null,pending:PendingCommand|null):Record<string,unknown>{
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    ...(ticketId?{ticketId}:{}),...(pending?{pending}:{})};
}

export function putReply(previous:ReadonlyMap<string,string>,ticketId:string,text:string):ReadonlyMap<string,string> {
  const next=new Map(previous);
  if(text)next.set(ticketId,text);else next.delete(ticketId);
  return next;
}

/** A completed send cannot erase text typed while that same request was pending. */
export function clearSubmittedReply(previous:ReadonlyMap<string,string>,ticketId:string,
  submittedVersion:number,currentVersion:number):ReadonlyMap<string,string> {
  return submittedVersion===currentVersion?putReply(previous,ticketId,''):previous;
}
