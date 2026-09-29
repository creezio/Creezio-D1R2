import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import type {PendingCommand} from '@creezio/sdk/operations/command-journal';

export type Folder = 'inbox'|'sent'|'drafts'|'outbox'|'archive'|'trash';
export const folders: readonly {id:Folder;label:string}[] = [
  {id:'inbox',label:'Boîte de réception'}, {id:'sent',label:'Envoyés'},
  {id:'drafts',label:'Brouillons'}, {id:'outbox',label:"File d’attente"},
  {id:'archive',label:'Archives'}, {id:'trash',label:'Corbeille'},
];
export type Box = {id:string;name:string;address:string;kind:string;revision:number};
export type Message = {id:string;boxId:string;direction:string;from:string;to:string;cc:string;
  subject:string;text:string;html:string;state:string;folder:Folder;read:boolean;threadId:string|null;
  replyTo:string|null;inReplyTo:string|null;receivedAt:string|null;sentAt:string|null;revision:number};
export type Draft = {id:string;boxId:string;to:string;cc:string;bcc:string;
  subject:string;text:string;html:string;updatedAt:string;revision:number};
export type Attachment = {fileId:string;filename:string;contentType:string;byteSize:number;
  reference:{fileId:string;intentId:string;generation:string;digest:string}};
export type Page<T> = {items:T[];nextCursor:string|null};
export type Outcome<T> = {kind:'ok';value:T}|{kind:'rejected'|'unknown';code:string};
export type MessagingScope = Pick<WorkspaceViewProps,'client'|'access'|'audience'|'contextId'>;
export type UiIdentity = MessagingScope & {sessionId:string;phase?:'loading'|'anonymous'|'authenticated'|'unavailable'};
/** Only the newest read of a list or selection may publish its result. */
export function createLatestRequest(){
  let serial=0;
  return {begin:()=>++serial,capture:()=>serial,invalidate:()=>{serial++;},
    accepts:(candidate:number)=>candidate===serial};
}
export function scopeChanged(previous:UiIdentity|null,current:UiIdentity):boolean {
  return previous!==null&&(previous.contextId!==current.contextId||previous.audience!==current.audience||
    !!previous.sessionId&&(current.sessionId?previous.sessionId!==current.sessionId:
      current.phase==='anonymous'));
}
export function messagingPanelData(scope:{sessionId:string;audience:string;contextId:string},
  boxId:string,draftId:string|null,pending:PendingCommand|null):Record<string,unknown>{
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    ...(boxId?{boxId}:{}),...(draftId?{draftId}:{}),...(pending?{pending}:{})};
}
export function panelMatchesScope(data:Readonly<Record<string,unknown>>|undefined,
  scope:{sessionId:string;audience:string;contextId:string}):boolean{
  return !!data&&!!scope.sessionId&&data.sessionId===scope.sessionId&&
    data.audience===scope.audience&&data.contextId===scope.contextId;
}

export async function call<T>(scope:MessagingScope, operation:string,
  input:Record<string,unknown>,current:()=>boolean):Promise<Outcome<T>> {
  const result=await scope.client.invoke({bindingId:`creezio.messaging:${scope.audience}.${operation}`,
    contextId:scope.contextId,input,isCurrent:current});
  if(result.kind==='rejected'||result.kind==='unknown')return {kind:result.kind,code:result.code};
  if(result.execution.state!=='succeeded')return {kind:'rejected',code:result.execution.errorCode??'unavailable'};
  return {kind:'ok',value:result.execution.output as T};
}
export function readableError(code:string):string {
  if(code==='forbidden'||code==='unauthorized')return 'Accès à cette boîte refusé. Actualisez votre session.';
  if(code==='stale'||code==='conflict')return 'Cet élément a changé. Actualisez-le avant de poursuivre.';
  if(code==='unavailable'||code==='capability_unavailable')return 'Envoi et réception indisponibles sans transport de messagerie.';
  if(code==='outcome_unknown'||code==='unknown')return 'Résultat incertain. Vérifiez l’état avant une nouvelle action.';
  if(code==='in_progress')return 'Résultat incertain. Vérifiez la dernière modification ; aucune nouvelle commande n’a été envoyée.';
  if(code==='client_state_unavailable')return 'État du panneau indisponible. Aucune modification envoyée.';
  return 'Cette opération a échoué. Actualisez avant de réessayer.';
}
export function dateLabel(value:string|null|undefined):string {
  if(!value)return '';const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
  return date.toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'});
}
export function previewText(value:string):string {return value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
