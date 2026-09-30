import type {IdentityDatabase} from '../identity/d1-store.ts';
import {ACCESS_TABLES} from '../identity/d1-store.ts';
import {readActiveStorageRoute,StorageAuthorityError,type StorageRouteIdentity} from './target.ts';
import {readStorageMutation,prepareStorageRevocation,fenceStorageRoute,
  claimStorageSourceAttemptBatch,
  confirmStorageSource,reopenStorageRoute,inspectStorageRouteOpen} from './coordinator.ts';

export interface StorageMutationTarget {readonly identity:StorageRouteIdentity;readonly db:IdentityDatabase}
export interface StorageMutationRequest<T> {
  /** Stable identity of the native command, without plaintext credentials. */
  readonly kind:string;readonly commandKey:string;
  readonly sourceCommit:()=>Promise<T>;
  readonly committed:(value:T)=>boolean;
  /** Read-only, command-specific proof; a matching version alone is insufficient. */
  readonly inspectSource:()=>Promise<boolean>;
  /** Reconstruct the safe return value after a lost response, without another write. */
  readonly recoverValue?:()=>Promise<T>;
}
export type StorageMutationOutcome<T>=Readonly<{state:'confirmed';value:T}|{state:'pending'}>;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
async function hash(value:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** The caller must supply the complete verified route inventory before enabling this port. */
export function createStorageMutationPort(source:IdentityDatabase,targets:readonly StorageMutationTarget[]){
  if(!source||!Array.isArray(targets)||targets.length<1||targets.length>16)
    throw new StorageAuthorityError('invalid_input');
  const installations=new Set(targets.map(item=>item?.identity?.installationId));
  const contexts=new Set(targets.map(item=>item?.identity?.contextId));
  const slots=new Set(targets.map(item=>item?.identity?.slot));
  if(installations.size!==1||contexts.size!==targets.length||slots.size!==targets.length
    ||targets.some(item=>!item?.db||typeof item.identity?.installationId!=='string'
      ||!ID.test(item.identity.installationId)||typeof item.identity.contextId!=='string'
      ||!ID.test(item.identity.contextId)||item.identity.contextId==='application'
      ||!Number.isInteger(item.identity.slot)||item.identity.slot<1||item.identity.slot>16))
    throw new StorageAuthorityError('invalid_input');
  const inventory=Object.freeze(targets.map(item=>Object.freeze({identity:Object.freeze({...item.identity}),db:item.db})));
  async function receiptId(kind:string,commandKey:string):Promise<string>{
    if(typeof kind!=='string'||!ID.test(kind)||typeof commandKey!=='string'||!commandKey)
      throw new StorageAuthorityError('invalid_input');
    const hex=await hash(['source-receipt',inventory[0].identity.installationId,kind,commandKey]);
    const bytes=Uint8Array.from(hex.slice(0,32).match(/../g)!,value=>parseInt(value,16));
    bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
    const value=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
    return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
  }
  async function commandDigest(kind:string,commandKey:string):Promise<string>{
    if(typeof kind!=='string'||!ID.test(kind)||typeof commandKey!=='string'||!commandKey)
      throw new StorageAuthorityError('invalid_input');
    return `sha256-${await hash([kind,commandKey,inventory[0].identity.installationId])}`;
  }
  async function perform<T>(request:StorageMutationRequest<T>,resumeOnly:boolean):Promise<StorageMutationOutcome<T>>{
    if(!request||typeof request.kind!=='string'||!ID.test(request.kind)
      ||typeof request.commandKey!=='string'||!request.commandKey
      ||typeof request.sourceCommit!=='function'||typeof request.committed!=='function'
      ||typeof request.inspectSource!=='function')throw new StorageAuthorityError('invalid_input');
    const installationId=inventory[0].identity.installationId;
    const commandDigestValue=await commandDigest(request.kind,request.commandKey);
    try{
      const entries:Array<{item:StorageMutationTarget;command:StorageRouteIdentity&{
        mutationId:string;commandDigest:string;expectedGeneration:number};state:unknown}>=[];
      for(const item of inventory){
        const mutationId=`authority:${(await hash([commandDigestValue,item.identity.contextId,item.identity.slot])).slice(0,48)}`;
        const existing=await readStorageMutation(source,mutationId);
        if(existing&&(existing.installationId!==installationId||existing.contextId!==item.identity.contextId
          ||existing.commandDigest!==commandDigestValue))throw new StorageAuthorityError('conflict');
        const generation=existing?Number(existing.generation)
          :(await readActiveStorageRoute(item.db,item.identity)).generation;
        entries.push({item,command:{...item.identity,mutationId,commandDigest:commandDigestValue,expectedGeneration:generation},
          state:existing?.state??null});
      }
      // Status/lookup of a historical execution must never create a new fence.
      // Recovery only completes an already journalled source attempt.
      if(resumeOnly&&entries.some(entry=>!['source-attempted','source-confirmed','open']
        .includes(String(entry.state))))return Object.freeze({state:'pending' as const});
      // A partial per-target journal never gives permission to skip a route.
      if(entries.some(entry=>entry.state===null)
        &&entries.some(entry=>entry.state!==null&&!['prepared','fenced'].includes(String(entry.state))))
        return Object.freeze({state:'pending' as const});
      for(const entry of entries)if(entry.state===null)
        entry.state=await prepareStorageRevocation(source,entry.command);
      for(const entry of entries)if(entry.state==='prepared')
        entry.state=await fenceStorageRoute(source,entry.item.db,entry.command);
      if(entries.some(entry=>entry.state==='prepared'))return Object.freeze({state:'pending' as const});
      let value:T|undefined;
      // All-fenced may be resumed after a crash before the first source-attempted mark.
      if(entries.every(entry=>entry.state==='fenced')){
        await claimStorageSourceAttemptBatch(source,entries.map(entry=>entry.command));
        for(const entry of entries)entry.state='source-attempted';
        // Never replay an ambiguous source commit on a subsequent invocation.
        value=await request.sourceCommit();
        if(!request.committed(value))return Object.freeze({state:'pending' as const});
      }
      if(entries.some(entry=>entry.state==='fenced'))return Object.freeze({state:'pending' as const});
      for(const entry of entries)if(entry.state==='source-attempted')
        entry.state=await confirmStorageSource(source,entry.command,request.inspectSource);
      const epochRow=await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
        WHERE id='application' LIMIT 2`).first();
      if(!epochRow||!Number.isSafeInteger(epochRow.epoch)||Number(epochRow.epoch)<1)
        return Object.freeze({state:'pending' as const});
      for(const entry of entries)if(entry.state==='source-confirmed')
        entry.state=await reopenStorageRoute(source,entry.item.db,entry.command,Number(epochRow.epoch));
      if(!entries.every(entry=>entry.state==='open'))return Object.freeze({state:'pending' as const});
      if(!await request.inspectSource())return Object.freeze({state:'pending' as const});
      for(const entry of entries)if(!await inspectStorageRouteOpen(entry.item.db,entry.command,Number(epochRow.epoch)))
        return Object.freeze({state:'pending' as const});
      if(value===undefined&&request.recoverValue)value=await request.recoverValue();
      return value!==undefined&&request.committed(value)
        ?Object.freeze({state:'confirmed' as const,value}):Object.freeze({state:'pending' as const});
    }catch{return Object.freeze({state:'pending' as const});}
  }
  return Object.freeze({receiptId,commandDigest,
    commit<T>(request:StorageMutationRequest<T>){return perform(request,false)},
    resume<T>(request:StorageMutationRequest<T>){return perform(request,true)}});
}
export type StorageMutationPort=ReturnType<typeof createStorageMutationPort>;
