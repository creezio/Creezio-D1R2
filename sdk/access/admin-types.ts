/** Public shapes for the native Access administration screen. No credential or D1 row escapes here. */
export type AccessAdminAudience = 'admin' | 'app';
export type AccessAdminEffect = 'allow' | 'deny';
export type AccessAdminChangeKind = 'context-status' | 'membership' | 'role-existence' | 'role-parent' | 'role-grant'
  | 'role-override' | 'role-assignment' | 'principal-override';
export type AccessAdminChangeValue = 'absent' | 'present' | 'active' | 'disabled' | 'inherit' | AccessAdminEffect;

/** Explicit tuple keys avoid ambiguous concatenation of role, principal and permission IDs. */
export interface AccessAdminPolicyChange {
  readonly kind: AccessAdminChangeKind;
  readonly principalId?: string;
  readonly contextId?: string;
  readonly audience?: AccessAdminAudience;
  readonly roleId?: string;
  readonly parentRoleId?: string;
  readonly permissionId?: string;
  readonly before: AccessAdminChangeValue;
  readonly after: AccessAdminChangeValue;
}
export interface AccessAdminAuditChange extends AccessAdminPolicyChange { readonly index: number }
/** UI mutation intent. The server derives before/after from its fresh policy epoch. */
export type AccessAdminDeltaInput =
  | Readonly<{kind: 'context-admit'; contextId: string; status: 'active' | 'disabled'}>
  | Readonly<{kind: 'context-status'; contextId: string; status: 'active' | 'disabled'}>
  | Readonly<{kind: 'membership'; principalId: string; contextId: string; audience: AccessAdminAudience;
    status: 'active' | 'disabled'}>
  | Readonly<{kind: 'role-parent'; roleId: string; parentRoleId: string; present: boolean}>
  | Readonly<{kind: 'role-grant'; roleId: string; permissionId: string; present: boolean}>
  | Readonly<{kind: 'role-override'; roleId: string; permissionId: string;
    effect: 'inherit' | AccessAdminEffect}>
  | Readonly<{kind: 'role-assignment'; principalId: string; contextId: string; audience: AccessAdminAudience;
    roleId: string; present: boolean}>
  | Readonly<{kind: 'principal-override'; principalId: string; contextId: string; audience: AccessAdminAudience;
    permissionId: string; effect: 'inherit' | AccessAdminEffect}>;

export interface AccessAdminPolicy {
  readonly contexts: readonly {readonly id: string; readonly status: 'active' | 'disabled'}[];
  readonly roles: readonly {readonly id: string; readonly inherits: readonly string[];
    readonly permissionIds: readonly string[];
    readonly permissionOverrides: readonly {readonly permissionId: string; readonly effect: AccessAdminEffect}[]}[];
  readonly memberships: readonly {readonly principalId: string; readonly contextId: string;
    readonly audience: AccessAdminAudience; readonly status: 'active' | 'disabled'}[];
  readonly assignments: readonly {readonly principalId: string; readonly contextId: string;
    readonly audience: AccessAdminAudience; readonly roleId: string}[];
  readonly overrides: readonly {readonly principalId: string; readonly contextId: string;
    readonly audience: AccessAdminAudience; readonly permissionId: string; readonly effect: AccessAdminEffect}[];
}
export interface AccessAdminPermission {
  readonly id: string; readonly moduleId: string; readonly title: string;
  readonly audiences: readonly AccessAdminAudience[];
  readonly actors: readonly ('user' | 'machine' | 'delegated-user' | 'impersonated-user')[];
}
export interface AccessAdminPolicyRead {
  readonly epoch: number; readonly policy: AccessAdminPolicy;
  readonly permissions: readonly AccessAdminPermission[];
}
export interface AccessAdminPrincipal {
  readonly id: string; readonly kind: 'human' | 'service'; readonly displayName: string;
  readonly status: 'active' | 'disabled'; readonly authVersion: number;
  readonly humanStatus: 'active' | 'pending' | 'disabled' | null;
  readonly loginIdentifier: string | null; readonly createdAtMs: number;
}
export interface AccessAdminSession {
  readonly id: string; readonly audience: AccessAdminAudience; readonly createdAtMs: number;
  readonly expiresAtMs: number; readonly revokedAtMs: number | null; readonly active: boolean;
}
export interface AccessAdminPage<T> { readonly items: readonly T[]; readonly nextAfterId: string | null }
export interface AccessAdminPermissionPage extends AccessAdminPage<AccessAdminPermission> {
  readonly catalogDigest: string;
}
export interface AccessAdminAuditCursor { readonly createdAtMs: number; readonly id: string }
export interface AccessAdminAuditEntry {
  readonly id: string; readonly action: string; readonly principalId: string;
  readonly actorDisplayName: string; readonly targetPrincipalId: string | null;
  readonly createdAtMs: number; readonly summary: string; readonly detailAvailable: boolean;
}
export interface AccessAdminAuditPage {
  readonly items: readonly AccessAdminAuditEntry[];
  readonly nextCursor: AccessAdminAuditCursor | null;
}
export interface AccessAdminAuditDetailPage {
  readonly auditId: string; readonly fromEpoch: number; readonly toEpoch: number;
  readonly changes: readonly AccessAdminAuditChange[]; readonly nextAfterIndex: number | null;
}
export type AccessAdminReadResult<T> = Readonly<{ok: true; value: T}>
  | Readonly<{ok: false; error: string}>;
export type AccessAdminCommandOutcome = Readonly<{kind: 'succeeded'; requestKey: string; output: unknown}>
  | Readonly<{kind: 'failed' | 'rejected'; requestKey: string; code: string}>
  | Readonly<{kind: 'unknown'; requestKey: string; code: string}>;
export interface AccessAdminPendingCommand { readonly bindingId: string; readonly requestKey: string; readonly code: string }
/** The workspace panel owns the qualified, session-scoped T07 storage. */
export interface AccessAdminPendingPersistence {
  read(): Readonly<{bindingId: string; requestKey: string}> | null;
  save(value: Readonly<{bindingId: string; requestKey: string}> | null): boolean;
}
export interface AccessAdminSnapshot {
  readonly authorized: boolean;
  /** A previously verified session is being revalidated; all effects remain blocked. */
  readonly suspended: boolean;
  /** Changes only when the verified identity is replaced or definitively invalidated. */
  readonly identityVersion: number;
  readonly pendingCommand: AccessAdminPendingCommand | null;
}

/** UI calls this controller; it does not construct endpoints or hold a credential. */
export interface AccessAdminController {
  getSnapshot(): AccessAdminSnapshot;
  subscribe(listener: () => void): () => void;
  readPolicy(): Promise<AccessAdminReadResult<AccessAdminPolicyRead>>;
  listPrincipals(input: {kind: 'human' | 'service' | 'all'; limit: number; afterId: string | null}):
    Promise<AccessAdminReadResult<AccessAdminPage<AccessAdminPrincipal>>>;
  listSessions(input: {principalId: string; limit: number; afterId: string | null}):
    Promise<AccessAdminReadResult<AccessAdminPage<AccessAdminSession>>>;
  listAudit(input: {limit: number; before: AccessAdminAuditCursor | null}):
    Promise<AccessAdminReadResult<AccessAdminAuditPage>>;
  readAuditDetail(input: {auditId: string; limit: number; afterIndex: number | null}):
    Promise<AccessAdminReadResult<AccessAdminAuditDetailPage>>;
  applyDelta(input: {expectedEpoch: number; changes: readonly AccessAdminDeltaInput[]}): Promise<AccessAdminCommandOutcome>;
  setHumanStatus(input: {principalId: string; expectedAuthVersion: number; status: 'active' | 'disabled'}):
    Promise<AccessAdminCommandOutcome>;
  revokeAllSessions(input: {principalId: string; expectedAuthVersion: number}): Promise<AccessAdminCommandOutcome>;
  revokeSession(input: {sessionId: string}): Promise<AccessAdminCommandOutcome>;
  reconcilePending(): Promise<AccessAdminCommandOutcome | null>;
  dispose(): void;
}
