import { createD1IdentityStore, normalizeLoginIdentifier } from './d1-store.ts';
import { hashPassword, verifyPassword, PASSWORD_PROFILE } from './password.ts';
import { digestOpaqueToken, issueOpaqueToken } from './tokens.ts';

import { validPasswordInput, normalizeDisplayName as displayName, validIdentityAudience as validAudience,
  identityInputFields as inputFields, identityAdmissionKey as admissionKey } from './input.ts';
export const ACCOUNT_POLICY = Object.freeze({ minimumPasswordCodePoints: 15, maximumPasswordBytes: PASSWORD_PROFILE.maximumPasswordBytes,
  sessionTtlMs: 8 * 60 * 60 * 1000, bootstrapTtlMs: 15 * 60 * 1000,
  admissionWindowMs: 60_000, loginGlobalLimit: 60, loginAccountLimit: 5, bootstrapLimit: 5 });
// Public synthetic verifier for absent accounts; never persisted or accepted as a credential.
// Same approved KDF cost, without deriving a new dummy record for every request.
const absentAccountRecord = '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export type IdentityAudience = 'admin' | 'app';
type Failure = Readonly<{ ok: false; code: 'invalid_input' | 'invalid_credentials' | 'bootstrap_unavailable' | 'rate_limited' }>;
const failure = (code: Failure['code']): Failure => Object.freeze({ ok: false, code });

/** No trim, normalization or character-class composition rule; exact supplied password is used. */
export function validNewPassword(value: unknown): value is string {
  return validPasswordInput(value) && [...value].length >= ACCOUNT_POLICY.minimumPasswordCodePoints;
}
/** Deployment-side only: the caller already possesses the database binding.
 * Never register this provisioning function as an anonymous HTTP/MCP operation.
 * Local development can explicitly provision offline; no implicit startup owner.
 */
export async function provisionBootstrapCapability(db: D1Database) {
  const issued = await issueOpaqueToken('bootstrap');
  const expiresAtMs = Date.now() + ACCOUNT_POLICY.bootstrapTtlMs;
  const stored = await createD1IdentityStore(db).provisionBootstrap({ capabilityDigest: issued.digest, expiresAtMs });
  return stored ? Object.freeze({ token: issued.token, expiresAtMs }) : null;
}

/** Canonical native account orchestration, before transport/cookie adapters.
 * Database errors propagate to the host's redacted failure boundary, never a successful login.
 * A session identifies a principal; it does not itself grant administrator or module rights.
 */
export function createAccountService(db: D1Database) {
  const store = createD1IdentityStore(db);
  return Object.freeze({
    async bootstrap(input: unknown) {
      if (!inputFields(input, ['token', 'loginIdentifier', 'displayName', 'password'])) return failure('invalid_input');
      const loginIdentifier = normalizeLoginIdentifier(input.loginIdentifier), name = displayName(input.displayName);
      if (!loginIdentifier || !name || !validNewPassword(input.password)) return failure('invalid_input');
      const password = input.password, token = input.token;
      const capabilityDigest = await digestOpaqueToken(token, 'bootstrap');
      if (!capabilityDigest) return failure('bootstrap_unavailable');
      if (!(await store.consumeThrottle({ key: await admissionKey('bootstrap'), limit: ACCOUNT_POLICY.bootstrapLimit, windowMs: ACCOUNT_POLICY.admissionWindowMs })).allowed) return failure('rate_limited');
      if (!await store.canCompleteBootstrap(capabilityDigest)) return failure('bootstrap_unavailable');
      const passwordRecord = hashPassword(password);
      const account = await store.completeBootstrap({ capabilityDigest, loginIdentifier, displayName: name, passwordRecord });
      // Claim acquisition, expiry, and all effects are rechecked in one D1 batch after the KDF.
      return account ? Object.freeze({ ok: true as const, principalId: account.principalId }) : failure('bootstrap_unavailable');
    },
    async login(input: unknown) {
      if (!inputFields(input, ['loginIdentifier', 'password', 'audience'])) return failure('invalid_input');
      const loginIdentifier = normalizeLoginIdentifier(input.loginIdentifier);
      if (!loginIdentifier || !validPasswordInput(input.password) || !validAudience(input.audience)) return failure('invalid_input');
      const password = input.password, audience = input.audience;
      // Global bound first: cycling random identifiers cannot create unlimited per-account rows.
      if (!(await store.consumeThrottle({ key: await admissionKey('login-global'), limit: ACCOUNT_POLICY.loginGlobalLimit, windowMs: ACCOUNT_POLICY.admissionWindowMs })).allowed
        || !(await store.consumeThrottle({ key: await admissionKey('login-account', loginIdentifier), limit: ACCOUNT_POLICY.loginAccountLimit, windowMs: ACCOUNT_POLICY.admissionWindowMs })).allowed) return failure('rate_limited');
      const account = await store.findPasswordAccount(loginIdentifier);
      const correct = verifyPassword(password, account?.passwordRecord ?? absentAccountRecord);
      if (!account || !correct) return failure('invalid_credentials');
      const issued = await issueOpaqueToken('session');
      const session = await store.createSessionAfterPassword(account, { sessionDigest: issued.digest, audience, ttlMs: ACCOUNT_POLICY.sessionTtlMs });
      // A concurrent disable/password change prevents insertion. Never release the issued token on rejection.
      return session ? Object.freeze({ ok: true as const, token: issued.token, session }) : failure('invalid_credentials');
    },
    async session(token: unknown, audience: unknown) {
      if (!validAudience(audience)) return null;
      const digest = await digestOpaqueToken(token, 'session');
      return digest ? store.getSession(digest, audience) : null;
    },
    async logout(token: unknown, audience: unknown): Promise<boolean> {
      if (!validAudience(audience)) return false;
      const digest = await digestOpaqueToken(token, 'session');
      return digest ? store.revokeSession(digest, audience) : false;
    },
  });
}
