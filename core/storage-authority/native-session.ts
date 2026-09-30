import type {IdentityDatabase} from '../identity/d1-store.ts';
import {ACCESS_TABLES} from '../identity/d1-store.ts';
import {createAccountService} from '../identity/accounts.ts';
import {digestOpaqueToken} from '../identity/tokens.ts';
import {readActiveStorageRoute,type StorageRouteIdentity,StorageAuthorityError} from './target.ts';
import {readStorageMutation,prepareStorageRevocation,fenceStorageRoute,claimStorageSourceAttemptBatch,
  confirmStorageSource,reopenStorageRoute} from './coordinator.ts';

export interface NativeSessionStorageTarget {readonly identity:StorageRouteIdentity;readonly db:IdentityDatabase}
export type NativeLogoutResult=Readonly<{state:'revoked'|'not_found'|'pending'}>;
const result=(state:NativeLogoutResult['state']):NativeLogoutResult=>Object.freeze({state});
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
async function hash(value:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** Host-injected route inventory. Do not expose this wrapper until every authority mutator is fenced. */
export function createRoutedNativeSessionLogout(source:IdentityDatabase,
  targets:readonly NativeSessionStorageTarget[]){
  if(!source||!Array.isArray(targets)||targets.length<1||targets.length>16)throw new StorageAuthorityError('invalid_input');
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
  const accounts=createAccountService(source);
  return Object.freeze({async logout(token:unknown,audience:'admin'|'app'):Promise<NativeLogoutResult>{
    if(audience!=='admin'&&audience!=='app')throw new StorageAuthorityError('invalid_input');
    const credentialDigest=await digestOpaqueToken(token,'session');
    if(!credentialDigest)return result('not_found');
    const installationId=inventory[0].identity.installationId;
    const commandDigest=`sha256-${await hash(['logout',installationId,audience,credentialDigest])}`;
    try{
      const entries:Array<{item:NativeSessionStorageTarget;command:StorageRouteIdentity&{
        mutationId:string;commandDigest:string;expectedGeneration:number};state:unknown}>=[];
      for(const item of inventory){
        const mutationId=`logout:${(await hash([commandDigest,item.identity.contextId,item.identity.slot])).slice(0,48)}`;
        const existing=await readStorageMutation(source,mutationId);
        if(existing&&(existing.installationId!==installationId||existing.contextId!==item.identity.contextId
          ||existing.commandDigest!==commandDigest))throw new StorageAuthorityError('conflict');
        const generation=existing?Number(existing.generation)
          :(await readActiveStorageRoute(item.db,item.identity)).generation;
        entries.push({item,command:{...item.identity,mutationId,commandDigest,expectedGeneration:generation},
          state:existing?.state??null});
      }
      let session:unknown=await accounts.session(token,audience);
      if(!session&&entries.every(entry=>entry.state===null))return result('not_found');
      if(entries.some(entry=>entry.state===null)&&!session)return result('pending');
      for(const entry of entries)if(entry.state===null){
        entry.state=await prepareStorageRevocation(source,entry.command);
      }
      for(const entry of entries)if(entry.state==='prepared'){
        entry.state=await fenceStorageRoute(source,entry.item.db,entry.command);
      }
      if(entries.some(entry=>entry.state==='prepared'))return result('pending');
      if(session){
        if(entries.some(entry=>!['fenced'].includes(String(entry.state))))return result('pending');
        await claimStorageSourceAttemptBatch(source,entries.map(entry=>entry.command));
        for(const entry of entries)entry.state='source-attempted';
        // Every target is fenced and every intent is durable before this native mutation.
        try{await accounts.logout(token,audience);}catch{/* inspect outcome below */}
        session=await accounts.session(token,audience);
        if(session)return result('pending');
      }
      if(entries.some(entry=>entry.state==='fenced'))return result('pending');
      for(const entry of entries)if(entry.state==='source-attempted'){
        entry.state=await confirmStorageSource(source,entry.command,
          async()=>await accounts.session(token,audience)===null);
      }
      const epochRow=await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
        WHERE id='application' LIMIT 2`).first();
      if(!epochRow||!Number.isSafeInteger(epochRow.epoch)||Number(epochRow.epoch)<1)return result('pending');
      for(const entry of entries)if(entry.state==='source-confirmed'){
        entry.state=await reopenStorageRoute(source,entry.item.db,entry.command,Number(epochRow.epoch));
      }
      return entries.every(entry=>entry.state==='open')?result('revoked'):result('pending');
    }catch(error){
      if(error instanceof StorageAuthorityError)return result('pending');
      return result('pending');
    }
  }});
}
