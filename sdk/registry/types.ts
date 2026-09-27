/** Wire contract for the separately deployed Creezio registration service.
 * A client sends its installation token only as a Bearer credential. */
export interface RegistryArtifact {
  readonly sourceSha: string;
  /** Digest of the exact immutable bundle sent to the target. */
  readonly artifactDigest: string;
  readonly coreVersion: string;
  readonly contractVersion: string;
  readonly compositionDigest: string;
}

export interface RegistryPreflightRequest {
  readonly projectId: string;
  readonly installationId: string;
  readonly target: 'sites' | 'cloudflare';
  readonly artifact: RegistryArtifact;
}

export interface RegistryPreflightResult {
  readonly preflightId: string;
  readonly projectId: string;
  readonly installationId: string;
  readonly checkedAt: string;
  readonly expiresAt: string;
}

/** `requestKey` is stable across retries of one confirmed publication. */
export interface RegistryDeclarationRequest {
  readonly preflightId: string;
  readonly requestKey: string;
  readonly projectId: string;
  readonly installationId: string;
  readonly deploymentId: string;
  readonly url: string;
  readonly repositoryUrl?: string;
  /** Transport/platform revision, known only after the successful publication. */
  readonly publishedSha?: string;
  readonly artifact: RegistryArtifact;
}

export interface RegistryDeclarationResult {
  readonly projectId: string;
  readonly installationId: string;
  readonly deploymentId: string;
  readonly declaredAt: string;
  readonly replayed: boolean;
}

export interface RegistryFailure {
  readonly error: Readonly<{code: 'invalid_input' | 'authentication_required' | 'forbidden' | 'conflict'
    | 'not_found' | 'rate_limited' | 'configuration_unavailable' | 'service_unavailable'}>;
}
