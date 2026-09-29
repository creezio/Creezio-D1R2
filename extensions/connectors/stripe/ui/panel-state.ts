import type {PendingCommand} from '@creezio/sdk/operations/command-journal';

type AccessSnapshot={readonly phase:'loading'|'anonymous'|'authenticated'|'unavailable';
  readonly pending:null|'login'|'logout';readonly session:{readonly id:string}|null};
export type StripeTab='overview'|'customers'|'subscriptions'|'invoices'|'settings';
export type StripeScope={sessionId:string;audience:'admin'|'app';contextId:string;panelId:string};
export type StripePanel={sessionId:string;audience:'admin';contextId:string;tab:StripeTab;
  pending?:PendingCommand};
const tab=(value:unknown):value is StripeTab=>
  ['overview','customers','subscriptions','invoices','settings'].includes(String(value));
export function retainedSessionId(previous:string,access:AccessSnapshot):string{
  if(access.phase==='anonymous')return '';
  if(access.phase==='authenticated'&&!access.pending)return access.session?.id??'';
  return previous;
}
export function sessionVerified(access:AccessSnapshot,sessionId:string):boolean{
  return !!sessionId&&access.phase==='authenticated'&&!access.pending&&access.session?.id===sessionId;
}
export function scopeChange(previous:StripeScope,next:StripeScope,phase:string):{purge:boolean;transient:boolean}{
  const transient=!next.sessionId&&(phase==='loading'||phase==='unavailable');
  return {purge:previous.audience!==next.audience||previous.contextId!==next.contextId||
    previous.panelId!==next.panelId||!!previous.sessionId&&!!next.sessionId&&previous.sessionId!==next.sessionId||
    phase==='anonymous',transient};
}
export function readPanel(value:unknown,scope:StripeScope):StripePanel|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;
  if(row.sessionId!==scope.sessionId||row.audience!=='admin'||scope.audience!=='admin'||
    row.contextId!==scope.contextId||!tab(row.tab))return null;
  return {sessionId:scope.sessionId,audience:'admin',contextId:scope.contextId,tab:row.tab,
    ...(row.pending?{pending:row.pending as PendingCommand}:{})};
}
export function panelData(scope:StripeScope,tab:StripeTab,pending:PendingCommand|null):StripePanel{
  if(scope.audience!=='admin')throw new TypeError('Stripe billing is admin only.');
  return {sessionId:scope.sessionId,audience:'admin',contextId:scope.contextId,tab,
    ...(pending?{pending}:{})};
}
