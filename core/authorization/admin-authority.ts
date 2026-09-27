import {ACCESS_TABLES} from '../identity/d1-store.ts';
import type {LifecycleGuard} from '../identity/lifecycle-store.ts';
import type {SqlStatement} from '../data/authorization.ts';
import {MANAGE_ACCESS} from './policy.ts';
import {oauthAccessCondition, type OAuthAccessGuard} from './oauth-guard.ts';

export type AccessAdminGuard = Readonly<({kind: 'session'} & LifecycleGuard) | ({kind: 'oauth'} & OAuthAccessGuard)>;

const t = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, `"${name}"`])) as Record<keyof typeof ACCESS_TABLES, string>;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const epoch = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function shape(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(own).length === names.length
    && names.every(name => own[name]?.enumerable && Object.hasOwn(own[name], 'value'));
}

/** Only a server-resolved credential may be turned into a guarded D1 authority. */
export function captureAccessAdminGuard(value: unknown): AccessAdminGuard {
  // Preserve existing session-only store callers while producing one normalized discriminant.
  if (shape(value, ['sessionDigest', 'sessionId', 'principalId', 'epoch'])
    || shape(value, ['kind', 'sessionDigest', 'sessionId', 'principalId', 'epoch']) && value.kind === 'session') {
    if (!digest(value.sessionDigest) || !id(value.sessionId) || !id(value.principalId) || !epoch(value.epoch))
      throw new TypeError('Invalid Access admin guard.');
    return Object.freeze({kind: 'session', sessionDigest: value.sessionDigest, sessionId: value.sessionId,
      principalId: value.principalId, epoch: value.epoch});
  }
  const fields = ['kind', 'digest', 'credentialId', 'grantId', 'clientId', 'principalId', 'epoch',
    'contextId', 'audience', 'resource', 'permissionIds'];
  if (!shape(value, fields) || value.kind !== 'oauth' || !digest(value.digest) || !id(value.credentialId)
    || !id(value.grantId) || typeof value.clientId !== 'string' || !value.clientId || value.clientId.length > 2048
    || !id(value.principalId) || !epoch(value.epoch) || value.contextId !== 'application'
    || value.audience !== 'admin' || typeof value.resource !== 'string'
    || !/^https?:\/\//.test(value.resource) || !Array.isArray(value.permissionIds)
    || !value.permissionIds.includes(MANAGE_ACCESS) || value.permissionIds.length > 128
    || value.permissionIds.some(permission => typeof permission !== 'string')) throw new TypeError('Invalid Access admin guard.');
  return Object.freeze({...value, permissionIds: Object.freeze([...value.permissionIds])}) as AccessAdminGuard;
}

/** Same fresh predicate for Access reads, audit claims and T06's atomic commit. */
export function accessAdminCondition(value: AccessAdminGuard): SqlStatement {
  const guard = captureAccessAdminGuard(value);
  if (guard.kind === 'oauth') return oauthAccessCondition(guard);
  return Object.freeze({sql: `EXISTS(SELECT 1 FROM ${t.sessions} s
    JOIN ${t.principals} p ON p.id=s.principal_id
    JOIN ${t.human_accounts} h ON h.principal_id=p.id
    JOIN ${t.password_credentials} c ON c.principal_id=p.id
    JOIN ${t.authorization_state} a ON a.id='application'
    WHERE s.secret_hash=? AND s.id=? AND p.id=? AND a.epoch=? AND s.audience='admin'
      AND s.revoked_at_ms IS NULL AND s.expires_at_ms>${NOW}
      AND p.kind='human' AND p.status='active' AND h.status='active'
      AND s.auth_version=p.auth_version AND s.account_version=h.version AND s.credential_version=c.version
      AND (c.expires_at_ms IS NULL OR c.expires_at_ms>${NOW})
      AND EXISTS(SELECT 1 FROM ${t.contexts} ctx WHERE ctx.id='application' AND ctx.status='active')
      AND EXISTS(SELECT 1 FROM ${t.memberships} m WHERE m.principal_id=p.id AND m.context_id='application'
        AND m.audience='admin' AND m.status='active'))`,
    bindings: Object.freeze([guard.sessionDigest, guard.sessionId, guard.principalId, guard.epoch])});
}
