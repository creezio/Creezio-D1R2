import { ACCESS_TABLES, createD1IdentityStore, normalizeLoginIdentifier, type IdentityDatabase } from './d1-store.ts';
import { createD1AccountLifecycleStore, type LifecycleGuard } from './lifecycle-store.ts';
import { validNewPassword } from './accounts.ts';
import { hashPassword,verifyPassword } from './password.ts';
import { digestOpaqueToken, issueOpaqueToken } from './tokens.ts';
import { identityInputFields, identityAdmissionKey, normalizeDisplayName, validIdentityId } from './input.ts';
import { authorize } from '../authorization/authorize.ts';
import { policySnapshot } from '../authorization/policy.ts';
import { ACCESS_MANAGEMENT, createNativeAuthorizationResolver } from '../authorization/resolver.ts';
import type { PermissionDefinition } from '../authorization/types.ts';
import type {StorageMutationPort} from '../storage-authority/native-mutation.ts';

export const LIFECYCLE_POLICY = Object.freeze({ invitationTtlMs: 24 * 60 * 60 * 1000,
  activationTtlMs: 60 * 60 * 1000, resetTtlMs: 15 * 60 * 1000,
  admissionWindowMs: 60_000, administrationGlobalLimit: 60, administrationActorLimit: 20,
  redemptionGlobalLimit: 60, redemptionTokenLimit: 5 });
type Purpose = 'invitation' | 'activation' | 'password-reset';
type Failure = Readonly<{ ok: false; error: 'invalid_input' | 'unauthorized' | 'forbidden' | 'conflict'
  | 'unavailable' | 'rate_limited' | 'storage_error' }>;
const fail = (error: Failure['error']): Failure => Object.freeze({ ok: false, error });
const validPurpose = (value: unknown): value is Purpose => value === 'invitation' || value === 'activation' || value === 'password-reset';

/** Native identity operations shared by future transports. Raw capabilities are
 * returned once to an authenticated access administrator for explicit delivery.
 * Never wire issuance to an anonymous "forgot password" request. A future delivery
 * adapter must own the verified recipient and return a non-enumerating response.
 * Activation creates no session, membership or role; login and ACL remain separate. */
export function createAccountLifecycleService(db: IdentityDatabase, options: {
  permissions: readonly PermissionDefinition[];storageMutation?:StorageMutationPort }) {
  const store = createD1AccountLifecycleStore(db), identity = createD1IdentityStore(db);
  const { resolve, permissions } = createNativeAuthorizationResolver(db, options);
  async function admitted(domain: string, value: string, globalLimit: number, perSubjectLimit: number) {
    const windowMs = LIFECYCLE_POLICY.admissionWindowMs;
    return (await identity.consumeThrottle({ key: await identityAdmissionKey(`${domain}-global`), limit: globalLimit, windowMs })).allowed
      && (await identity.consumeThrottle({ key: await identityAdmissionKey(`${domain}-subject`, value), limit: perSubjectLimit, windowMs })).allowed;
  }
  async function administration(token: unknown): Promise<{ ok: true; guard: LifecycleGuard } | Failure> {
    const current = await resolve(token, 'admin');
    if (!current) return fail('unauthorized');
    if (!authorize(policySnapshot(current.policy, permissions, current.session), ACCESS_MANAGEMENT, current.nowMs).allowed)
      return fail('forbidden');
    if (!await admitted('account-administration', current.session.principalId,
      LIFECYCLE_POLICY.administrationGlobalLimit, LIFECYCLE_POLICY.administrationActorLimit)) return fail('rate_limited');
    return { ok: true, guard: Object.freeze({ sessionDigest: current.digest, sessionId: current.session.id,
      principalId: current.session.principalId, epoch: current.epoch }) };
  }
  async function issueInvitation(token: unknown, input: unknown) {
    if (!identityInputFields(input, ['loginIdentifier', 'displayName'])) return fail('invalid_input');
    const loginIdentifier = normalizeLoginIdentifier(input.loginIdentifier), displayName = normalizeDisplayName(input.displayName);
    if (!loginIdentifier || !displayName) return fail('invalid_input');
    try {
      const authority = await administration(token);
      if (!authority.ok) return authority;
      const issued = await issueOpaqueToken('invitation');
      const result = await store.issueInvitation(authority.guard, { digest: issued.digest, loginIdentifier, displayName,
        ttlMs: LIFECYCLE_POLICY.invitationTtlMs });
      return result ? Object.freeze({ ok: true as const, ...result, purpose: 'invitation' as const, token: issued.token }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function issueForAccount(token: unknown, input: unknown, purpose: 'activation' | 'password-reset') {
    if (!identityInputFields(input, ['principalId']) || !validIdentityId(input.principalId)) return fail('invalid_input');
    const principalId = input.principalId;
    try {
      const authority = await administration(token);
      if (!authority.ok) return authority;
      const issued = await issueOpaqueToken(purpose);
      const result = await store.issueCapability(authority.guard, { purpose, digest: issued.digest, principalId,
        ttlMs: purpose === 'activation' ? LIFECYCLE_POLICY.activationTtlMs : LIFECYCLE_POLICY.resetTtlMs });
      return result ? Object.freeze({ ok: true as const, ...result, purpose, token: issued.token }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function revokeCapability(token: unknown, input: unknown) {
    if (!identityInputFields(input, ['capabilityId']) || !validIdentityId(input.capabilityId)) return fail('invalid_input');
    const capabilityId = input.capabilityId;
    try {
      const authority = await administration(token);
      if (!authority.ok) return authority;
      return await store.revokeCapability(authority.guard, capabilityId) ? Object.freeze({ ok: true as const }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function redeem(input: unknown) {
    if (!identityInputFields(input, ['token', 'purpose', 'password']) || !validPurpose(input.purpose)
      || !validNewPassword(input.password)) return fail('invalid_input');
    // Capture all validated scalar inputs before the first await.
    const purpose = input.purpose, token = input.token, password = input.password;
    try {
      const digest = await digestOpaqueToken(token, purpose);
      if (!digest) return fail('unavailable');
      if (!await admitted('account-redemption', digest, LIFECYCLE_POLICY.redemptionGlobalLimit,
        LIFECYCLE_POLICY.redemptionTokenLimit)) return fail('rate_limited');
      if (!options.storageMutation&&!await store.readCapability(digest, purpose)) return fail('unavailable');
      const passwordRecord = hashPassword(password);
      if(options.storageMutation){
        const commandKey=JSON.stringify([digest,purpose]);
        const kind=`lifecycle.${purpose}`;
        const auditId=await options.storageMutation.receiptId(kind,commandKey);
        const action=purpose==='password-reset'?'password-reset':'account-activated';
        const receipt=async()=>await db.prepare(`SELECT target_principal_id AS principalId FROM "${ACCESS_TABLES.access_audit}"
          WHERE id=? AND action=? LIMIT 2`).bind(auditId,action).first();
        const outcome=await options.storageMutation.commit({kind,commandKey,
          sourceCommit:()=>store.consumeCapability({digest,purpose,passwordRecord},auditId),
          committed:value=>value!==null,
          inspectSource:async()=>typeof (await receipt())?.principalId==='string',
          recoverValue:async()=>{
            const audit=await receipt();
            if(typeof audit?.principalId!=='string')return null;
            const stored=await db.prepare(`SELECT password_record AS record FROM "${ACCESS_TABLES.password_credentials}"
              WHERE principal_id=? LIMIT 2`).bind(audit.principalId).first();
            return verifyPassword(password,stored?.record)?{principalId:audit.principalId}:null;
          }});
        return outcome.state==='confirmed'&&outcome.value
          ?Object.freeze({ok:true as const,principalId:outcome.value.principalId}):fail('storage_error');
      }
      const result = await store.consumeCapability({ digest, purpose, passwordRecord });
      return result ? Object.freeze({ ok: true as const, principalId: result.principalId }) : fail('unavailable');
    } catch { return fail('storage_error'); }
  }
  return Object.freeze({ issueInvitation,
    issueActivation: (token: unknown, input: unknown) => issueForAccount(token, input, 'activation'),
    issuePasswordReset: (token: unknown, input: unknown) => issueForAccount(token, input, 'password-reset'),
    revokeCapability, redeem });
}
