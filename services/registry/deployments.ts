import type {RegistryArtifact} from '../../sdk/registry/types.ts';

const limit = 100;

interface DeploymentRow {
  readonly installation_id: string;
  readonly declaration_id: string | null;
  readonly deployment_id: string | null;
  readonly url: string | null;
  readonly repository_url: string | null;
  readonly published_sha: string | null;
  readonly artifact_json: string | null;
  readonly declared_at_ms: number | null;
}

/** A declaration is authenticated registry metadata, not an independent host attestation. */
export async function readOwnerDeployments(db: D1Database, actor: {id: string; digest: string},
  installationId: string, now: number) {
  // The owner, active session and installation are checked in the same read as the rows.
  // A LEFT JOIN preserves an accessible installation with no declarations.
  const result = await db.prepare(`SELECT i.id AS installation_id,d.id AS declaration_id,
      d.deployment_id,d.url,d.repository_url,d.published_sha,d.artifact_json,d.declared_at_ms
    FROM registry_installations i
    JOIN registry_projects p ON p.id=i.project_id
    JOIN registry_owners o ON o.id=p.owner_id
    JOIN registry_owner_sessions s ON s.owner_id=o.id
    LEFT JOIN registry_deployments d ON d.installation_id=i.id AND d.project_id=p.id
    WHERE i.id=? AND p.owner_id=? AND s.digest=? AND s.expires_at_ms>?
      AND s.revoked_at_ms IS NULL AND o.verified_at_ms>0
    ORDER BY d.declared_at_ms DESC,d.id DESC LIMIT 101`)
    .bind(installationId, actor.id, actor.digest, now).all<DeploymentRow>();
  if (!result.results.length) return null;
  const declarations = result.results.filter(row => row.declaration_id !== null);
  return {
    installationId,
    deployments: declarations.slice(0, limit).map(row => {
      const stored = JSON.parse(row.artifact_json!) as RegistryArtifact;
      const artifact = {
        sourceSha: stored.sourceSha,
        artifactDigest: stored.artifactDigest,
        coreVersion: stored.coreVersion,
        contractVersion: stored.contractVersion,
        compositionDigest: stored.compositionDigest,
      };
      return {
        declarationId: row.declaration_id,
        deploymentId: row.deployment_id,
        url: row.url,
        repositoryUrl: row.repository_url,
        publishedSha: row.published_sha,
        artifact,
        declaredAt: new Date(row.declared_at_ms!).toISOString(),
        evidenceKind: 'authenticated_declaration' as const,
      };
    }),
    complete: declarations.length <= limit,
    limit,
  };
}
