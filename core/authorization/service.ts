import { authorize, copyAuthorizationTarget } from './authorize.ts';
import { createD1AuthorizationStore } from './d1-store.ts';
import { addsRetiredPermissionReferences, exactRecord, parseAccessPolicy,
  policySnapshot, validPolicyCatalog } from './policy.ts';
import type { AccessPolicy } from './policy.ts';
import type { AuthorizationDecision, AuthorizationTarget, PermissionDefinition } from './types.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import { ACCESS_MANAGEMENT as MANAGEMENT, createNativeAuthorizationResolver } from './resolver.ts';
import { ACCESS_DELTA_LIMITS, applyAccessPolicyChanges, parseAccessPolicyChanges } from './delta.ts';
import {ACCESS_TABLES} from '../identity/d1-store.ts';
import type {StorageMutationPort} from '../storage-authority/native-mutation.ts';

type Failure = { readonly ok: false; readonly error: 'invalid_input' | 'unauthorized' | 'forbidden' | 'conflict' | 'storage_error' };
const fail = (error: Failure['error']): Failure => Object.freeze({ ok: false, error });
/** Server composition supplies the catalog; callers never choose permission definitions or actor identities. */
export function createAuthorizationService(db: IdentityDatabase, options: {
  permissions: readonly PermissionDefinition[]; storageMutation?: StorageMutationPort }) {
  const { permissions, resolve: state, resolveAdminAuthority: adminState } = createNativeAuthorizationResolver(db, options);
  const store = createD1AuthorizationStore(db);
  async function check(token: unknown, target: AuthorizationTarget): Promise<AuthorizationDecision> {
    try {
      const captured = copyAuthorizationTarget(target);
      if (!captured)
        return Object.freeze({ allowed: false, reason: 'invalid_target' });
      const current = await state(token, captured.audience);
      if (!current) return Object.freeze({ allowed: false, reason: 'credential_disabled' });
      return authorize(policySnapshot(current.policy, permissions, current.session), captured, current.nowMs);
    } catch { return Object.freeze({ allowed: false, reason: 'invalid_snapshot' }); }
  }
  async function readPolicy(token: unknown): Promise<{ok: true; epoch: number; policy: AccessPolicy} | Failure> {
    try {
      const current = await adminState(token);
      if (!current) return fail('unauthorized');
      if (!authorize(current.snapshot, MANAGEMENT, current.nowMs).allowed)
        return fail('forbidden');
      return Object.freeze({ ok: true, epoch: current.epoch, policy: current.policy });
    } catch { return fail('storage_error'); }
  }
  async function replacePolicy(token: unknown, input: unknown): Promise<{ok: true; epoch: number} | Failure> {
    if (!exactRecord(input, ['expectedEpoch', 'policy']) || !Number.isSafeInteger(input.expectedEpoch)
      || Number(input.expectedEpoch) < 1 || Number(input.expectedEpoch) >= Number.MAX_SAFE_INTEGER) return fail('invalid_input');
    const expectedEpoch = Number(input.expectedEpoch);
    const policy = parseAccessPolicy(input.policy);
    if (!policy || !validPolicyCatalog(policy, permissions)) return fail('invalid_input');
    try {
      const current = await adminState(token);
      if (!current) return fail('unauthorized');
      if (!authorize(current.snapshot, MANAGEMENT, current.nowMs).allowed)
        return fail('forbidden');
      if (current.epoch !== expectedEpoch) return fail('conflict');
      if (addsRetiredPermissionReferences(current.policy,policy,permissions)) return fail('invalid_input');
      const principals = new Set(current.principals.map(p => p.id));
      if (policy.memberships.some(m => !principals.has(m.principalId))
        || current.policy.contexts.some(c => !policy.contexts.some(next => next.id === c.id))) return fail('invalid_input');
      // Initial administrative editor cannot lock itself out. Transfer/delegated
      // administration needs a separate operation, not an implicit exception.
      if (!authorize(current.snapshotFor(policy), MANAGEMENT, current.nowMs).allowed)
        return fail('forbidden');
      const change={ guard: current.guard, policy, beforePolicy: current.policy };
      if(options.storageMutation){
        const commandKey=JSON.stringify([current.principalId,expectedEpoch,policy]);
        const plan=store.preparePolicyCommit(change,
          await options.storageMutation.receiptId('policy.replace',commandKey));
        const outcome=await options.storageMutation.commit({kind:'policy.replace',
          commandKey,
          sourceCommit:()=>store.commitPreparedPolicy(plan),committed:value=>value===true,
          recoverValue:async()=>true,
          inspectSource:async()=>{
            const receipt=await db.prepare(`SELECT 1 AS ok FROM "${ACCESS_TABLES.access_policy_audit_details}"
              WHERE audit_id=? AND from_epoch=? AND to_epoch=? LIMIT 2`)
              .bind(plan.auditId,expectedEpoch,expectedEpoch+1).first();
            return receipt?.ok===1;
          }});
        return outcome.state==='confirmed'?Object.freeze({ok:true,epoch:current.epoch+1}):fail('storage_error');
      }
      const committed = await store.commitPolicy(change);
      return committed ? Object.freeze({ ok: true, epoch: current.epoch + 1 }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  /** Host-only plan. The ordinary T04 service and T06 operation use the same graph checks and store. */
  async function preparePolicyDelta(token: unknown, input: unknown,sourceAuditId?:string) {
    if (!exactRecord(input, ['requestKey', 'expectedEpoch', 'changes'])
      || typeof input.requestKey !== 'string' || !input.requestKey || new TextEncoder().encode(input.requestKey).length > 512
      || !Number.isSafeInteger(input.expectedEpoch) || Number(input.expectedEpoch) < 1
      || Number(input.expectedEpoch) >= Number.MAX_SAFE_INTEGER) return fail('invalid_input');
    let bytes: number;
    try { bytes = new TextEncoder().encode(JSON.stringify(input)).length; } catch { return fail('invalid_input'); }
    if (bytes > ACCESS_DELTA_LIMITS.inputBytes) return fail('invalid_input');
    const changes = parseAccessPolicyChanges(input.changes);
    if (!changes) return fail('invalid_input');
    try {
      const current = await adminState(token);
      if (!current) return fail('unauthorized');
      if (!authorize(current.snapshot, MANAGEMENT, current.nowMs).allowed)
        return fail('forbidden');
      if (current.epoch !== input.expectedEpoch) return fail('conflict');
      const policy = applyAccessPolicyChanges(current.policy, changes);
      if (!policy || !validPolicyCatalog(policy, permissions)) return fail('invalid_input');
      if (addsRetiredPermissionReferences(current.policy,policy,permissions)) return fail('invalid_input');
      const principals = new Set(current.principals.map(p => p.id));
      if (policy.memberships.some(m => !principals.has(m.principalId))) return fail('invalid_input');
      if (!authorize(current.snapshotFor(policy), MANAGEMENT, current.nowMs).allowed)
        return fail('forbidden');
      const plan = store.preparePolicyCommit({guard: current.guard, policy, beforePolicy: current.policy},sourceAuditId);
      return Object.freeze({ok: true as const, statements: Object.freeze([...plan.statements, plan.assertion]),
        auditId:plan.auditId,
        output: Object.freeze({epoch: current.epoch + 1, auditId: plan.auditId, changedCount: changes.length})});
    } catch { return fail('storage_error'); }
  }
  return Object.freeze({ check, readPolicy, replacePolicy, preparePolicyDelta });
}
