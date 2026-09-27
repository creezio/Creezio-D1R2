import { authorize } from '../authorization/authorize.ts';
import { policySnapshot } from '../authorization/policy.ts';
import { createNativeAuthorizationResolver } from '../authorization/resolver.ts';
import type { AuthorizationAudience, AuthorizationTarget, PermissionDefinition } from '../authorization/types.ts';
import type { StoredAuthorizationState } from '../authorization/d1-store.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';

export interface WorkspacePermissionRef { readonly moduleId: string; readonly kind: 'permission'; readonly id: string }
export interface WorkspaceViewDeclaration {
  readonly id: string;
  readonly surfaces: readonly ('workspace' | 'front')[];
  readonly audiences: readonly AuthorizationAudience[];
  readonly permissions: readonly WorkspacePermissionRef[];
}
export interface WorkspaceNavigationDeclaration extends WorkspaceViewDeclaration { readonly viewId: string }
export interface WorkspaceAuthorizationCatalog {
  readonly compositionDigest: string;
  readonly views: readonly WorkspaceViewDeclaration[];
  readonly navigation: readonly WorkspaceNavigationDeclaration[];
}
export interface SurfaceAuthorizationCatalog extends WorkspaceAuthorizationCatalog {
  readonly slots?: readonly WorkspaceNavigationDeclaration[];
}
export interface WorkspaceAuthorizationProjection {
  readonly sessionId: string;
  readonly principalId: string;
  readonly audience: AuthorizationAudience;
  readonly contextId: string;
  readonly compositionDigest: string;
  readonly epoch: number;
  readonly viewIds: readonly string[];
  readonly navigationIds: readonly string[];
}
export interface SurfaceAuthorizationProjection extends WorkspaceAuthorizationProjection {
  readonly slotIds: readonly string[];
}
export type WorkspaceAuthorizationResult = Readonly<{ok: true; projection: WorkspaceAuthorizationProjection}>
  | Readonly<{ok: false; error: 'invalid_input' | 'unauthorized' | 'unavailable'}>;

const id = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value);
const audience = (value: unknown): value is AuthorizationAudience => value === 'admin' || value === 'app';
const permissionId = (ref: WorkspacePermissionRef) => `${ref.moduleId}:${ref.id}`;

export function validateSurfaceAuthorizationCatalog(catalog: SurfaceAuthorizationCatalog,
  permissions: readonly PermissionDefinition[], surface: 'workspace' | 'front') {
  if (!catalog || !digest(catalog.compositionDigest) || !Array.isArray(catalog.views)
    || !Array.isArray(catalog.navigation) || catalog.views.length > 1000 || catalog.navigation.length > 1000
    || catalog.slots !== undefined && (!Array.isArray(catalog.slots) || catalog.slots.length > 1000))
    throw new TypeError('Invalid surface authorization catalog.');
  const known = new Set(permissions.map(permission => permission.id));
  const views = new Map<string, WorkspaceViewDeclaration>();
  const valid = (entry: WorkspaceViewDeclaration) => id(entry?.id) && Array.isArray(entry.surfaces)
    && entry.surfaces.includes(surface) && Array.isArray(entry.audiences) && entry.audiences.length > 0
    && entry.audiences.length <= 2 && entry.audiences.every(audience)
    && Array.isArray(entry.permissions) && entry.permissions.length <= 1000
    && entry.permissions.every(ref => ref?.kind === 'permission' && id(ref.moduleId) && id(ref.id) && known.has(permissionId(ref)));
  for (const view of catalog.views) {
    if (!valid(view) || views.has(view.id)) throw new TypeError('Invalid surface view authorization.');
    views.set(view.id, view);
  }
  const navigation = new Set<string>();
  for (const item of catalog.navigation) {
    if (!valid(item) || !id(item.viewId) || !views.has(item.viewId) || navigation.has(item.id))
      throw new TypeError('Invalid surface navigation authorization.');
    navigation.add(item.id);
  }
  const slots = new Set<string>();
  for (const item of catalog.slots ?? []) {
    if (!valid(item) || !id(item.viewId) || !views.has(item.viewId) || slots.has(item.id))
      throw new TypeError('Invalid surface slot authorization.');
    slots.add(item.id);
  }
}

/** Shared ACL projection for workspace and front. The caller fixes the surface. */
export function projectSurfaceAuthorization(state: StoredAuthorizationState,
  catalog: SurfaceAuthorizationCatalog, permissions: readonly PermissionDefinition[],
  contextId: string, requestedAudience: AuthorizationAudience,
  surface: 'workspace' | 'front'): SurfaceAuthorizationProjection | null {
  if (!id(contextId) || !audience(requestedAudience) || state.session.audience !== requestedAudience) return null;
  const snapshot = policySnapshot(state.policy, permissions, state.session);
  const allowed = (refs: readonly WorkspacePermissionRef[]) => {
    const target: AuthorizationTarget = {contextId, audience: requestedAudience, actors: ['user'],
      requiredPermissionIds: refs.map(permissionId), purpose: 'operation'};
    return authorize(snapshot, target, state.nowMs).allowed;
  };
  if (!allowed([])) return null;
  const viewIds = catalog.views.filter(view => view.surfaces.includes(surface)
    && view.audiences.includes(requestedAudience) && allowed(view.permissions)).map(view => view.id);
  const visible = new Set(viewIds);
  const navigationIds = catalog.navigation.filter(item => item.surfaces.includes(surface)
    && item.audiences.includes(requestedAudience) && visible.has(item.viewId) && allowed(item.permissions)).map(item => item.id);
  const slotIds = (catalog.slots ?? []).filter(item => item.surfaces.includes(surface)
    && item.audiences.includes(requestedAudience) && visible.has(item.viewId) && allowed(item.permissions)).map(item => item.id);
  return Object.freeze({sessionId: state.session.id, principalId: state.session.principalId,
    audience: requestedAudience, contextId, compositionDigest: catalog.compositionDigest, epoch: state.epoch,
    viewIds: Object.freeze(viewIds), navigationIds: Object.freeze(navigationIds), slotIds: Object.freeze(slotIds)});
}

/** A read projection from one coherent native D1 resolution. It is display state,
 * never a later write permit. The operation engine must recheck its own guard. */
export function projectWorkspaceAuthorization(state: StoredAuthorizationState,
  catalog: WorkspaceAuthorizationCatalog, permissions: readonly PermissionDefinition[],
  contextId: string, requestedAudience: AuthorizationAudience): WorkspaceAuthorizationProjection | null {
  const projection = projectSurfaceAuthorization(state, catalog, permissions, contextId, requestedAudience, 'workspace');
  if (!projection) return null;
  const {slotIds: _slotIds, ...workspace} = projection;
  return Object.freeze(workspace);
}

/** The host supplies a reviewed catalogue and selects the audience from its route.
 * A caller supplies only the selected context; native resolution checks the cookie. */
export function createWorkspaceAuthorizationService(db: IdentityDatabase, options: {
  readonly permissions: readonly PermissionDefinition[]; readonly catalog: WorkspaceAuthorizationCatalog;
}) {
  const resolver = createNativeAuthorizationResolver(db, {permissions: options.permissions});
  validateSurfaceAuthorizationCatalog(options.catalog, resolver.permissions, 'workspace');
  const catalog = structuredClone(options.catalog);
  return Object.freeze({async read(token: unknown, requestedAudience: AuthorizationAudience, contextId: string): Promise<WorkspaceAuthorizationResult> {
    if (!audience(requestedAudience) || !id(contextId)) return Object.freeze({ok: false, error: 'invalid_input'});
    try {
      const state = await resolver.resolve(token, requestedAudience);
      if (!state) return Object.freeze({ok: false, error: 'unauthorized'});
      const projection = projectWorkspaceAuthorization(state, catalog, resolver.permissions, contextId, requestedAudience);
      return projection ? Object.freeze({ok: true, projection}) : Object.freeze({ok: false, error: 'unauthorized'});
    } catch { return Object.freeze({ok: false, error: 'unavailable'}); }
  }});
}
