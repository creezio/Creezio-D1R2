import {issueCredential} from './credentials.ts';
import {email, id} from './validation.ts';

/** Trusted operator action against the registry's own D1. No public bootstrap route. */
export async function bootstrapRegistry(db: D1Database, input: {maintainerEmail: string; serviceId: string},
  now = Date.now()): Promise<{ownerId: string; ownerToken: string; expiresAt: string}> {
  if (!email(input?.maintainerEmail) || !id(input?.serviceId)) throw new TypeError('Invalid explicit bootstrap identity.');
  const ownerId = crypto.randomUUID(), credential = await issueCredential('owner');
  const expiresAt = now + 15 * 60_000;
  await db.batch([
    db.prepare('INSERT INTO registry_bootstrap(singleton,maintainer_owner_id,service_id,created_at_ms) VALUES(1,?,?,?)')
      .bind(ownerId, input.serviceId, now),
    db.prepare("INSERT INTO registry_owners(id,method,subject,email,verified_at_ms) VALUES(?,'bootstrap',?,?,?)")
      .bind(ownerId, input.serviceId, input.maintainerEmail.toLowerCase(), now),
    db.prepare('INSERT INTO registry_owner_sessions(digest,owner_id,expires_at_ms,revoked_at_ms) VALUES(?,?,?,NULL)')
      .bind(credential.digest, ownerId, expiresAt),
  ]);
  return {ownerId, ownerToken: credential.token, expiresAt: new Date(expiresAt).toISOString()};
}
