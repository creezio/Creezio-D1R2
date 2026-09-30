import type {PendingCommand} from '@creezio/sdk/operations/command-journal';

type AccessSnapshot={readonly phase:'loading'|'anonymous'|'authenticated'|'unavailable';
  readonly pending:null|'login'|'logout';readonly session:{readonly id:string}|null};

export type N8nTab='settings'|'workflows'|'executions';
export type N8nScope={sessionId:string;audience:'admin'|'app';contextId:string;panelId:string};
export type N8nPanel={sessionId:string;audience:'admin'|'app';contextId:string;tab:N8nTab;
  workflowCursor?:string;executionCursor?:string;pending?:PendingCommand};
export type N8nConfigStamp={revision:number;origin:string|null;enabled:boolean;hasKey:boolean};
const tab=(value:unknown):value is N8nTab=>value==='settings'||value==='workflows'||value==='executions';
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max;

export function preferFreshConfig<T extends N8nConfigStamp>(current:T|null,next:T):T{
  return current&&current.revision>next.revision?current:next;
}
export function providerChanged(current:N8nConfigStamp|null,next:N8nConfigStamp):boolean{
  return !!current&&(current.revision!==next.revision||current.origin!==next.origin
    ||current.enabled!==next.enabled||current.hasKey!==next.hasKey);
}

export function retainedSessionId(previous:string,access:AccessSnapshot):string{
  if(access.phase==='anonymous')return '';
  if(access.phase==='authenticated'&&!access.pending)return access.session?.id??'';
  return previous;
}
export function sessionVerified(access:AccessSnapshot,sessionId:string):boolean{
  return !!sessionId&&access.phase==='authenticated'&&!access.pending&&access.session?.id===sessionId;
}
export function scopeChange(previous:N8nScope,next:N8nScope,phase:string):{purge:boolean;transient:boolean}{
  const transient=!next.sessionId&&(phase==='loading'||phase==='unavailable');
  const changed=previous.audience!==next.audience||previous.contextId!==next.contextId||
    previous.panelId!==next.panelId||!!previous.sessionId&&!!next.sessionId&&previous.sessionId!==next.sessionId;
  return {purge:changed||phase==='anonymous',transient};
}
export function readPanel(value:unknown,scope:N8nScope):N8nPanel|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;
  if(row.sessionId!==scope.sessionId||row.audience!==scope.audience||row.contextId!==scope.contextId||!tab(row.tab)
    ||row.workflowCursor!==undefined&&!text(row.workflowCursor,2048)
    ||row.executionCursor!==undefined&&!text(row.executionCursor,2048))return null;
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,tab:row.tab,
    ...(row.workflowCursor?{workflowCursor:row.workflowCursor as string}:{}),
    ...(row.executionCursor?{executionCursor:row.executionCursor as string}:{}),
    ...(row.pending?{pending:row.pending as PendingCommand}:{})};
}
export function panelData(scope:N8nScope,tab:N8nTab,workflowCursor:string|null,executionCursor:string|null,
  pending:PendingCommand|null):N8nPanel{
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,tab,
    ...(workflowCursor?{workflowCursor}:{}),...(executionCursor?{executionCursor}:{}),
    ...(pending?{pending}:{})};
}
