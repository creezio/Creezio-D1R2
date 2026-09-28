import type {OperationClient,OperationClientResult} from '@creezio/sdk/operations/client';
import type {CrmEntity} from './editing.ts';

type Scope={audience:'admin'|'app';contextId:string;sessionId:string};
export type PendingCrmCommand=Scope&{entity:CrmEntity;action:'create'|'update'|'archive'|'restore';requestKey:string};
const actions=['create','update','archive','restore'];
export function readPendingCommand(value:unknown,expected:Scope):PendingCrmCommand|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;
  if(!['company','contact','prospect'].includes(String(row.entity))||!actions.includes(String(row.action))
    ||typeof row.requestKey!=='string'||!/^[-a-zA-Z0-9]{1,128}$/.test(row.requestKey)
    ||!expected.sessionId||row.sessionId!==expected.sessionId||row.contextId!==expected.contextId||row.audience!==expected.audience)return null;
  return {...expected,entity:row.entity as CrmEntity,action:row.action as PendingCrmCommand['action'],requestKey:row.requestKey};
}
/** Retain uncertain intent. Inspect is read-only; it never repeats the mutation. */
export function createCommandJournal(initial:PendingCrmCommand|null=null){
  let pending=initial;
  const finish=(result:OperationClientResult,invocation=false)=>{
    if(invocation&&result.kind==='rejected'||result.kind==='execution'&&['succeeded','failed'].includes(result.execution.state))pending=null;
    return result;
  };
  return {
    get pending(){return pending;},
    async execute(client:OperationClient,scope:{audience:'admin'|'app';contextId:string},
      command:PendingCrmCommand,input:Record<string,unknown>,isCurrent:()=>boolean,onCaptured:()=>boolean){
      if(pending)return {kind:'unknown',code:'in_progress'} as const;
      pending=command;
      if(!onCaptured()){pending=null;return {kind:'rejected',code:'client_state_unavailable',status:0} as const;}
      try{return finish(await client.invoke({bindingId:`creezio.crm:${scope.audience}.${command.entity}.${command.action}`,
        contextId:scope.contextId,input:{...input,requestKey:command.requestKey},isCurrent}),true);}
      catch{return {kind:'unknown',code:'outcome_unknown'} as const;}
    },
    async inspect(client:OperationClient,scope:{audience:'admin'|'app';contextId:string},isCurrent:()=>boolean){
      if(!pending)return null;
      try{return finish(await client.status({bindingId:`creezio.crm:${scope.audience}.${pending.entity}.${pending.action}`,
        contextId:scope.contextId,requestKey:pending.requestKey,isCurrent}));}
      catch{return {kind:'unknown',code:'unavailable'} as const;}
    }
  };
}
