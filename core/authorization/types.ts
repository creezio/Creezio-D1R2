export type AuthorizationAudience = 'admin' | 'app';
export type AuthorizationActor = 'user' | 'machine' | 'delegated-user' | 'impersonated-user';
export type CredentialKind = 'session' | 'api-token' | 'oauth' | 'impersonation';

/** Exact moduleId:permissionId, never a wildcard or prefix grant. */
export type PermissionId = string;

export interface PermissionDefinition {
  readonly id: PermissionId;
  readonly audiences: readonly AuthorizationAudience[];
  readonly actors: readonly AuthorizationActor[];
  /** Exact historical right from a removed module; never authorizes an operation. */
  readonly retired?: true;
}

export interface RoleDefinition {
  readonly id: string;
  readonly inherits: readonly string[];
  readonly permissionIds: readonly PermissionId[];
  /** An explicit override replaces this role's inherited/default decision. */
  readonly permissionOverrides: readonly RolePermissionOverride[];
}

export interface RolePermissionOverride {
  readonly permissionId: PermissionId;
  readonly effect: 'allow' | 'deny';
}

export interface RoleAssignment {
  readonly roleId: string;
  readonly contextId: string;
  readonly audiences: readonly AuthorizationAudience[];
}

export interface PermissionOverride {
  readonly permissionId: PermissionId;
  readonly contextId: string;
  readonly audiences: readonly AuthorizationAudience[];
  readonly effect: 'allow' | 'deny';
}

/** Server-resolved state for exactly one subject. This shape is not proof of authentication. */
export interface AuthorizationSnapshot {
  readonly actor: {
    readonly id: string;
    readonly kind: 'human' | 'service';
    readonly enabled: boolean;
    readonly contextIds: readonly string[];
    readonly audiences: readonly AuthorizationAudience[];
  };
  readonly credential: {
    readonly id: string;
    readonly subjectId: string;
    readonly enabled: boolean;
    readonly expiresAtMs: number;
    readonly contextIds: readonly string[];
    readonly audiences: readonly AuthorizationAudience[];
    /** Maximum credential scope, intersected with the subject's current grants. */
    readonly permissionIds: readonly PermissionId[];
  } & ({ readonly kind: Exclude<CredentialKind, 'impersonation'> } | {
    readonly kind: 'impersonation';
    /** Actual initiating human; actor.id above remains the effective subject. */
    readonly actorPrincipalId: string;
    readonly sourceSessionId: string;
  });
  readonly permissions: readonly PermissionDefinition[];
  readonly roles: readonly RoleDefinition[];
  readonly assignments: readonly RoleAssignment[];
  readonly overrides: readonly PermissionOverride[];
}

/** Canonical operation policy resolved by the server, never supplied by the caller. */
export interface AuthorizationTarget {
  readonly contextId: string;
  readonly audience: AuthorizationAudience;
  readonly actors: readonly AuthorizationActor[];
  /** Empty is an explicitly authenticated operation without a specific permission. */
  readonly requiredPermissionIds: readonly PermissionId[];
  /** Eligibility to submit an approval is distinct from recording/consuming that approval. */
  readonly purpose: 'operation' | 'human-approval';
}

export type AuthorizationReason =
  | 'allowed' | 'invalid_snapshot' | 'invalid_target' | 'invalid_time'
  | 'actor_disabled' | 'credential_disabled' | 'credential_expired'
  | 'credential_subject' | 'credential_kind' | 'context_denied' | 'audience_denied'
  | 'actor_denied' | 'permission_unknown' | 'permission_denied' | 'scope_denied'
  | 'role_missing' | 'role_cycle' | 'role_depth' | 'human_approval_required';

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: AuthorizationReason;
}
