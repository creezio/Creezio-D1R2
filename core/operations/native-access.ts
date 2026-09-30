import { createAuthorizationService } from '../authorization/service.ts';
import { NATIVE_ACCESS_PERMISSIONS, MANAGE_ACCESS, IMPERSONATE_ACCESS } from '../authorization/policy.ts';
import type { PermissionDefinition } from '../authorization/types.ts';
import { createAccountAdministrationService, createAccountAdministrationPlanService } from '../identity/administration.ts';
import { createAccessAuditService } from '../identity/audit.ts';
import {createMachineAccountPlanService} from '../identity/machines.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import type { SqlStatement } from '../data/authorization.ts';
import type { RuntimeDataCatalog } from '../data/types.ts';
import { OperationError, type OperationDeclaration, type OperationErrorCode } from './types.ts';

type Failure = { readonly ok: false; readonly error: string };
export interface NativeAccessResult { readonly output: unknown; readonly nativeStatements?: readonly SqlStatement[];
  readonly compared?: boolean; readonly storageRevocation?: NativeStorageRevocation }
/** Host-only receipt specification; the operation runner owns route inventory and fencing. */
export interface NativeStorageRevocation {
  readonly kind:'policy.apply-delta'|'principals.set-human-status'|'principals.revoke-sessions'|'sessions.revoke'
    |'service.create'|'service.status'|'service.token.issue'|'service.token.revoke';
  readonly requestKey:string;readonly auditId:string;readonly action:string;
  readonly targetPrincipalId?:string;readonly targetSessionId?:string;readonly expectedEpoch?:number;
}
const revocation=(value:NativeStorageRevocation):NativeStorageRevocation=>Object.freeze(value);

const nativeQueries = new Set(['policy.read', 'permissions.list', 'principals.list', 'sessions.list', 'audit.list',
  'audit.detail','service.token.read']);
const nativeCommands = new Set(['policy.apply-delta', 'principals.set-human-status',
  'principals.revoke-sessions', 'sessions.revoke','service.create','service.status',
  'service.token.issue','service.token.revoke']);
const identityReads = ['principals', 'human_accounts', 'password_credentials', 'sessions',
  'authorization_state', 'contexts', 'memberships', 'oauth_access_tokens', 'oauth_grants', 'oauth_clients'];
const policyReads = [...identityReads, 'roles', 'role_parents', 'role_grants', 'role_overrides',
  'role_assignments', 'principal_overrides'];
const machineReads=[...policyReads,'api_credentials','api_credential_scopes','access_audit'];
const readModels: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'policy.read': policyReads,
  'permissions.list': policyReads,
  'policy.apply-delta': policyReads,
  'principals.list': identityReads,
  'sessions.list': identityReads,
  'audit.list': [...identityReads, 'access_audit', 'access_policy_audit_details'],
  'audit.detail': [...identityReads, 'access_audit', 'access_policy_audit_details'],
  'principals.set-human-status': [...identityReads, 'account_capabilities'],
  'principals.revoke-sessions': [...identityReads, 'account_capabilities'],
  'sessions.revoke': identityReads,
  'service.create':machineReads,
  'service.status':machineReads,
  'service.token.issue':machineReads,
  'service.token.revoke':machineReads,
  'service.token.read':machineReads,
});
const writeModels: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'policy.apply-delta': ['access_audit', 'access_policy_audit_details', 'authorization_state', 'contexts',
    'memberships', 'roles', 'role_parents', 'role_grants', 'role_overrides', 'role_assignments', 'principal_overrides'],
  'principals.set-human-status': ['access_audit', 'principals', 'sessions', 'account_capabilities'],
  'principals.revoke-sessions': ['access_audit', 'principals', 'sessions', 'account_capabilities'],
  'sessions.revoke': ['access_audit', 'sessions'],
  'service.create':['access_audit','principals'],
  'service.status':['access_audit','principals','api_credentials'],
  'service.token.issue':['access_audit','api_credentials','api_credential_scopes'],
  'service.token.revoke':['access_audit','api_credentials'],
});
const exactModels = (references: OperationDeclaration['effects']['reads'], expected: readonly string[]) =>
  references.length === expected.length && new Set(references.map(item => item.id)).size === expected.length
  && references.every(item => item.moduleId === 'creezio.access' && item.kind === 'model' && expected.includes(item.id));
/** A forged/relaxed declaration cannot activate a privileged native effect. */
export function validNativeAccessDeclaration(op: OperationDeclaration): boolean {
  const query = nativeQueries.has(op.id), command = nativeCommands.has(op.id);
  const expectedVersion = op.id === 'policy.apply-delta' ? 'expectedEpoch'
    : ['principals.set-human-status','principals.revoke-sessions','service.status'].includes(op.id)
      ? 'expectedAuthVersion' : null;
  const directHuman=op.id==='service.token.issue';
  return (query || command) && op.kind === (query ? 'query' : 'command')
    && op.audiences.length === 1 && op.audiences[0] === 'admin'
    && (directHuman?op.actors.length===1&&op.actors[0]==='user'
      :op.actors.length===2&&op.actors[0]==='user'&&op.actors[1]==='delegated-user')
    && op.context === 'application'
    && op.permissions.length === 1 && op.permissions[0].moduleId === 'creezio.access'
    && op.permissions[0].kind === 'permission' && op.permissions[0].id === 'manage'
    && op.approval.mode === 'none'
    && op.concurrency.mode === (expectedVersion ? 'object-version' : 'none')
    && (!expectedVersion || op.concurrency.versionField === expectedVersion)
    && exactModels(op.effects.reads, readModels[op.id] ?? [])
    && exactModels(op.effects.writes, writeModels[op.id] ?? [])
    && op.effects.calls.length === 0 && op.effects.emits.length === 0 && op.effects.providers.length === 0
    && op.audit.required === true && op.public === false
    && op.idempotency.mode === (command ? 'required' : 'none')
    && (!command || op.idempotency.mode === 'required' && op.idempotency.keyField === 'requestKey'
      && op.idempotency.scope === 'actor-context-operation');
}

function failure(result: Failure): never {
  const code: OperationErrorCode = result.error === 'invalid_input' ? 'invalid_input'
    : result.error === 'unauthorized' ? 'unauthorized'
      : result.error === 'forbidden' ? 'forbidden'
        : result.error === 'conflict' ? 'conflict'
          : result.error === 'rate_limited' ? 'rate_limited' : 'unavailable';
  throw new OperationError(code);
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OperationError('invalid_input');
  return value as Record<string, unknown>;
};
/** Every statement comes from native T04 stores after their own validation. */
export function createNativeAccessOperationAdapter(db: IdentityDatabase, suppliedPermissions: readonly PermissionDefinition[],
  catalog: RuntimeDataCatalog) {
  const ordinaryPermissions = suppliedPermissions.filter(item => item.id !== MANAGE_ACCESS && item.id !== IMPERSONATE_ACCESS);
  const titles = new Map<string, {moduleId: string; title: string}>(catalog.modules.flatMap(module => module.permissions.map(item =>
    [`${module.moduleId}:${item.id}`, {moduleId: module.moduleId, title: item.title ?? item.id}] as const)));
  const permissions = Object.freeze([...NATIVE_ACCESS_PERMISSIONS, ...ordinaryPermissions].map(item => Object.freeze({
    id: item.id, moduleId: titles.get(item.id)?.moduleId ?? item.id.split(':')[0],
    title: titles.get(item.id)?.title ?? item.id, audiences: item.audiences, actors: item.actors,
  })));
  const orderedPermissions = Object.freeze([...permissions].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const digestPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(orderedPermissions)))
    .then(bytes => 'sha256:' + Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join(''));
  const policy = createAuthorizationService(db, {permissions: ordinaryPermissions});
  const accounts = createAccountAdministrationService(db, {permissions: ordinaryPermissions});
  const accountPlans = createAccountAdministrationPlanService(db, {permissions: ordinaryPermissions});
  const audit = createAccessAuditService(db, {permissions: ordinaryPermissions});
  const machines=createMachineAccountPlanService(db,{permissions:ordinaryPermissions});
  async function execute(operationId: string, credential: {readonly kind: 'session' | 'oauth'; readonly token: unknown; readonly resource?: string},
    inputValue: unknown,sourceAuditId?:string): Promise<NativeAccessResult> {
    const token: unknown = credential.kind === 'session' ? credential.token : credential;
    const input = record(inputValue);
    switch (operationId) {
      case 'policy.read': {
        const result = await policy.readPolicy(token);
        if (!result.ok) return failure(result);
        return {output: {epoch: result.epoch, policy: result.policy}};
      }
      case 'permissions.list': {
        const result = await policy.readPolicy(token);
        if (!result.ok) return failure(result);
        const limit = input.limit, afterId = input.afterId ?? null;
        if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 50
          || afterId !== null && (typeof afterId !== 'string' || afterId.length > 256)) throw new OperationError('invalid_input');
        const rows = orderedPermissions.filter(item => afterId === null || item.id > afterId);
        const items = rows.slice(0, Number(limit));
        return {output: {items, nextAfterId: rows.length > Number(limit) ? items.at(-1)!.id : null,
          catalogDigest: await digestPromise}};
      }
      case 'principals.list': {
        const result = await accounts.listPrincipals(token, {afterId: input.afterId ?? null, limit: input.limit, kind: input.kind});
        if (!result.ok) return failure(result);
        return {output: {items: result.items, nextAfterId: result.nextAfterId}};
      }
      case 'sessions.list': {
        const result = await accounts.listSessions(token, {principalId: input.principalId,
          afterId: input.afterId ?? null, limit: input.limit});
        if (!result.ok) return failure(result);
        return {output: {items: result.items, nextAfterId: result.nextAfterId}};
      }
      case 'audit.list': {
        const before = input.beforeCreatedAtMs === undefined && input.beforeId === undefined ? null
          : {createdAtMs: input.beforeCreatedAtMs, id: input.beforeId};
        const result = await audit.list(token, {limit: input.limit, before});
        if (!result.ok) return failure(result);
        return {output: {items: result.items, nextCursor: result.nextCursor}};
      }
      case 'audit.detail': {
        const result = await audit.detail(token, {auditId: input.auditId, limit: input.limit,
          afterIndex: input.afterIndex ?? null});
        if (!result.ok) return failure(result);
        return {output: {auditId: result.auditId, fromEpoch: result.fromEpoch, toEpoch: result.toEpoch,
          changes: result.changes, nextAfterIndex: result.nextAfterIndex}};
      }
      case 'policy.apply-delta': {
        const result = await policy.preparePolicyDelta(token, input,sourceAuditId);
        if (!result.ok) return failure(result);
        return {output: result.output, nativeStatements: result.statements, compared: true,
          storageRevocation:revocation({kind:'policy.apply-delta',requestKey:String(input.requestKey),
            auditId:result.auditId,action:'authorization-updated',expectedEpoch:Number(input.expectedEpoch)})};
      }
      case 'principals.set-human-status': {
        const result = await accountPlans.prepareSetHumanStatus(token, {principalId: input.principalId,
          expectedAuthVersion: input.expectedAuthVersion, status: input.status},sourceAuditId);
        if (!result.ok) return failure(result);
        return {output: result.output, nativeStatements: [...result.statements, result.assertion], compared: true,
          storageRevocation:revocation({kind:'principals.set-human-status',requestKey:String(input.requestKey),
            auditId:result.auditId,action:'human-status-updated',targetPrincipalId:String(input.principalId)})};
      }
      case 'principals.revoke-sessions': {
        const result = await accountPlans.prepareRevokeAllHumanSessions(token, {principalId: input.principalId,
          expectedAuthVersion: input.expectedAuthVersion},sourceAuditId);
        if (!result.ok) return failure(result);
        return {output: result.output, nativeStatements: [...result.statements, result.assertion], compared: true,
          storageRevocation:revocation({kind:'principals.revoke-sessions',requestKey:String(input.requestKey),
            auditId:result.auditId,action:'human-sessions-revoked',targetPrincipalId:String(input.principalId)})};
      }
      case 'sessions.revoke': {
        const result = await accountPlans.prepareRevokeSessionById(token, {sessionId: input.sessionId},sourceAuditId);
        if (!result.ok) return failure(result);
        return {output: result.output, nativeStatements: [...result.statements, result.assertion],
          storageRevocation:revocation({kind:'sessions.revoke',requestKey:String(input.requestKey),
            auditId:result.auditId,action:'human-session-revoked',targetSessionId:String(input.sessionId)})};
      }
      case 'service.create': {
        const result=await machines.prepareCreateService(token,{displayName:input.displayName},sourceAuditId);
        if(!result.ok)return failure(result);
        return {output:result.output,nativeStatements:result.statements,
          storageRevocation:revocation({kind:'service.create',requestKey:String(input.requestKey),
            auditId:result.auditId,action:'service-created',
            targetPrincipalId:result.output.principal.id})};
      }
      case 'service.status': {
        const result=await machines.prepareSetServiceStatus(token,{principalId:input.principalId,
          expectedAuthVersion:input.expectedAuthVersion,status:input.status},sourceAuditId);
        if(!result.ok)return failure(result);
        return {output:result.output,nativeStatements:result.statements,compared:true,
          storageRevocation:revocation({kind:'service.status',requestKey:String(input.requestKey),
            auditId:result.auditId,action:'service-status-updated',targetPrincipalId:String(input.principalId)})};
      }
      case 'service.token.issue': {
        if(credential.kind!=='session')throw new OperationError('forbidden');
        const result=await machines.prepareIssueToken(token,{principalId:input.principalId,
          label:input.label,ttlMs:input.ttlMs,scopes:input.scopes,apiToken:input.apiToken},sourceAuditId);
        if(!result.ok)return failure(result);
        return {output:result.output,nativeStatements:result.statements,
          storageRevocation:revocation({kind:'service.token.issue',requestKey:String(input.requestKey),
            auditId:result.auditId,action:'api-token-issued',targetPrincipalId:String(input.principalId)})};
      }
      case 'service.token.revoke': {
        const result=await machines.prepareRevokeToken(token,{credentialId:input.credentialId},sourceAuditId);
        if(!result.ok)return failure(result);
        return {output:result.output,nativeStatements:result.statements,
          storageRevocation:revocation({kind:'service.token.revoke',requestKey:String(input.requestKey),
            auditId:result.auditId,action:'api-token-revoked'})};
      }
      case 'service.token.read': {
        const result=await machines.readTokenMetadata(token,{credentialId:input.credentialId});
        if(!result.ok)return failure(result);
        return {output:{credential:result.credential}};
      }
      default: throw new OperationError('not_found');
    }
  }
  return Object.freeze({execute});
}
