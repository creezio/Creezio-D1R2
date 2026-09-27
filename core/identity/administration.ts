import { createD1AccountAdministrationStore, ADMINISTRATION_STORE_LIMITS, type AdministrativePrincipal, type AdministrativeSession,
  type AdministrationPage, type PrincipalPageInput, type SessionPageInput, type HumanVersionInput, type HumanStatusInput } from './administration-store.ts';
import { createD1IdentityStore, type IdentityDatabase } from './d1-store.ts';
import { identityAdmissionKey, identityInputFields, validIdentityId } from './input.ts';
import { ACCESS_MANAGEMENT, createNativeAuthorizationResolver } from '../authorization/resolver.ts';
import { authorize } from '../authorization/authorize.ts';
import type { AuthorizationDecision, PermissionDefinition } from '../authorization/types.ts';

export const ADMINISTRATION_POLICY = Object.freeze({
  admissionWindowMs: 60_000,
  administrationGlobalLimit: 60,
  administrationActorLimit: 20,
});

type Failure = Readonly<{ ok: false; error: 'invalid_input' | 'unauthorized' | 'forbidden' | 'conflict' | 'rate_limited' | 'storage_error' }>;
const fail = (error: Failure['error']): Failure => Object.freeze({ ok: false, error });

const validPageLimit = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1
  && Number(value) <= ADMINISTRATION_STORE_LIMITS.maximumPageSize;
const validCursor = (value: unknown): value is string | null => value === null || validIdentityId(value);
const validKind = (value: unknown): value is PrincipalPageInput['kind'] => value === 'human' || value === 'service' || value === 'all';
const validStatus = (value: unknown): value is HumanStatusInput['status'] => value === 'active' || value === 'disabled';

/**
 * Native administration operations over human accounts and sessions. This is an
 * internal service boundary: HTTP, cookies and MCP adapters must validate their
 * own transport and then call these methods. A session or authorization snapshot
 * is never returned as a write permit; the D1 store rechecks it in each batch.
 */
function createAccountAdministrationServices(db: IdentityDatabase, options: { permissions: readonly PermissionDefinition[] }) {
  const store = createD1AccountAdministrationStore(db);
  const identity = createD1IdentityStore(db);
  const { resolveAdminAuthority } = createNativeAuthorizationResolver(db, options);

  async function administration(token: unknown) {
    const current = await resolveAdminAuthority(token);
    if (!current) return fail('unauthorized');
    const decision: AuthorizationDecision = authorize(current.snapshot, ACCESS_MANAGEMENT, current.nowMs);
    if (!decision.allowed) return fail('forbidden');
    const windowMs = ADMINISTRATION_POLICY.admissionWindowMs;
    const global = await identity.consumeThrottle({
      key: await identityAdmissionKey('account-administration-global'),
      limit: ADMINISTRATION_POLICY.administrationGlobalLimit,
      windowMs,
    });
    if (!global.allowed) return fail('rate_limited');
    const actor = await identity.consumeThrottle({
      // Share the existing account-lifecycle admission bucket for this actor.
      key: await identityAdmissionKey('account-administration-subject', current.principalId),
      limit: ADMINISTRATION_POLICY.administrationActorLimit,
      windowMs,
    });
    if (!actor.allowed) return fail('rate_limited');
    return Object.freeze({
      ok: true as const,
      guard: current.guard,
    });
  }

  function principalPageInput(value: unknown): PrincipalPageInput | null {
    if (!identityInputFields(value, ['afterId', 'limit', 'kind']) || !validCursor(value.afterId)
      || !validPageLimit(value.limit) || !validKind(value.kind)) return null;
    return Object.freeze({ afterId: value.afterId, limit: Number(value.limit), kind: value.kind });
  }
  function sessionPageInput(value: unknown): SessionPageInput | null {
    if (!identityInputFields(value, ['principalId', 'afterId', 'limit']) || !validIdentityId(value.principalId)
      || !validCursor(value.afterId) || !validPageLimit(value.limit)) return null;
    return Object.freeze({ principalId: value.principalId, afterId: value.afterId, limit: Number(value.limit) });
  }
  function versionInput(value: unknown): HumanVersionInput | null {
    if (!identityInputFields(value, ['principalId', 'expectedAuthVersion']) || !validIdentityId(value.principalId)
      || !Number.isSafeInteger(value.expectedAuthVersion) || Number(value.expectedAuthVersion) < 1
      || Number(value.expectedAuthVersion) >= Number.MAX_SAFE_INTEGER) return null;
    return Object.freeze({ principalId: value.principalId, expectedAuthVersion: Number(value.expectedAuthVersion) });
  }
  function statusInput(value: unknown): HumanStatusInput | null {
    if (!identityInputFields(value, ['principalId', 'expectedAuthVersion', 'status']) || !validIdentityId(value.principalId)
      || !Number.isSafeInteger(value.expectedAuthVersion) || Number(value.expectedAuthVersion) < 1
      || Number(value.expectedAuthVersion) >= Number.MAX_SAFE_INTEGER || !validStatus(value.status)) return null;
    return Object.freeze({ principalId: value.principalId, expectedAuthVersion: Number(value.expectedAuthVersion), status: value.status });
  }
  function sessionInput(value: unknown): { readonly sessionId: string } | null {
    if (!identityInputFields(value, ['sessionId']) || !validIdentityId(value.sessionId)) return null;
    return Object.freeze({ sessionId: value.sessionId });
  }

  async function listPrincipals(token: unknown, input: unknown): Promise<Failure | (Readonly<{ ok: true }> & AdministrationPage<AdministrativePrincipal>)> {
    const captured = principalPageInput(input);
    if (!captured) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      const page = await store.listPrincipals(current.guard, captured);
      return page ? Object.freeze({ ok: true as const, ...page }) : fail('unauthorized');
    } catch { return fail('storage_error'); }
  }

  async function listSessions(token: unknown, input: unknown): Promise<Failure | (Readonly<{ ok: true }> & AdministrationPage<AdministrativeSession>)> {
    const captured = sessionPageInput(input);
    if (!captured) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      const page = await store.listSessions(current.guard, captured);
      return page ? Object.freeze({ ok: true as const, ...page }) : fail('unauthorized');
    } catch { return fail('storage_error'); }
  }

  async function setHumanStatus(token: unknown, input: unknown): Promise<Failure | Readonly<{ ok: true; principal: AdministrativePrincipal }>> {
    const captured = statusInput(input);
    if (!captured) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      const principal = await store.setHumanStatus(current.guard, captured);
      return principal ? Object.freeze({ ok: true as const, principal }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }

  async function revokeAllHumanSessions(token: unknown, input: unknown): Promise<Failure | Readonly<{ ok: true; principalId: string; authVersion: number }>> {
    const captured = versionInput(input);
    if (!captured) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      const result = await store.revokeAllHumanSessions(current.guard, captured);
      return result ? Object.freeze({ ok: true as const, ...result }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }

  async function revokeSessionById(token: unknown, input: unknown): Promise<Failure | Readonly<{ ok: true }>> {
    const captured = sessionInput(input);
    if (!captured) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      return await store.revokeSessionById(current.guard, captured)
        ? Object.freeze({ ok: true as const }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }

  /** Host executor only: prepare T04's guarded writes for the T06 commit batch. */
  async function prepareSetHumanStatus(token: unknown, input: unknown) {
    const captured = statusInput(input);
    if (!captured) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      const plan = store.prepareSetHumanStatus(current.guard, captured);
      return plan ? Object.freeze({ok: true as const, ...plan}) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function prepareRevokeAllHumanSessions(token: unknown, input: unknown) {
    const captured = versionInput(input);
    if (!captured) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      return Object.freeze({ok: true as const, ...store.prepareRevokeAllHumanSessions(current.guard, captured)});
    } catch { return fail('storage_error'); }
  }
  async function prepareRevokeSessionById(token: unknown, input: unknown) {
    const captured = sessionInput(input);
    if (!captured) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      return Object.freeze({ok: true as const, ...store.prepareRevokeSessionById(current.guard, captured)});
    } catch { return fail('storage_error'); }
  }

  // Keep the explicit store verb in the service surface so the transport cannot
  // confuse a targeted session revocation with the version-wide operation.
  return Object.freeze({publicService: Object.freeze({ listPrincipals, listSessions, setHumanStatus,
    revokeAllHumanSessions, revokeSessionById }), hostPlans: Object.freeze({prepareSetHumanStatus,
    prepareRevokeAllHumanSessions, prepareRevokeSessionById})});
}

export function createAccountAdministrationService(db: IdentityDatabase, options: { permissions: readonly PermissionDefinition[] }) {
  return createAccountAdministrationServices(db, options).publicService;
}

/** Host-only bridge for committing T04 effects with an operation execution. */
export function createAccountAdministrationPlanService(db: IdentityDatabase, options: { permissions: readonly PermissionDefinition[] }) {
  return createAccountAdministrationServices(db, options).hostPlans;
}
