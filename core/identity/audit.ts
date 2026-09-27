import {createD1AccessAuditStore, ACCESS_AUDIT_LIMITS} from './audit-store.ts';
import type {IdentityDatabase} from './d1-store.ts';
import {identityInputFields, validIdentityId} from './input.ts';
import {createNativeAuthorizationResolver, ACCESS_MANAGEMENT} from '../authorization/resolver.ts';
import {authorize} from '../authorization/authorize.ts';
import type {PermissionDefinition} from '../authorization/types.ts';
import type {AccessAdminAuditCursor, AccessAdminAuditDetailPage,
  AccessAdminAuditPage} from '../../sdk/access/admin-types.ts';

type Failure = Readonly<{ok: false; error: 'invalid_input' | 'unauthorized' | 'forbidden' | 'not_found' | 'storage_error'}>;
const fail = (error: Failure['error']): Failure => Object.freeze({ok: false, error});
const validLimit = (value: unknown, maximum: number): value is number => Number.isSafeInteger(value)
  && Number(value) >= 1 && Number(value) <= maximum;
const validCursor = (value: unknown): value is AccessAdminAuditCursor | null => value === null
  || identityInputFields(value, ['createdAtMs', 'id']) && Number.isSafeInteger(value.createdAtMs)
    && Number(value.createdAtMs) >= 0 && validIdentityId(value.id);

/** Authorized native audit reads, independent of the HTTP/T06 adapter. */
export function createAccessAuditService(db: IdentityDatabase, options: {permissions: readonly PermissionDefinition[]}) {
  const store = createD1AccessAuditStore(db);
  const {resolveAdminAuthority} = createNativeAuthorizationResolver(db, options);
  async function actor(token: unknown) {
    const current = await resolveAdminAuthority(token);
    if (!current) return fail('unauthorized');
    if (!authorize(current.snapshot, ACCESS_MANAGEMENT, current.nowMs).allowed)
      return fail('forbidden');
    return Object.freeze({ok: true as const, guard: current.guard});
  }
  async function list(token: unknown, input: unknown): Promise<Failure | (Readonly<{ok: true}> & AccessAdminAuditPage)> {
    if (!identityInputFields(input, ['limit', 'before']) || !validLimit(input.limit, ACCESS_AUDIT_LIMITS.listPage)
      || !validCursor(input.before)) return fail('invalid_input');
    try {
      const current = await actor(token); if (!current.ok) return current;
      const page = await store.list(current.guard, {limit: input.limit, before: input.before});
      return page ? Object.freeze({ok: true as const, ...page}) : fail('unauthorized');
    } catch {return fail('storage_error');}
  }
  async function detail(token: unknown, input: unknown):
    Promise<Failure | (Readonly<{ok: true}> & AccessAdminAuditDetailPage)> {
    if (!identityInputFields(input, ['auditId', 'limit', 'afterIndex']) || !validIdentityId(input.auditId)
      || !validLimit(input.limit, ACCESS_AUDIT_LIMITS.detailPage)
      || input.afterIndex !== null && (!Number.isSafeInteger(input.afterIndex) || Number(input.afterIndex) < 0))
      return fail('invalid_input');
    try {
      const current = await actor(token); if (!current.ok) return current;
      const page = await store.detail(current.guard, {auditId: input.auditId, limit: input.limit,
        afterIndex: input.afterIndex as number | null});
      return page === null ? fail('unauthorized') : page === undefined ? fail('not_found')
        : Object.freeze({ok: true as const, ...page});
    } catch {return fail('storage_error');}
  }
  return Object.freeze({list, detail});
}
