import { createNativeAuthorizationResolver } from '../authorization/resolver.ts';
import type { PermissionDefinition } from '../authorization/types.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import { projectSurfaceAuthorization, validateSurfaceAuthorizationCatalog,
  type SurfaceAuthorizationCatalog, type WorkspaceNavigationDeclaration } from '../workspace/authorization.ts';
import type { FrontProjection } from '../../sdk/front/types.ts';

export interface FrontAuthorizationCatalog extends SurfaceAuthorizationCatalog {
  readonly slots: readonly (WorkspaceNavigationDeclaration & { readonly slot: string })[];
}

export type FrontAuthorizationResult = Readonly<{ok: true; projection: FrontProjection}>
  | Readonly<{ok: false; error: 'invalid_input' | 'unauthorized' | 'unavailable'}>;

const contextId = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);

/** Front reads use the same native app-session resolver and ACL snapshot as workspace. */
export function createFrontAuthorizationService(db: IdentityDatabase, options: {
  readonly permissions: readonly PermissionDefinition[];
  readonly catalog: FrontAuthorizationCatalog;
}) {
  const resolver = createNativeAuthorizationResolver(db, {permissions: options.permissions});
  validateSurfaceAuthorizationCatalog(options.catalog, resolver.permissions, 'front');
  const catalog = structuredClone(options.catalog);
  return Object.freeze({async read(token: unknown, selectedContextId: string): Promise<FrontAuthorizationResult> {
    if (!contextId(selectedContextId)) return Object.freeze({ok: false, error: 'invalid_input'});
    try {
      const state = await resolver.resolve(token, 'app');
      if (!state) return Object.freeze({ok: false, error: 'unauthorized'});
      const projection = projectSurfaceAuthorization(state, catalog, resolver.permissions, selectedContextId, 'app', 'front');
      return projection ? Object.freeze({ok: true, projection: Object.freeze({...projection, audience: 'app' as const})})
        : Object.freeze({ok: false, error: 'unauthorized'});
    } catch { return Object.freeze({ok: false, error: 'unavailable'}); }
  }});
}
