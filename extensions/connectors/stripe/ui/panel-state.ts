import type {PendingCommand} from '@creezio/sdk/operations/command-journal';

type AccessSnapshot={readonly phase:'loading'|'anonymous'|'authenticated'|'unavailable';
  readonly pending:null|'login'|'logout';readonly session:{readonly id:string}|null};
export type StripeTab='overview'|'customers'|'subscriptions'|'invoices'|'products'|'prices'|'offers'|'checkout'|'settings';
export type StripeScope={sessionId:string;audience:'admin'|'app';contextId:string;panelId:string};
export type StripePanel={sessionId:string;audience:'admin';contextId:string;tab:StripeTab;
  pending?:PendingCommand};
const tab=(value:unknown):value is StripeTab=>
  ['overview','customers','subscriptions','invoices','products','prices','offers','checkout','settings'].includes(String(value));
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
export type StripeAppPanel={sessionId:string;audience:'app';contextId:string;
  pending?:PendingCommand;checkoutSessionId?:string};
const checkoutId=(value:unknown):value is string=>typeof value==='string'&&
  /^cs_test_[A-Za-z0-9_]{1,120}$/u.test(value);
export function readAppPanel(value:unknown,scope:StripeScope):StripeAppPanel|null{
  if(!value||typeof value!=='object'||Array.isArray(value)||scope.audience!=='app')return null;
  const row=value as Record<string,unknown>;
  if(row.sessionId!==scope.sessionId||row.audience!=='app'||row.contextId!==scope.contextId)return null;
  return {sessionId:scope.sessionId,audience:'app',contextId:scope.contextId,
    ...(row.pending?{pending:row.pending as PendingCommand}:{}),
    ...(checkoutId(row.checkoutSessionId)?{checkoutSessionId:row.checkoutSessionId}:{})};
}
export function appPanelData(scope:StripeScope,pending:PendingCommand|null,
  checkoutSessionId:string|null):StripeAppPanel{
  if(scope.audience!=='app')throw new TypeError('Stripe offers are app only.');
  return {sessionId:scope.sessionId,audience:'app',contextId:scope.contextId,
    ...(pending?{pending}:{}),...(checkoutId(checkoutSessionId)?{checkoutSessionId}:{})};
}
