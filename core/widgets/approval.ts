import {createDataAccess,createDataTransactionExecutor} from '../data/service.ts';
import {copyJson,quote,validId} from '../data/input.ts';
import type {DataCredential,DataLease,JsonValue,PermissionDefinition,RuntimeDataCatalog} from '../data/types.ts';
import type {IdentityDatabase} from '../identity/d1-store.ts';
import {createD1IdentityStore} from '../identity/d1-store.ts';
import type {StorageRouteIdentity} from '../storage-authority/target.ts';
import {createD1OAuthStore} from '../oauth/store.ts';
import {createNativeAuthorizationResolver} from '../authorization/resolver.ts';
import {authorize as authorizeDecision} from '../authorization/authorize.ts';
import {policySnapshot} from '../authorization/policy.ts';
import {digestOpaqueToken} from '../identity/tokens.ts';
import type {SqlStatement} from '../data/authorization.ts';
import {OPERATION_TABLES} from '../operations/models.ts';
import {operationDigest} from '../operations/digest.ts';
import type {OperationRegistry} from '../operations/registry.ts';
import {OperationError,type RegisteredOperation} from '../operations/types.ts';

const table=quote(OPERATION_TABLES.approvals);
const NOW="(CAST(unixepoch('now') AS INTEGER) * 1000)";
const sql=(sql:string,...bindings:(string|number|null)[]):SqlStatement=>({sql,bindings});
const failure=(code:ConstructorParameters<typeof OperationError>[0]):never=>{throw new OperationError(code);};
const audience=(value:unknown):value is 'admin'|'app'=>value==='admin'||value==='app';
const id=(value:unknown)=>validId(value);
const digest=(value:unknown):value is string=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
const record=(value:JsonValue):value is Readonly<Record<string,JsonValue>>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function capture<T>(value:unknown,bytes:number):T {
  try{return copyJson(value,bytes) as T;}catch{return failure('invalid_input');}
}
type Scope=Readonly<{actorPrincipalId:string;principalId:string;contextId:string;audience:'admin'|'app'}>;
type Row=Readonly<Record<string,unknown>>;
export interface ApprovalRequestInput {readonly credential:DataCredential;readonly audience:'admin'|'app';
  readonly contextId:string;readonly moduleId:string;readonly operationId:string;readonly input:unknown}
export interface ApprovalNativeInput {readonly credential:Readonly<{kind:'session';token:unknown}>;
  readonly audience:'admin'|'app';readonly contextId:string;readonly approvalId:string}
export interface ApprovalPreview {readonly approvalId:string;readonly state:'pending'|'approved'|'rejected'|'consumed'|'expired';
  readonly expiresAtMs:number;readonly operation:Readonly<{moduleId:string;operationId:string;title:string}>;
  readonly fields:Readonly<Record<string,JsonValue>>;readonly inputDigest:string;readonly csrfNonce:string|null;
  readonly sessionId:string;readonly principalId:string;readonly contextId:string}
export interface ApprovalDecisionInput extends ApprovalNativeInput {readonly decision:'approve'|'reject';readonly csrfNonce:string}
export interface ApprovalDecision {readonly approvalId:string;readonly state:'approved'|'rejected';readonly expiresAtMs:number}
export interface ApprovalConsumptionInput {readonly approvalId:string;readonly credential:DataCredential;
  readonly operation:RegisteredOperation;readonly identity:Scope;readonly inputHash:string;readonly keyHash:string;
  readonly objectVersion:string|number}
const credentialPurpose=(kind:DataCredential['kind'])=>kind==='oauth'?'oauth-access':kind;
async function credentialDigest(credential:DataCredential):Promise<string> {
  const value=await digestOpaqueToken(credential.token,credentialPurpose(credential.kind));
  return value??failure('unauthorized');
}
function permission(operation:RegisteredOperation):string {
  const approval=operation.declaration.approval;
  if(approval.mode!=='required'||operation.declaration.kind!=='command'
    ||operation.declaration.idempotency.mode!=='required')return failure('unsupported');
  return `${approval.permission.moduleId}:${approval.permission.id}`;
}
function previewFields(operation:RegisteredOperation,input:Readonly<Record<string,JsonValue>>):Readonly<Record<string,JsonValue>> {
  const approval=operation.declaration.approval;
  if(approval.mode!=='required')return failure('unsupported');
  if(new Set(approval.bind).size!==5||!['actor','context','operation','input-hash','object-version']
    .every(item=>approval.bind.includes(item as typeof approval.bind[number])))return failure('unsupported');
  const field=operation.declaration.concurrency.versionField;
  if(!field||!Object.hasOwn(input,field))return failure('invalid_input');
  if(typeof input[field]!=='string'&&typeof input[field]!=='number')return failure('invalid_input');
  const sensitive=/secret|token|password|credential|api[_-]?key/i;
  const scrub=(value:JsonValue,depth=0):JsonValue=>{
    if(depth>16)return failure('invalid_input');
    if(Array.isArray(value))return value.map(item=>scrub(item,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>
      [name,sensitive.test(name)?'[redacted]':scrub(item,depth+1)]));
    return value;
  };
  // The digest binds the exact input; the human preview keeps business fields while masking credential-shaped fields.
  return copyJson(scrub(input),4096) as Readonly<Record<string,JsonValue>>;
}
function approvalRow(value:Row|null):Row {
  if(!value||!id(value.id)||!id(value.module_id)||!id(value.operation_id)
    ||!digest(value.input_hash)||!digest(value.request_key_hash)
    ||!Number.isSafeInteger(value.expires_at_ms)||!audience(value.audience))return failure('not_found');
  return value;
}

/** Approval state is host technical data. No widget, module handler or MCP tool obtains SQL. */
export function createWidgetApprovalService(options:{db:IdentityDatabase;catalog:RuntimeDataCatalog;
  permissions:readonly PermissionDefinition[];registry:OperationRegistry;
  authorityDb?:IdentityDatabase;storageRoute?:StorageRouteIdentity}) {
  const data=createDataAccess(options.db,{catalog:options.catalog,permissions:options.permissions,
    authorityDb:options.authorityDb,storageRoute:options.storageRoute});
  const identityDb=options.authorityDb??options.db;
  const transactions=createDataTransactionExecutor(data,options.db),identities=createD1IdentityStore(identityDb),
    oauth=createD1OAuthStore(identityDb),humanResolver=createNativeAuthorizationResolver(identityDb,
      {permissions:options.permissions});
  async function binding(credential:DataCredential,identity:Scope){
    const secret=await credentialDigest(credential);
    if(credential.kind!=='oauth')return {digest:secret,grantId:null,clientId:null};
    const access=await oauth.access(secret);
    if(!access||access.principalId!==identity.actorPrincipalId||access.contextId!==identity.contextId
      ||access.audience!==identity.audience)return failure('forbidden');
    return {digest:await operationDigest({grantId:access.grantId,clientId:access.clientId}),
      grantId:access.grantId,clientId:access.clientId};
  }
  const select=async(approvalId:string):Promise<Row|null>=>{
    if(!id(approvalId))return failure('invalid_input');
    try{return await options.db.prepare(`SELECT * FROM ${table} WHERE id=? LIMIT 1`).bind(approvalId).first<Row>();}
    catch{return failure('unavailable');}
  };
  const resolve=(moduleId:string,operationId:string)=>options.registry.resolve(moduleId,operationId);
  async function authorizeOperation(credential:DataCredential,operation:RegisteredOperation,contextId:string,
    requestedAudience:'admin'|'app',human=false):Promise<DataLease> {
    const op=operation.declaration;
    const grantPermission=permission(operation);
    if(!op.audiences.includes(requestedAudience)||op.context==='application'&&contextId!=='application')return failure('forbidden');
    if(human&&credential.kind!=='session')return failure('forbidden');
    const actors=human?['user'] as const:op.actors.filter((actor):actor is 'user'|'machine'|'delegated-user'|'impersonated-user'=>
      ['user','machine','delegated-user','impersonated-user'].includes(actor));
    if(!actors.length)return failure('forbidden');
    try {
      const required=op.permissions.map(ref=>`${ref.moduleId}:${ref.id}`);
      const lease=await data.authorize(credential,{contextId,audience:requestedAudience,actors,
        requiredPermissionIds:human?[...required,grantPermission]:required,purpose:'operation'},
      {moduleId:operation.moduleId});
      if(human){
        const current=await humanResolver.resolve(credential.token,requestedAudience);
        const target={contextId,audience:requestedAudience,actors:['user'] as const,
          requiredPermissionIds:[...required,grantPermission],
          purpose:'human-approval' as const};
        if(!current||!authorizeDecision(policySnapshot(current.policy,humanResolver.permissions,current.session),
          target,current.nowMs).allowed){data.dispose(lease);return failure('forbidden');}
      }
      return lease;
    }catch{return failure('forbidden');}
  }
  async function native(input:ApprovalNativeInput,row:Row) {
    const operation=resolve(String(row.module_id),String(row.operation_id));
    if(operation.contractDigest!==row.operation_digest)return failure('conflict');
    const lease=await authorizeOperation(input.credential,operation,input.contextId,input.audience,true);
    const sessionDigest=await credentialDigest(input.credential);
    const session=await identities.getSession(sessionDigest,input.audience);
    const identity=data.describeLease(lease);
    if(!session||session.principalId!==identity.actorPrincipalId||row.actor_principal_id!==identity.actorPrincipalId
      ||row.principal_id!==identity.principalId||row.context_id!==identity.contextId||row.audience!==identity.audience) {
      data.dispose(lease);return failure('forbidden');
    }
    return {lease,session,operation};
  }
  return Object.freeze({
    async request(supplied:ApprovalRequestInput):Promise<Readonly<{approvalId:string;state:'pending';expiresAtMs:number}>> {
      const request=capture<ApprovalRequestInput>(supplied,75_000);
      const operation=resolve(request.moduleId,request.operationId),op=operation.declaration;
      if(op.approval.mode!=='required'||op.idempotency.mode!=='required')return failure('unsupported');
      const input=capture<JsonValue>(request.input,65_536);
      if(!record(input)||operation.validateInput(input)!==true)return failure('invalid_input');
      const requestKey=input[op.idempotency.keyField];
      if(typeof requestKey!=='string'||!requestKey||new TextEncoder().encode(requestKey).length>512)return failure('invalid_input');
      const fields=previewFields(operation,input);
      const lease=await authorizeOperation(request.credential,operation,request.contextId,request.audience);
      try {
        const who=data.describeLease(lease);
        if(who.credentialKind==='api-token'||who.credentialKind==='impersonation')return failure('forbidden');
        const credential=await binding(request.credential,who),credentialHash=credential.digest;
        const inputHash=await operationDigest(input),keyHash=await operationDigest(requestKey),approvalId=crypto.randomUUID();
        const objectVersion=String(input[op.concurrency.versionField!]);
        const expires=op.approval.expiresAfterSeconds*1000;
        const where='module_id=? AND operation_id=? AND actor_principal_id=? AND context_id=? AND audience=? AND request_key_hash=?';
        const bindings=[operation.moduleId,op.id,who.actorPrincipalId,who.contextId,who.audience,keyHash];
        const batch=await transactions.execute(lease,{write:true,after:[
          sql(`INSERT INTO ${table}(id,module_id,operation_id,operation_digest,actor_principal_id,principal_id,
            context_id,audience,credential_digest,input_hash,request_key_hash,preview,object_version,
            oauth_grant_id,oauth_client_id,state,expires_at_ms,
            decision_session_id,csrf_digest,decision_nonce,decided_at_ms,consumed_at_ms,consumed_nonce,created_at_ms,updated_at_ms)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending',${NOW}+?,NULL,NULL,NULL,NULL,NULL,NULL,${NOW},${NOW})
            ON CONFLICT(module_id,operation_id,actor_principal_id,context_id,audience,request_key_hash) DO NOTHING`,
          approvalId,operation.moduleId,op.id,operation.contractDigest,who.actorPrincipalId,who.principalId,
          who.contextId,who.audience,credentialHash,inputHash,keyHash,JSON.stringify(fields),objectVersion,
          credential.grantId,credential.clientId,expires),
          sql(`SELECT id,input_hash,credential_digest,object_version,oauth_grant_id,oauth_client_id,state,expires_at_ms
            FROM ${table} WHERE ${where} LIMIT 1`,...bindings),
        ]});
        const row=batch.after.at(-1)?.results[0];
        if(!row||row.input_hash!==inputHash||row.credential_digest!==credentialHash
          ||row.object_version!==objectVersion||row.oauth_grant_id!==credential.grantId
          ||row.oauth_client_id!==credential.clientId||row.state!=='pending'
          ||!Number.isSafeInteger(row.expires_at_ms)||Number(row.expires_at_ms)<=Date.now())return failure('conflict');
        return {approvalId:String(row.id),state:'pending',expiresAtMs:Number(row.expires_at_ms)};
      }catch(error){if(error instanceof OperationError)throw error;return failure('unavailable');}
      finally{data.dispose(lease);}
    },
    /** Read-only OAuth recovery for an already approved, exact command retry. */
    async resolveApproved(supplied:ApprovalRequestInput):Promise<Readonly<{approvalId:string}>|null> {
      const request=capture<ApprovalRequestInput>(supplied,75_000);
      if(request.credential.kind!=='oauth')return failure('forbidden');
      const operation=resolve(request.moduleId,request.operationId),op=operation.declaration;
      if(op.approval.mode!=='required'||op.idempotency.mode!=='required')return failure('unsupported');
      const input=capture<JsonValue>(request.input,65_536);
      if(!record(input)||operation.validateInput(input)!==true)return failure('invalid_input');
      const requestKey=input[op.idempotency.keyField];
      if(typeof requestKey!=='string'||!requestKey||new TextEncoder().encode(requestKey).length>512)
        return failure('invalid_input');
      previewFields(operation,input);
      const lease=await authorizeOperation(request.credential,operation,request.contextId,request.audience);
      try {
        const who=data.describeLease(lease);
        if(who.credentialKind!=='oauth')return failure('forbidden');
        const credential=await binding(request.credential,who);
        if(!credential.grantId||!credential.clientId)return failure('forbidden');
        const inputHash=await operationDigest(input),keyHash=await operationDigest(requestKey);
        const objectVersion=String(input[op.concurrency.versionField!]);
        const row=await options.db.prepare(`SELECT id FROM ${table} WHERE state='approved'
          AND module_id=? AND operation_id=? AND operation_digest=?
          AND actor_principal_id=? AND principal_id=? AND context_id=? AND audience=?
          AND credential_digest=? AND oauth_grant_id=? AND oauth_client_id=?
          AND input_hash=? AND request_key_hash=? AND object_version=?
          AND expires_at_ms>${NOW} LIMIT 1`).bind(operation.moduleId,op.id,operation.contractDigest,
          who.actorPrincipalId,who.principalId,who.contextId,who.audience,credential.digest,
          credential.grantId,credential.clientId,inputHash,keyHash,objectVersion).first<{id:unknown}>();
        return row&&id(row.id)?{approvalId:row.id}:null;
      }catch(error){if(error instanceof OperationError)throw error;return failure('unavailable');}
      finally{data.dispose(lease);}
    },
    async preview(supplied:ApprovalNativeInput):Promise<ApprovalPreview> {
      const input=capture<ApprovalNativeInput>(supplied,4096);
      const row=approvalRow(await select(input.approvalId)),{lease,session,operation}=await native(input,row);
      try {
        const expired=Number(row.expires_at_ms)<=Date.now();
        const state=expired?'expired':String(row.state) as ApprovalPreview['state'];
        let csrfNonce:string|null=null;
        if(state==='pending') {
          csrfNonce=crypto.randomUUID();
          const nonceDigest=await operationDigest(csrfNonce);
          const batch=await transactions.execute(lease,{write:true,after:[
            sql(`UPDATE ${table} SET decision_session_id=?,csrf_digest=?,updated_at_ms=${NOW}
              WHERE id=? AND actor_principal_id=? AND state='pending' AND expires_at_ms>${NOW}`,
            session.id,nonceDigest,input.approvalId,session.principalId),
            sql(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=? AND decision_session_id=?
              AND csrf_digest=? AND state='pending') THEN 1 ELSE json('creezio_approval_preview_failed') END AS accepted`,
            input.approvalId,session.id,nonceDigest),
          ]});
          if(!batch.after.at(-1)?.results[0])return failure('conflict');
        }
        const fields=JSON.parse(String(row.preview)) as Record<string,JsonValue>;
        return {approvalId:input.approvalId,state,expiresAtMs:Number(row.expires_at_ms),
          operation:{moduleId:operation.moduleId,operationId:operation.declaration.id,title:operation.declaration.title},
          fields:copyJson(fields,4096) as Readonly<Record<string,JsonValue>>,inputDigest:String(row.input_hash),csrfNonce,
          sessionId:session.id,principalId:session.principalId,contextId:input.contextId};
      }catch(error){if(error instanceof OperationError)throw error;return failure('unavailable');}
      finally{data.dispose(lease);}
    },
    async decide(supplied:ApprovalDecisionInput):Promise<ApprovalDecision> {
      const input=capture<ApprovalDecisionInput>(supplied,4096);
      if(!['approve','reject'].includes(input.decision)||!id(input.csrfNonce))return failure('invalid_input');
      const row=approvalRow(await select(input.approvalId)),{lease,session}=await native(input,row);
      try {
        const nonceDigest=await operationDigest(input.csrfNonce),decisionNonce=crypto.randomUUID();
        const state=input.decision==='approve'?'approved':'rejected';
        await transactions.execute(lease,{write:true,after:[
          sql(`UPDATE ${table} SET state=?,csrf_digest=NULL,decision_nonce=?,decided_at_ms=${NOW},updated_at_ms=${NOW}
            WHERE id=? AND state='pending' AND expires_at_ms>${NOW} AND decision_session_id=? AND csrf_digest=?
            AND actor_principal_id=?`,state,decisionNonce,input.approvalId,session.id,nonceDigest,session.principalId),
          sql(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=? AND state=? AND decision_nonce=?)
            THEN 1 ELSE json('creezio_approval_decision_failed') END AS accepted`,input.approvalId,state,decisionNonce),
        ]});
        return {approvalId:input.approvalId,state,expiresAtMs:Number(row.expires_at_ms)};
      }catch(error){if(error instanceof OperationError)throw error;return failure('conflict');}
      finally{data.dispose(lease);}
    },
    async prepareConsumption(supplied:ApprovalConsumptionInput):Promise<readonly SqlStatement[]> {
      const input:Object=Object.freeze({...supplied,credential:capture<DataCredential>(supplied.credential,4096),
        identity:capture<Scope>(supplied.identity,4096),approvalId:String(supplied.approvalId),
        inputHash:String(supplied.inputHash),keyHash:String(supplied.keyHash),objectVersion:supplied.objectVersion});
      const captured=input as ApprovalConsumptionInput;
      const row=approvalRow(await select(captured.approvalId)),who=captured.identity,operation=captured.operation;
      const credential=await binding(captured.credential,who),credentialHash=credential.digest;
      if(typeof captured.objectVersion!=='string'&&typeof captured.objectVersion!=='number')return failure('invalid_input');
      const objectVersion=String(captured.objectVersion);
      if(row.module_id!==operation.moduleId||row.operation_id!==operation.declaration.id
        ||row.operation_digest!==operation.contractDigest||row.actor_principal_id!==who.actorPrincipalId
        ||row.principal_id!==who.principalId||row.context_id!==who.contextId||row.audience!==who.audience
        ||row.credential_digest!==credentialHash||row.oauth_grant_id!==credential.grantId
        ||row.oauth_client_id!==credential.clientId||row.object_version!==objectVersion
        ||row.input_hash!==captured.inputHash
        ||row.request_key_hash!==captured.keyHash||row.state!=='approved'||Number(row.expires_at_ms)<=Date.now())
        return failure('forbidden');
      const nonce=crypto.randomUUID();
      const where=`id=? AND state='approved' AND module_id=? AND operation_id=? AND operation_digest=?
        AND actor_principal_id=? AND principal_id=? AND context_id=? AND audience=? AND credential_digest=?
        AND input_hash=? AND request_key_hash=? AND object_version=?
        AND oauth_grant_id IS ? AND oauth_client_id IS ? AND expires_at_ms>${NOW}`;
      const bindings=[captured.approvalId,operation.moduleId,operation.declaration.id,operation.contractDigest,
        who.actorPrincipalId,who.principalId,who.contextId,who.audience,credentialHash,captured.inputHash,captured.keyHash,
        objectVersion,credential.grantId,credential.clientId];
      return Object.freeze([
        sql(`UPDATE ${table} SET state='consumed',consumed_nonce=?,consumed_at_ms=${NOW},updated_at_ms=${NOW}
          WHERE ${where}`,nonce,...bindings),
        sql(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=? AND state='consumed' AND consumed_nonce=?)
          THEN 1 ELSE json('creezio_approval_consumption_failed') END AS accepted`,captured.approvalId,nonce),
      ]);
    },
  });
}
export type WidgetApprovalService=ReturnType<typeof createWidgetApprovalService>;
