import type {IdentityDatabase} from '../identity/d1-store.ts';
import type {ResolvedDataAuthorization,SqlStatement} from '../data/authorization.ts';
import {STORAGE_AUTHORITY_TABLES} from './models.ts';

const q=(name:string)=>`"${name}"`;
const routes=q(STORAGE_AUTHORITY_TABLES.storage_routes),grants=q(STORAGE_AUTHORITY_TABLES.storage_grants);
// The central composition installer owns this table and advances it with the DDL batch.
const schemaReceipts=q('cz_schema_receipts');
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^sha256-[a-f0-9]{64}$/;
export interface StorageRouteIdentity {readonly installationId:string;readonly contextId:string;readonly slot:number}
export interface ActiveStorageRoute extends StorageRouteIdentity {readonly generation:number;readonly sourceEpoch:number}
export interface ScopedStorageGrant {readonly id:string;readonly route:ActiveStorageRoute;
  readonly credentialDigest:string;readonly targetDigest:string;
  readonly compositionDigest:string;readonly lockDigest:string;
  readonly principalId:string;
  readonly actorPrincipalId:string;readonly audience:'admin'|'app';readonly moduleId:string;
  readonly sourceEpoch:number;readonly expiresAtMs:number}
export class StorageAuthorityError extends Error {
  readonly code:'invalid_input'|'unavailable'|'conflict';
  constructor(code:'invalid_input'|'unavailable'|'conflict'){
    super(`Storage authority ${code}.`);this.name='StorageAuthorityError';this.code=code;
  }
}
const fail=(code:StorageAuthorityError['code']):never=>{throw new StorageAuthorityError(code)};
const validRoute=(value:StorageRouteIdentity)=>!!value&&typeof value.installationId==='string'&&ID.test(value.installationId)
  &&typeof value.contextId==='string'&&ID.test(value.contextId)&&value.contextId!=='application'
  &&Number.isInteger(value.slot)&&value.slot>=1&&value.slot<=16;
async function digest(value:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return 'sha256-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** Read the target before resolving the source credential, then CAS this generation when projecting. */
export async function readActiveStorageRoute(db:IdentityDatabase,identity:StorageRouteIdentity):Promise<ActiveStorageRoute>{
  if(!validRoute(identity))fail('invalid_input');
  let row:Record<string,unknown>|null=null;
  try{row=await db.prepare(`SELECT generation,source_epoch AS sourceEpoch,state FROM ${routes}
    WHERE id=? AND installation_id=? AND slot=? LIMIT 2`).bind(identity.contextId,identity.installationId,identity.slot).first();}
  catch{return fail('unavailable');}
  if(!row||row.state!=='active'||!Number.isSafeInteger(row.generation)||Number(row.generation)<1
    ||!Number.isSafeInteger(row.sourceEpoch)||Number(row.sourceEpoch)<1)return fail('unavailable');
  return Object.freeze({...identity,generation:Number(row.generation),sourceEpoch:Number(row.sourceEpoch)});
}

/** Host-only predicate for explicitly public reads, with no user grant or session. */
export function activeStorageCompositionCondition(identity:StorageRouteIdentity,
  compositionDigest:string,lockDigest:string):SqlStatement{
  if(!validRoute(identity)||!HASH.test(compositionDigest)||!HASH.test(lockDigest))fail('invalid_input');
  return Object.freeze({sql:`EXISTS(SELECT 1 FROM ${routes} WHERE id=? AND installation_id=?
    AND slot=? AND state='active')
    AND (SELECT json_extract(payload,'$.compositionDigest') FROM ${schemaReceipts}
      ORDER BY sequence DESC LIMIT 1)=?
    AND (SELECT json_extract(payload,'$.lockDigest') FROM ${schemaReceipts}
      ORDER BY sequence DESC LIMIT 1)=?`,
    bindings:Object.freeze([identity.contextId,identity.installationId,identity.slot,
      compositionDigest,lockDigest])});
}

/** A short scoped receipt, never a password, session token, or standalone permission. */
export async function projectScopedStorageGrant(db:IdentityDatabase,route:ActiveStorageRoute,
  state:ResolvedDataAuthorization,moduleId:string,compositionDigest:string,
  lockDigest:string):Promise<ScopedStorageGrant>{
  if(!validRoute(route)||!Number.isSafeInteger(route.generation)||route.generation<1
    ||!Number.isSafeInteger(route.sourceEpoch)||route.sourceEpoch!==state.epoch
    ||state.target.contextId!==route.contextId||typeof moduleId!=='string'||!ID.test(moduleId)
    ||!HASH.test(compositionDigest)||!HASH.test(lockDigest))fail('conflict');
  const targetDigest=await digest({contextId:state.target.contextId,audience:state.target.audience,
    actors:[...state.target.actors].sort(),requiredPermissionIds:[...state.target.requiredPermissionIds].sort(),
    purpose:state.target.purpose,moduleId,compositionDigest,lockDigest});
  const id=await digest([route.installationId,route.contextId,route.generation,state.digest,targetDigest]);
  const receipt=Object.freeze({id,route,credentialDigest:state.digest,targetDigest,
    compositionDigest,lockDigest,
    principalId:state.subjectPrincipalId,actorPrincipalId:state.actorPrincipalId,
    audience:state.target.audience,moduleId,sourceEpoch:state.epoch,expiresAtMs:state.validUntilMs});
  let result:D1Result<Record<string,unknown>>|undefined;
  try{result=await db.prepare(`INSERT INTO ${grants}
    (id,context_id,generation,credential_digest,principal_id,actor_principal_id,audience,module_id,
      target_digest,source_epoch,expires_at_ms)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${routes} WHERE id=? AND installation_id=?
      AND slot=? AND generation=? AND source_epoch=? AND state='active')
      AND (SELECT json_extract(payload,'$.compositionDigest') FROM ${schemaReceipts}
        ORDER BY sequence DESC LIMIT 1)=?
      AND (SELECT json_extract(payload,'$.lockDigest') FROM ${schemaReceipts}
        ORDER BY sequence DESC LIMIT 1)=?
    ON CONFLICT(id) DO UPDATE SET expires_at_ms=excluded.expires_at_ms
      WHERE ${grants}.generation=excluded.generation AND ${grants}.source_epoch=excluded.source_epoch
        AND (SELECT json_extract(payload,'$.compositionDigest') FROM ${schemaReceipts}
          ORDER BY sequence DESC LIMIT 1)=?
        AND (SELECT json_extract(payload,'$.lockDigest') FROM ${schemaReceipts}
          ORDER BY sequence DESC LIMIT 1)=?`)
    .bind(id,route.contextId,route.generation,state.digest,state.subjectPrincipalId,state.actorPrincipalId,
      state.target.audience,moduleId,targetDigest,state.epoch,state.validUntilMs,
      route.contextId,route.installationId,route.slot,route.generation,route.sourceEpoch,
      compositionDigest,lockDigest,compositionDigest,lockDigest).run();}
  catch{fail('unavailable');}
  if(!result||!result.success||result.meta.changes!==1)fail('conflict');
  return receipt;
}

/** This SELECT is executed in the same target D1 batch as business writes. */
export function freshScopedStorageGuard(grant:ScopedStorageGrant):SqlStatement{
  const r=grant?.route;
  if(!r||!validRoute(r)||!Number.isSafeInteger(r.generation)||!ID.test(grant.moduleId)
    ||!HASH.test(grant.id)||!HASH.test(grant.targetDigest)
    ||!HASH.test(grant.compositionDigest)||!HASH.test(grant.lockDigest)
    ||!Number.isSafeInteger(grant.expiresAtMs)||grant.expiresAtMs<1)fail('invalid_input');
  return Object.freeze({sql:`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${routes} r JOIN ${grants} g
    ON g.context_id=r.id AND g.generation=r.generation WHERE r.id=? AND r.installation_id=?
    AND r.slot=? AND r.generation=? AND r.source_epoch=? AND r.state='active'
    AND g.id=? AND g.credential_digest=? AND g.target_digest=? AND g.principal_id=?
    AND g.actor_principal_id=? AND g.audience=? AND g.module_id=? AND g.source_epoch=?
    AND g.expires_at_ms>(CAST(unixepoch('now') AS INTEGER)*1000)
    AND ?>(CAST(unixepoch('now') AS INTEGER)*1000)
    AND (SELECT json_extract(payload,'$.compositionDigest') FROM ${schemaReceipts}
      ORDER BY sequence DESC LIMIT 1)=?
    AND (SELECT json_extract(payload,'$.lockDigest') FROM ${schemaReceipts}
      ORDER BY sequence DESC LIMIT 1)=? )
    THEN 1 ELSE json('creezio_storage_guard_failed') END AS allowed`,
    bindings:Object.freeze([r.contextId,r.installationId,r.slot,r.generation,r.sourceEpoch,
      grant.id,grant.credentialDigest,grant.targetDigest,grant.principalId,grant.actorPrincipalId,
      grant.audience,grant.moduleId,grant.sourceEpoch,grant.expiresAtMs,
      grant.compositionDigest,grant.lockDigest])});
}
