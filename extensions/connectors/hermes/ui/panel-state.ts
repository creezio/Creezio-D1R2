import {readPendingCommand,type PendingCommand} from '@creezio/sdk/operations/command-journal';

export type HermesScope={sessionId:string;audience:string;contextId:string;panelId:string};
type Access={phase:string;pending:null|'login'|'logout';session:{id:string}|null};
export const retainedSessionId=(previous:string,access:Access)=>access.phase==='anonymous'?'':
  access.phase==='authenticated'&&!access.pending?(access.session?.id??''):previous;
export const sessionVerified=(access:Access,sessionId:string)=>!access.pending&&access.phase==='authenticated'
  &&!!sessionId&&access.session?.id===sessionId;
export function scopeChange(before:HermesScope,after:HermesScope,phase:string){
  const transient=phase==='loading';
  return {transient,purge:!transient&&(before.sessionId!==after.sessionId||before.audience!==after.audience
    ||before.contextId!==after.contextId||before.panelId!==after.panelId)};
}
const localId=(value:unknown):value is string=>typeof value==='string'&&value.length<=128
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
export function hermesPanelData(scope:HermesScope,selectedRunId:string|null,pending:PendingCommand|null){
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,tab:'runs' as const,
    selectedRunId:selectedRunId&&localId(selectedRunId)?selectedRunId:null,...(pending?{pending}:{})};
}
export function readHermesPanel(value:unknown,scope:HermesScope){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;
  if(row.sessionId!==scope.sessionId||row.audience!==scope.audience||row.contextId!==scope.contextId
    ||!['settings','runs'].includes(String(row.tab))
    ||!(row.selectedRunId===null||localId(row.selectedRunId)))return null;
  const pending=readPendingCommand(row.pending,{sessionId:scope.sessionId,
    audience:scope.audience as 'admin'|'app',contextId:scope.contextId});
  const operations=scope.audience==='admin'
    ?['config.set','config.key.set','config.key.revoke','capabilities.capture','run.prepare','run.submit',
      'run.refresh','run.stop']
    :['run.prepare','run.submit','run.refresh','run.stop'];
  const ownPending=pending&&operations.includes(pending.intent??'')
    &&pending.bindingId===`creezio.hermes:${scope.audience}.${pending.intent}`?pending:null;
  return {selectedRunId:row.selectedRunId as string|null,pending:ownPending};
}
