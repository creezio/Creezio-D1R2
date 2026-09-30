import type {IdentityDatabase} from '../identity/d1-store.ts';
import {ACCESS_TABLES} from '../identity/d1-store.ts';
import type {NativeStorageRevocation} from '../operations/native-access.ts';
import type {StorageMutationPort,StorageMutationOutcome} from './native-mutation.ts';

export interface NativeStorageOperationRequest<T> {
  readonly descriptor:NativeStorageRevocation;
  readonly executionId:string;
  /** The existing operation store commit, including its native effects and execution receipt in one D1 batch. */
  readonly sourceCommit:()=>Promise<T>;
  /** Reads that same execution, never starts another. */
  readonly readExecution:()=>Promise<T|null>;
  readonly succeeded:(value:T)=>boolean;
}
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type Kind=NativeStorageRevocation['kind'];
const actions:Readonly<Record<Kind,string>>=Object.freeze({
  'policy.apply-delta':'authorization-updated',
  'principals.set-human-status':'human-status-updated',
  'principals.revoke-sessions':'human-sessions-revoked',
  'sessions.revoke':'human-session-revoked',
  'service.create':'service-created',
  'service.status':'service-status-updated',
  'service.token.issue':'api-token-issued',
  'service.token.revoke':'api-token-revoked',
});

/** Adapter for the operation runner; the Worker must supply a verified complete target inventory. */
export function createNativeStorageOperationCommit(source:IdentityDatabase,port:StorageMutationPort){
  if(!source||!port)throw new TypeError('Storage operation authority is missing.');
  const auditId=(kind:Kind,executionId:string)=>{
    if(!Object.hasOwn(actions,kind)||!ID.test(executionId))throw new TypeError('Invalid native execution identity.');
    return port.receiptId(`native.${kind}`,executionId);
  };
  async function execute<T>(descriptor:NativeStorageRevocation,executionId:string,
    sourceCommit:()=>Promise<T>,readExecution:()=>Promise<T|null>,succeeded:(value:T)=>boolean,
    resumeOnly=false)
    :Promise<StorageMutationOutcome<T>>{
    if(!descriptor||!Object.hasOwn(actions,descriptor.kind)||!ID.test(descriptor.auditId)
      ||descriptor.action!==actions[descriptor.kind]||!ID.test(executionId)
      ||typeof sourceCommit!=='function'||typeof readExecution!=='function'||typeof succeeded!=='function'
      ||descriptor.auditId!==await auditId(descriptor.kind,executionId))
      throw new TypeError('Invalid storage operation receipt.');
    const receipt=async()=>{
      const column=descriptor.targetSessionId?'target_session_id':descriptor.targetPrincipalId?'target_principal_id':null;
      const target=descriptor.targetSessionId??descriptor.targetPrincipalId;
      const row=await source.prepare(`SELECT 1 AS ok FROM "${ACCESS_TABLES.access_audit}"
        WHERE id=? AND action=? ${column?`AND ${column}=?`:''} LIMIT 2`)
        .bind(...(column?[descriptor.auditId,descriptor.action,target!]:[descriptor.auditId,descriptor.action])).first();
      if(row?.ok!==1)return false;
      if(descriptor.kind==='policy.apply-delta'){
        const detail=await source.prepare(`SELECT from_epoch AS fromEpoch,to_epoch AS toEpoch
          FROM "${ACCESS_TABLES.access_policy_audit_details}" WHERE audit_id=? LIMIT 2`)
          .bind(descriptor.auditId).first();
        if(!detail||!Number.isSafeInteger(detail.fromEpoch)||Number(detail.fromEpoch)<1
          ||detail.toEpoch!==Number(detail.fromEpoch)+1
          ||descriptor.expectedEpoch!==undefined&&detail.fromEpoch!==descriptor.expectedEpoch)return false;
      }
      const execution=await readExecution();
      return execution!==null&&succeeded(execution);
    };
    const request={kind:`native.${descriptor.kind}`,
      commandKey:executionId,
      sourceCommit,committed:succeeded,inspectSource:receipt,
      recoverValue:async()=>{
        const existing=await readExecution();
        if(existing===null)throw new Error('Native execution receipt unavailable.');
        return existing;
      }};
    return resumeOnly?port.resume(request):port.commit(request);
  }
  return Object.freeze({auditId,
    commit<T>(request:NativeStorageOperationRequest<T>):Promise<StorageMutationOutcome<T>>{
      return execute(request.descriptor,request.executionId,request.sourceCommit,
        request.readExecution,request.succeeded);
    },
    async recover<T>(kind:Kind,executionId:string,readExecution:()=>Promise<T|null>,
      succeeded:(value:T)=>boolean):Promise<StorageMutationOutcome<T>>{
      const descriptor:NativeStorageRevocation={kind,requestKey:executionId,
        auditId:await auditId(kind,executionId),action:actions[kind]};
      return execute(descriptor,executionId,async()=>{throw new Error('Native source commit cannot replay.');},
        readExecution,succeeded,true);
    }});
}
