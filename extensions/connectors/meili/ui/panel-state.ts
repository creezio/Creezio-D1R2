import type {PendingCommand} from '@creezio/sdk/operations/command-journal';

export type IndexPage={items:{uid:string;primaryKey:string|null;createdAt:string;updatedAt:string}[];
  total:number;nextCursor:string|null};
/** Accept a page only as a bounded diagnostic, never as an arbitrary provider response. */
export function indexPageFrom(value:unknown):IndexPage|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const page=value as Record<string,unknown>;
  if(!Array.isArray(page.items)||page.items.length>20||!Number.isSafeInteger(page.total)
    ||Number(page.total)<0||!(page.nextCursor===null||typeof page.nextCursor==='string'
      &&/^(0|[1-9][0-9]{0,5})$/u.test(page.nextCursor)))return null;
  const items=[];
  for(const raw of page.items){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const item=raw as Record<string,unknown>;
    if(typeof item.uid!=='string'||item.uid.length<1||item.uid.length>400
      ||!(item.primaryKey===null||typeof item.primaryKey==='string')
      ||typeof item.createdAt!=='string'||typeof item.updatedAt!=='string')return null;
    items.push({uid:item.uid,primaryKey:item.primaryKey,createdAt:item.createdAt,
      updatedAt:item.updatedAt});
  }
  return {items,total:Number(page.total),nextCursor:page.nextCursor as string|null};
}

type Access={readonly phase:'loading'|'anonymous'|'authenticated'|'unavailable';
  readonly pending:null|'login'|'logout';readonly session:{readonly id:string}|null};
export type MeiliScope={sessionId:string;audience:'admin'|'app';contextId:string;panelId:string};
export type MeiliPanel={sessionId:string;audience:'admin'|'app';contextId:string;
  pending?:PendingCommand};
export function retainedSessionId(previous:string,access:Access):string{
  if(access.phase==='anonymous')return '';
  if(access.phase==='authenticated'&&!access.pending)return access.session?.id??'';
  return previous;
}
export function sessionVerified(access:Access,sessionId:string):boolean{
  return !!sessionId&&access.phase==='authenticated'&&!access.pending&&access.session?.id===sessionId;
}
export function scopeChange(previous:MeiliScope,next:MeiliScope,phase:string){
  const transient=!next.sessionId&&(phase==='loading'||phase==='unavailable');
  const changed=previous.audience!==next.audience||previous.contextId!==next.contextId||
    previous.panelId!==next.panelId||!!previous.sessionId&&!!next.sessionId&&previous.sessionId!==next.sessionId;
  return {purge:changed||phase==='anonymous',transient};
}
export function readPanel(value:unknown,scope:MeiliScope):MeiliPanel|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;
  if(row.sessionId!==scope.sessionId||row.audience!==scope.audience||
    row.contextId!==scope.contextId)return null;
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    ...(row.pending?{pending:row.pending as PendingCommand}:{})};
}
export function panelData(scope:MeiliScope,pending:PendingCommand|null):MeiliPanel{
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    ...(pending?{pending}:{})};
}
/** A status reply can complete after a fresher configuration read. */
export function preferFreshConfig<T extends {revision:number}>(current:T|null,next:T):T{
  return current&&current.revision>next.revision?current:next;
}
export function configRevisionChanged(current:{revision:number}|null,next:{revision:number}):boolean{
  return current?.revision!==next.revision;
}

/** Index reads follow the accepted configuration read; stale reads start no follow-up. */
export async function readConfigThenIndex<T>(readConfig:()=>Promise<T|null>,
  readIndex:(accepted:T)=>Promise<void>,isCurrent:()=>boolean):Promise<void>{
  const accepted=await readConfig();
  if(accepted!==null&&isCurrent())await readIndex(accepted);
}
