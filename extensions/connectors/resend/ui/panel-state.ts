import type {PendingCommand} from '@creezio/sdk/operations/command-journal';

type AccessSnapshot={readonly phase:'loading'|'anonymous'|'authenticated'|'unavailable';
  readonly pending:null|'login'|'logout';readonly session:{readonly id:string}|null};
export type ResendScope={sessionId:string;audience:'admin'|'app';contextId:string;panelId:string};
export type ResendPanel={sessionId:string;audience:'admin'|'app';contextId:string;pending?:PendingCommand};

export function retainedSessionId(previous:string,access:AccessSnapshot):string{
  if(access.phase==='anonymous')return '';
  if(access.phase==='authenticated'&&!access.pending)return access.session?.id??'';
  return previous;
}
export function sessionVerified(access:AccessSnapshot,sessionId:string):boolean{
  return !!sessionId&&access.phase==='authenticated'&&!access.pending&&access.session?.id===sessionId;
}
export function scopeChange(previous:ResendScope,next:ResendScope,phase:string):{purge:boolean;transient:boolean}{
  const transient=!next.sessionId&&(phase==='loading'||phase==='unavailable');
  const changed=previous.audience!==next.audience||previous.contextId!==next.contextId||
    previous.panelId!==next.panelId||!!previous.sessionId&&!!next.sessionId&&previous.sessionId!==next.sessionId;
  return {purge:changed||phase==='anonymous',transient};
}
export function readPanel(value:unknown,scope:ResendScope):ResendPanel|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;
  if(row.sessionId!==scope.sessionId||row.audience!==scope.audience||row.contextId!==scope.contextId)return null;
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    ...(row.pending?{pending:row.pending as PendingCommand}:{})};
}
export function panelData(scope:ResendScope,pending:PendingCommand|null):ResendPanel{
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    ...(pending?{pending}:{})};
}
