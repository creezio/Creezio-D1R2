import type {IdentityDatabase} from '../identity/d1-store.ts';
import {STORAGE_AUTHORITY_TABLES} from './models.ts';
import {StorageAuthorityError,type StorageRouteIdentity} from './target.ts';

const mutations=`"${STORAGE_AUTHORITY_TABLES.storage_mutations}"`;
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const grants=`"${STORAGE_AUTHORITY_TABLES.storage_grants}"`;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type Mutation=StorageRouteIdentity&Readonly<{mutationId:string;commandDigest:string;expectedGeneration:number}>;
const fail=(code:StorageAuthorityError['code']):never=>{throw new StorageAuthorityError(code)};
function valid(input:Mutation){
  if(!input||typeof input.installationId!=='string'||!ID.test(input.installationId)
    ||typeof input.contextId!=='string'||!ID.test(input.contextId)||input.contextId==='application'
    ||!Number.isInteger(input.slot)||input.slot<1||input.slot>16
    ||typeof input.mutationId!=='string'||!ID.test(input.mutationId)
    ||typeof input.commandDigest!=='string'||!/^sha256-[a-f0-9]{64}$/.test(input.commandDigest)
    ||!Number.isSafeInteger(input.expectedGeneration)||input.expectedGeneration<1)fail('invalid_input');
}
async function row(db:IdentityDatabase,id:string):Promise<Record<string,unknown>|null>{
  try{return await db.prepare(`SELECT id,installation_id AS installationId,context_id AS contextId,
    generation,command_digest AS commandDigest,state FROM ${mutations} WHERE id=? LIMIT 2`).bind(id).first();}
  catch{return fail('unavailable');}
}
export async function readStorageMutation(source:IdentityDatabase,mutationId:string){
  if(typeof mutationId!=='string'||!ID.test(mutationId))fail('invalid_input');
  const current=await row(source,mutationId);
  return current?Object.freeze({...current}):null;
}
async function targetRoute(db:IdentityDatabase,input:Mutation){
  try{return await db.prepare(`SELECT generation,state,mutation_id AS mutationId,source_epoch AS sourceEpoch
    FROM ${routes} WHERE id=? AND installation_id=? AND slot=? LIMIT 2`)
    .bind(input.contextId,input.installationId,input.slot).first();}
  catch{return fail('unavailable');}
}
function same(current:Record<string,unknown>|null,input:Mutation,state?:string){
  return !!current&&current.id===input.mutationId&&current.installationId===input.installationId
    &&current.contextId===input.contextId&&current.generation===input.expectedGeneration
    &&current.commandDigest===input.commandDigest&&(!state||current.state===state);
}
async function changed(db:IdentityDatabase,sql:string,bindings:readonly (string|number|null)[]){
  try{const result=await db.prepare(sql).bind(...bindings).run();
    if(!result.success||result.meta.changes!==1)fail('conflict');}
  catch(error){if(error instanceof StorageAuthorityError)throw error;fail('unavailable');}
}
/** Durable source intent, before the first target effect. */
export async function prepareStorageRevocation(source:IdentityDatabase,input:Mutation){
  valid(input);
  const existing=await row(source,input.mutationId);
  if(existing){if(!same(existing,input))fail('conflict');return existing.state;}
  await changed(source,`INSERT INTO ${mutations}
    (id,installation_id,context_id,generation,command_digest,state,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?,?,'prepared',(CAST(unixepoch('now') AS INTEGER)*1000),(CAST(unixepoch('now') AS INTEGER)*1000))`,
    [input.mutationId,input.installationId,input.contextId,input.expectedGeneration,input.commandDigest]);
  return 'prepared';
}

/** Target D1 serializes the fence with every guarded business batch. */
export async function fenceStorageRoute(source:IdentityDatabase,target:IdentityDatabase,input:Mutation){
  valid(input);
  const sourceIntent=await row(source,input.mutationId);
  if(!same(sourceIntent,input)||!['prepared','fenced','source-attempted','source-confirmed','open'].includes(String(sourceIntent!.state)))fail('conflict');
  const observed=await targetRoute(target,input);
  if(observed?.state==='deny'&&observed.mutationId===input.mutationId
    &&observed.generation===input.expectedGeneration+1){
    // An unknown acknowledgement is inspected, never issued a second time.
  }else{
    if(observed?.state!=='active'||observed.generation!==input.expectedGeneration)fail('conflict');
    try{
      const result=await target.batch([
        target.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${routes} WHERE id=? AND installation_id=?
          AND slot=? AND generation=? AND state='active') THEN 1 ELSE json('route_changed') END AS ok`)
          .bind(input.contextId,input.installationId,input.slot,input.expectedGeneration),
        target.prepare(`UPDATE ${routes} SET state='deny',generation=generation+1,mutation_id=?,
          updated_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000)
          WHERE id=? AND installation_id=? AND slot=? AND generation=? AND state='active'`)
          .bind(input.mutationId,input.contextId,input.installationId,input.slot,input.expectedGeneration),
        target.prepare(`DELETE FROM ${grants} WHERE context_id=?`).bind(input.contextId),
      ]);
      if(result.length!==3||!result.every(item=>item.success)||result[1].meta.changes!==1)fail('conflict');
    }catch(error){if(error instanceof StorageAuthorityError)throw error;fail('unavailable');}
  }
  // Source journal may lag a completed target fence; the next call repairs only this receipt.
  if(sourceIntent!.state==='prepared')await changed(source,`UPDATE ${mutations} SET state='fenced',
    updated_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000) WHERE id=? AND state='prepared'`,[input.mutationId]);
  return 'fenced';
}

/** First installation creates a denied route without any active interval. */
export async function initializeStorageRouteDeny(source:IdentityDatabase,target:IdentityDatabase,
  input:Mutation,sourceEpoch:number){
  valid(input);
  if(input.expectedGeneration!==1||!Number.isSafeInteger(sourceEpoch)||sourceEpoch<1)
    fail('invalid_input');
  await prepareStorageRevocation(source,input);
  const observed=await targetRoute(target,input);
  if(observed===null){
    try{
      const result=await target.prepare(`INSERT INTO ${routes}
        (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
        VALUES (?,?,?,2,'deny',?,?,(CAST(unixepoch('now') AS INTEGER)*1000))`)
        .bind(input.contextId,input.installationId,input.slot,input.mutationId,sourceEpoch).run();
      if(!result.success||result.meta.changes!==1)fail('conflict');
    }catch(error){if(error instanceof StorageAuthorityError)throw error;
      const after=await targetRoute(target,input);
      if(after?.state!=='deny'||after.mutationId!==input.mutationId
        ||after.generation!==2||after.sourceEpoch!==sourceEpoch)fail('unavailable');
    }
  }else if(observed.state!=='deny'||observed.mutationId!==input.mutationId
    ||observed.generation!==2||observed.sourceEpoch!==sourceEpoch)fail('conflict');
  return fenceStorageRoute(source,target,input);
}

export async function inspectStorageRevocation(source:IdentityDatabase,input:Mutation){
  valid(input);
  const current=await row(source,input.mutationId);
  if(!current)return null;
  if(!same(current,input))fail('conflict');
  return current.state as 'prepared'|'fenced'|'source-attempted'|'source-confirmed'|'open';
}

/** Durable before invoking a native source mutator. An unknown result is inspected, never replayed. */
export async function markStorageSourceAttempted(source:IdentityDatabase,input:Mutation){
  valid(input);
  const current=await row(source,input.mutationId);
  if(!same(current,input)||!['fenced','source-attempted'].includes(String(current!.state)))fail('conflict');
  if(current!.state==='fenced')await changed(source,`UPDATE ${mutations} SET state='source-attempted',
    updated_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000) WHERE id=? AND state='fenced'`,[input.mutationId]);
  return 'source-attempted';
}

/** Exactly one caller wins the first durable source-attempt claim. */
export async function claimStorageSourceAttempt(source:IdentityDatabase,input:Mutation){
  valid(input);
  const current=await row(source,input.mutationId);
  if(!same(current,input)||!['fenced','source-attempted','source-confirmed','open'].includes(String(current!.state)))
    fail('conflict');
  if(current!.state!=='fenced')return false;
  try{
    const result=await source.prepare(`UPDATE ${mutations} SET state='source-attempted',
      updated_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000) WHERE id=? AND state='fenced'`)
      .bind(input.mutationId).run();
    if(!result.success)return fail('unavailable');
    return result.meta.changes===1;
  }catch(error){if(error instanceof StorageAuthorityError)throw error;return fail('unavailable');}
}

/** One primary-D1 transaction marks the complete affected inventory or none of it. */
export async function claimStorageSourceAttemptBatch(source:IdentityDatabase,inputs:readonly Mutation[]){
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>16)fail('invalid_input');
  for(const input of inputs)valid(input);
  if(new Set(inputs.map(input=>input.mutationId)).size!==inputs.length
    ||new Set(inputs.map(input=>input.contextId)).size!==inputs.length
    ||new Set(inputs.map(input=>input.commandDigest)).size!==1)fail('invalid_input');
  const predicates=inputs.map(()=>`(id=? AND installation_id=? AND context_id=?
    AND generation=? AND command_digest=? AND state='fenced')`).join(' OR ');
  const bindings=inputs.flatMap(input=>[input.mutationId,input.installationId,input.contextId,
    input.expectedGeneration,input.commandDigest]);
  const ids=inputs.map(()=>'?').join(',');
  try{
    const results=await source.batch([
      source.prepare(`SELECT CASE WHEN (SELECT COUNT(*) FROM ${mutations}
        WHERE ${predicates})=? THEN 1 ELSE json('storage_source_claim_conflict') END AS allowed`)
        .bind(...bindings,inputs.length),
      source.prepare(`UPDATE ${mutations} SET state='source-attempted',
        updated_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000)
        WHERE id IN (${ids}) AND state='fenced'`).bind(...inputs.map(input=>input.mutationId)),
      source.prepare(`SELECT CASE WHEN changes()=? THEN 1 ELSE json('storage_source_claim_conflict') END AS allowed`)
        .bind(inputs.length),
    ]);
    if(results.length!==3||results.some(result=>!result.success)
      ||results[1].meta.changes!==inputs.length)return fail('conflict');
    return true;
  }catch(error){if(error instanceof StorageAuthorityError)throw error;return fail('unavailable');}
}

/** The native source mutator must be inspected by a caller-owned read-only proof. */
export async function confirmStorageSource(source:IdentityDatabase,input:Mutation,
  inspectCommitted:()=>Promise<boolean>){
  valid(input);
  const current=await row(source,input.mutationId);
  if(!same(current,input)||!['source-attempted','source-confirmed','open'].includes(String(current!.state)))fail('conflict');
  if(current!.state!=='source-attempted')return current!.state;
  if(typeof inspectCommitted!=='function')fail('invalid_input');
  let confirmed=false;
  try{confirmed=await inspectCommitted()===true;}catch{return fail('unavailable');}
  if(!confirmed)fail('unavailable');
  await changed(source,`UPDATE ${mutations} SET state='source-confirmed',
    updated_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000) WHERE id=? AND state='source-attempted'`,[input.mutationId]);
  return 'source-confirmed';
}

/** Reopen only after a durable source receipt; old grants have the old generation. */
export async function reopenStorageRoute(source:IdentityDatabase,target:IdentityDatabase,input:Mutation,newSourceEpoch:number){
  valid(input);
  if(!Number.isSafeInteger(newSourceEpoch)||newSourceEpoch<1)fail('invalid_input');
  const current=await row(source,input.mutationId);
  if(!same(current,input)||!['source-confirmed','open'].includes(String(current!.state)))fail('conflict');
  const observed=await targetRoute(target,input);
  if(observed?.state==='active'&&observed.mutationId===input.mutationId
    &&observed.generation===input.expectedGeneration+1&&observed.sourceEpoch===newSourceEpoch){
    // Confirmed target state after an unknown response.
  }else{
    if(current!.state!=='source-confirmed'||observed?.state!=='deny'
      ||observed.mutationId!==input.mutationId||observed.generation!==input.expectedGeneration+1)fail('conflict');
    await changed(target,`UPDATE ${routes} SET state='active',source_epoch=?,
      updated_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000)
      WHERE id=? AND installation_id=? AND slot=? AND state='deny' AND mutation_id=? AND generation=?`,
      [newSourceEpoch,input.contextId,input.installationId,input.slot,input.mutationId,input.expectedGeneration+1]);
  }
  if(current!.state==='source-confirmed')await changed(source,`UPDATE ${mutations} SET state='open',
    updated_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000) WHERE id=? AND state='source-confirmed'`,[input.mutationId]);
  return 'open';
}

export async function inspectStorageRouteOpen(target:IdentityDatabase,input:Mutation,sourceEpoch:number){
  valid(input);
  const current=await targetRoute(target,input);
  return current?.state==='active'&&current.mutationId===input.mutationId
    &&current.generation===input.expectedGeneration+1&&current.sourceEpoch===sourceEpoch;
}
