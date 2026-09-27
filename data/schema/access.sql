-- Creezio D1 current-model creation v1
-- Module: creezio.access
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e616363657373_6163636573735f6175646974" (
  "action" TEXT NOT NULL CHECK ("action" IS NOT NULL AND (typeof("action") = 'text' AND instr("action", char(0)) = 0 AND "action" IN ('bootstrap-completed', 'session-created', 'session-revoked', 'authorization-updated', 'capability-issued', 'capability-revoked', 'account-activated', 'password-reset', 'service-created', 'service-status-updated', 'api-token-issued', 'api-token-rotated', 'api-token-revoked', 'human-status-updated', 'human-sessions-revoked', 'human-session-revoked', 'impersonation-started', 'impersonation-stopped'))),
  "audience" TEXT CHECK ("audience" IS NULL OR (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "capability_id" TEXT CHECK ("capability_id" IS NULL OR (typeof("capability_id") = 'text' AND instr("capability_id", char(0)) = 0 AND length("capability_id") >= 1 AND length("capability_id") <= 128)),
  "claim_nonce" TEXT NOT NULL CHECK ("claim_nonce" IS NOT NULL AND (typeof("claim_nonce") = 'text' AND instr("claim_nonce", char(0)) = 0 AND length("claim_nonce") >= 1 AND length("claim_nonce") <= 128)),
  "context_id" TEXT CHECK ("context_id" IS NULL OR (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "credential_id" TEXT CHECK ("credential_id" IS NULL OR (typeof("credential_id") = 'text' AND instr("credential_id", char(0)) = 0 AND length("credential_id") >= 1 AND length("credential_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "impersonation_id" TEXT CHECK ("impersonation_id" IS NULL OR (typeof("impersonation_id") = 'text' AND instr("impersonation_id", char(0)) = 0 AND length("impersonation_id") >= 1 AND length("impersonation_id") <= 128)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "session_id" TEXT CHECK ("session_id" IS NULL OR (typeof("session_id") = 'text' AND instr("session_id", char(0)) = 0 AND length("session_id") >= 1 AND length("session_id") <= 128)),
  "target_principal_id" TEXT CHECK ("target_principal_id" IS NULL OR (typeof("target_principal_id") = 'text' AND instr("target_principal_id", char(0)) = 0 AND length("target_principal_id") >= 1 AND length("target_principal_id") <= 128)),
  "target_session_id" TEXT CHECK ("target_session_id" IS NULL OR (typeof("target_session_id") = 'text' AND instr("target_session_id", char(0)) = 0 AND length("target_session_id") >= 1 AND length("target_session_id") <= 128)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("session_id") REFERENCES "cz_637265657a696f2e616363657373_73657373696f6e73" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("target_principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6163636573735f706f6c6963795f61756469745f64657461696c73" (
  "audit_id" TEXT NOT NULL CHECK ("audit_id" IS NOT NULL AND (typeof("audit_id") = 'text' AND instr("audit_id", char(0)) = 0 AND length("audit_id") >= 1 AND length("audit_id") <= 128)),
  "changes_json" TEXT NOT NULL CHECK ("changes_json" IS NOT NULL AND (typeof("changes_json") = 'text' AND instr("changes_json", char(0)) = 0 AND length("changes_json") >= 2 AND length("changes_json") <= 524288)),
  "from_epoch" INTEGER NOT NULL CHECK ("from_epoch" IS NOT NULL AND (typeof("from_epoch") = 'integer' AND "from_epoch" BETWEEN -9007199254740991 AND 9007199254740991 AND "from_epoch" >= 1 AND "from_epoch" <= 9007199254740991)),
  "to_epoch" INTEGER NOT NULL CHECK ("to_epoch" IS NOT NULL AND (typeof("to_epoch") = 'integer' AND "to_epoch" BETWEEN -9007199254740991 AND 9007199254740991 AND "to_epoch" >= 2 AND "to_epoch" <= 9007199254740991)),
  PRIMARY KEY ("audit_id"),
  FOREIGN KEY ("audit_id") REFERENCES "cz_637265657a696f2e616363657373_6163636573735f6175646974" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573" (
  "account_version" INTEGER NOT NULL CHECK ("account_version" IS NOT NULL AND (typeof("account_version") = 'integer' AND "account_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "account_version" >= 1 AND "account_version" <= 9007199254740991)),
  "auth_version" INTEGER NOT NULL CHECK ("auth_version" IS NOT NULL AND (typeof("auth_version") = 'integer' AND "auth_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "auth_version" >= 1 AND "auth_version" <= 9007199254740991)),
  "claim_nonce" TEXT CHECK ("claim_nonce" IS NULL OR (typeof("claim_nonce") = 'text' AND instr("claim_nonce", char(0)) = 0 AND length("claim_nonce") >= 1 AND length("claim_nonce") <= 128)),
  "consumed_at_ms" INTEGER CHECK ("consumed_at_ms" IS NULL OR (typeof("consumed_at_ms") = 'integer' AND "consumed_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "consumed_at_ms" >= 0 AND "consumed_at_ms" <= 9007199254740991)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "credential_version" INTEGER CHECK ("credential_version" IS NULL OR (typeof("credential_version") = 'integer' AND "credential_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "credential_version" >= 1 AND "credential_version" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "purpose" TEXT NOT NULL CHECK ("purpose" IS NOT NULL AND (typeof("purpose") = 'text' AND instr("purpose", char(0)) = 0 AND "purpose" IN ('invitation', 'activation', 'password-reset'))),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" IS NULL OR (typeof("revoked_at_ms") = 'integer' AND "revoked_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "revoked_at_ms" >= 0 AND "revoked_at_ms" <= 9007199254740991)),
  "secret_hash" TEXT NOT NULL CHECK ("secret_hash" IS NOT NULL AND (typeof("secret_hash") = 'text' AND instr("secret_hash", char(0)) = 0 AND length("secret_hash") >= 71 AND length("secret_hash") <= 71)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c5f73636f706573" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "credential_id" TEXT NOT NULL CHECK ("credential_id" IS NOT NULL AND (typeof("credential_id") = 'text' AND instr("credential_id", char(0)) = 0 AND length("credential_id") >= 1 AND length("credential_id") <= 128)),
  "permission_id" TEXT NOT NULL CHECK ("permission_id" IS NOT NULL AND (typeof("permission_id") = 'text' AND instr("permission_id", char(0)) = 0 AND length("permission_id") >= 1 AND length("permission_id") <= 256)),
  PRIMARY KEY ("credential_id", "context_id", "audience", "permission_id"),
  FOREIGN KEY ("context_id") REFERENCES "cz_637265657a696f2e616363657373_636f6e7465787473" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("credential_id") REFERENCES "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73" (
  "auth_version" INTEGER NOT NULL CHECK ("auth_version" IS NOT NULL AND (typeof("auth_version") = 'integer' AND "auth_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "auth_version" >= 1 AND "auth_version" <= 9007199254740991)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "label" TEXT NOT NULL CHECK ("label" IS NOT NULL AND (typeof("label") = 'text' AND instr("label", char(0)) = 0 AND length("label") >= 1 AND length("label") <= 120)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "revocation_nonce" TEXT CHECK ("revocation_nonce" IS NULL OR (typeof("revocation_nonce") = 'text' AND instr("revocation_nonce", char(0)) = 0 AND length("revocation_nonce") >= 1 AND length("revocation_nonce") <= 128)),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" IS NULL OR (typeof("revoked_at_ms") = 'integer' AND "revoked_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "revoked_at_ms" >= 0 AND "revoked_at_ms" <= 9007199254740991)),
  "secret_hash" TEXT NOT NULL CHECK ("secret_hash" IS NOT NULL AND (typeof("secret_hash") = 'text' AND instr("secret_hash", char(0)) = 0 AND length("secret_hash") >= 71 AND length("secret_hash") <= 71)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_617574685f7468726f74746c6573" (
  "attempts" INTEGER NOT NULL CHECK ("attempts" IS NOT NULL AND (typeof("attempts") = 'integer' AND "attempts" BETWEEN -9007199254740991 AND 9007199254740991 AND "attempts" >= 1 AND "attempts" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "key" TEXT NOT NULL CHECK ("key" IS NOT NULL AND (typeof("key") = 'text' AND instr("key", char(0)) = 0 AND length("key") >= 1 AND length("key") <= 71)),
  "window_start_ms" INTEGER NOT NULL CHECK ("window_start_ms" IS NOT NULL AND (typeof("window_start_ms") = 'integer' AND "window_start_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "window_start_ms" >= 0 AND "window_start_ms" <= 9007199254740991)),
  PRIMARY KEY ("key")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_617574686f72697a6174696f6e5f7374617465" (
  "bootstrap_principal_id" TEXT NOT NULL CHECK ("bootstrap_principal_id" IS NOT NULL AND (typeof("bootstrap_principal_id") = 'text' AND instr("bootstrap_principal_id", char(0)) = 0 AND length("bootstrap_principal_id") >= 1 AND length("bootstrap_principal_id") <= 128)),
  "epoch" INTEGER NOT NULL CHECK ("epoch" IS NOT NULL AND (typeof("epoch") = 'integer' AND "epoch" BETWEEN -9007199254740991 AND 9007199254740991 AND "epoch" >= 1 AND "epoch" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND "id" IN ('application'))),
  "updated_at_ms" INTEGER NOT NULL CHECK ("updated_at_ms" IS NOT NULL AND (typeof("updated_at_ms") = 'integer' AND "updated_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "updated_at_ms" >= 0 AND "updated_at_ms" <= 9007199254740991)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("bootstrap_principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_626f6f747374726170" (
  "capability_digest" TEXT NOT NULL CHECK ("capability_digest" IS NOT NULL AND (typeof("capability_digest") = 'text' AND instr("capability_digest", char(0)) = 0 AND length("capability_digest") >= 1 AND length("capability_digest") <= 71)),
  "claim_nonce" TEXT CHECK ("claim_nonce" IS NULL OR (typeof("claim_nonce") = 'text' AND instr("claim_nonce", char(0)) = 0 AND length("claim_nonce") >= 1 AND length("claim_nonce") <= 128)),
  "claimed_at_ms" INTEGER CHECK ("claimed_at_ms" IS NULL OR (typeof("claimed_at_ms") = 'integer' AND "claimed_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "claimed_at_ms" >= 0 AND "claimed_at_ms" <= 9007199254740991)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND "id" IN ('installation'))),
  "principal_id" TEXT CHECK ("principal_id" IS NULL OR (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_636f6e7465787473" (
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('active', 'disabled'))),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_68756d616e5f6163636f756e7473" (
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "login_identifier" TEXT NOT NULL CHECK ("login_identifier" IS NOT NULL AND (typeof("login_identifier") = 'text' AND instr("login_identifier", char(0)) = 0 AND length("login_identifier") >= 1 AND length("login_identifier") <= 254)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('active', 'pending', 'disabled'))),
  "updated_at_ms" INTEGER NOT NULL CHECK ("updated_at_ms" IS NOT NULL AND (typeof("updated_at_ms") = 'integer' AND "updated_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "updated_at_ms" >= 0 AND "updated_at_ms" <= 9007199254740991)),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1 AND "version" <= 9007199254740991)),
  PRIMARY KEY ("principal_id"),
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e5f7065726d697373696f6e73" (
  "impersonation_id" TEXT NOT NULL CHECK ("impersonation_id" IS NOT NULL AND (typeof("impersonation_id") = 'text' AND instr("impersonation_id", char(0)) = 0 AND length("impersonation_id") >= 1 AND length("impersonation_id") <= 128)),
  "permission_id" TEXT NOT NULL CHECK ("permission_id" IS NOT NULL AND (typeof("permission_id") = 'text' AND instr("permission_id", char(0)) = 0 AND length("permission_id") >= 1 AND length("permission_id") <= 256)),
  PRIMARY KEY ("impersonation_id", "permission_id"),
  FOREIGN KEY ("impersonation_id") REFERENCES "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73" (
  "actor_principal_id" TEXT NOT NULL CHECK ("actor_principal_id" IS NOT NULL AND (typeof("actor_principal_id") = 'text' AND instr("actor_principal_id", char(0)) = 0 AND length("actor_principal_id") >= 1 AND length("actor_principal_id") <= 128)),
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "ended_at_ms" INTEGER CHECK ("ended_at_ms" IS NULL OR (typeof("ended_at_ms") = 'integer' AND "ended_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "ended_at_ms" >= 0 AND "ended_at_ms" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "reason" TEXT NOT NULL CHECK ("reason" IS NOT NULL AND (typeof("reason") = 'text' AND instr("reason", char(0)) = 0 AND length("reason") >= 1 AND length("reason") <= 500)),
  "revocation_nonce" TEXT CHECK ("revocation_nonce" IS NULL OR (typeof("revocation_nonce") = 'text' AND instr("revocation_nonce", char(0)) = 0 AND length("revocation_nonce") >= 1 AND length("revocation_nonce") <= 128)),
  "secret_hash" TEXT NOT NULL CHECK ("secret_hash" IS NOT NULL AND (typeof("secret_hash") = 'text' AND instr("secret_hash", char(0)) = 0 AND length("secret_hash") >= 71 AND length("secret_hash") <= 71)),
  "source_session_id" TEXT NOT NULL CHECK ("source_session_id" IS NOT NULL AND (typeof("source_session_id") = 'text' AND instr("source_session_id", char(0)) = 0 AND length("source_session_id") >= 1 AND length("source_session_id") <= 128)),
  "subject_account_version" INTEGER NOT NULL CHECK ("subject_account_version" IS NOT NULL AND (typeof("subject_account_version") = 'integer' AND "subject_account_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "subject_account_version" >= 1 AND "subject_account_version" <= 9007199254740991)),
  "subject_auth_version" INTEGER NOT NULL CHECK ("subject_auth_version" IS NOT NULL AND (typeof("subject_auth_version") = 'integer' AND "subject_auth_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "subject_auth_version" >= 1 AND "subject_auth_version" <= 9007199254740991)),
  "subject_credential_version" INTEGER NOT NULL CHECK ("subject_credential_version" IS NOT NULL AND (typeof("subject_credential_version") = 'integer' AND "subject_credential_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "subject_credential_version" >= 1 AND "subject_credential_version" <= 9007199254740991)),
  "subject_principal_id" TEXT NOT NULL CHECK ("subject_principal_id" IS NOT NULL AND (typeof("subject_principal_id") = 'text' AND instr("subject_principal_id", char(0)) = 0 AND length("subject_principal_id") >= 1 AND length("subject_principal_id") <= 128)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("actor_principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("context_id") REFERENCES "cz_637265657a696f2e616363657373_636f6e7465787473" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("source_session_id") REFERENCES "cz_637265657a696f2e616363657373_73657373696f6e73" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("subject_principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6d656d6265727368697073" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('active', 'disabled'))),
  PRIMARY KEY ("principal_id", "context_id", "audience"),
  FOREIGN KEY ("context_id") REFERENCES "cz_637265657a696f2e616363657373_636f6e7465787473" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6f617574685f6163636573735f746f6b656e73" (
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "grant_id" TEXT NOT NULL CHECK ("grant_id" IS NOT NULL AND (typeof("grant_id") = 'text' AND instr("grant_id", char(0)) = 0 AND length("grant_id") >= 1 AND length("grant_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" IS NULL OR (typeof("revoked_at_ms") = 'integer' AND "revoked_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "revoked_at_ms" >= 0 AND "revoked_at_ms" <= 9007199254740991)),
  "secret_hash" TEXT NOT NULL CHECK ("secret_hash" IS NOT NULL AND (typeof("secret_hash") = 'text' AND instr("secret_hash", char(0)) = 0 AND length("secret_hash") >= 71 AND length("secret_hash") <= 71)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("grant_id") REFERENCES "cz_637265657a696f2e616363657373_6f617574685f6772616e7473" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6f617574685f636c69656e7473" (
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "display_name" TEXT NOT NULL CHECK ("display_name" IS NOT NULL AND (typeof("display_name") = 'text' AND instr("display_name", char(0)) = 0 AND length("display_name") >= 1 AND length("display_name") <= 160)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 2048)),
  "redirect_uris_json" TEXT NOT NULL CHECK ("redirect_uris_json" IS NOT NULL AND (typeof("redirect_uris_json") = 'text' AND instr("redirect_uris_json", char(0)) = 0 AND length("redirect_uris_json") >= 2 AND length("redirect_uris_json") <= 65536)),
  "registration_kind" TEXT NOT NULL CHECK ("registration_kind" IS NOT NULL AND (typeof("registration_kind") = 'text' AND instr("registration_kind", char(0)) = 0 AND "registration_kind" IN ('predefined', 'dcr'))),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" IS NULL OR (typeof("revoked_at_ms") = 'integer' AND "revoked_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "revoked_at_ms" >= 0 AND "revoked_at_ms" <= 9007199254740991)),
  "scope_allowlist_json" TEXT NOT NULL CHECK ("scope_allowlist_json" IS NOT NULL AND (typeof("scope_allowlist_json") = 'text' AND instr("scope_allowlist_json", char(0)) = 0 AND length("scope_allowlist_json") >= 2 AND length("scope_allowlist_json") <= 65536)),
  "token_endpoint_auth_method" TEXT NOT NULL CHECK ("token_endpoint_auth_method" IS NOT NULL AND (typeof("token_endpoint_auth_method") = 'text' AND instr("token_endpoint_auth_method", char(0)) = 0 AND "token_endpoint_auth_method" IN ('none'))),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6f617574685f636f646573" (
  "code_challenge" TEXT NOT NULL CHECK ("code_challenge" IS NOT NULL AND (typeof("code_challenge") = 'text' AND instr("code_challenge", char(0)) = 0 AND length("code_challenge") >= 43 AND length("code_challenge") <= 43)),
  "consumed_at_ms" INTEGER CHECK ("consumed_at_ms" IS NULL OR (typeof("consumed_at_ms") = 'integer' AND "consumed_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "consumed_at_ms" >= 0 AND "consumed_at_ms" <= 9007199254740991)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "grant_id" TEXT NOT NULL CHECK ("grant_id" IS NOT NULL AND (typeof("grant_id") = 'text' AND instr("grant_id", char(0)) = 0 AND length("grant_id") >= 1 AND length("grant_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "redirect_uri" TEXT NOT NULL CHECK ("redirect_uri" IS NOT NULL AND (typeof("redirect_uri") = 'text' AND instr("redirect_uri", char(0)) = 0 AND length("redirect_uri") >= 1 AND length("redirect_uri") <= 2048)),
  "resource" TEXT NOT NULL CHECK ("resource" IS NOT NULL AND (typeof("resource") = 'text' AND instr("resource", char(0)) = 0 AND length("resource") >= 1 AND length("resource") <= 2048)),
  "secret_hash" TEXT NOT NULL CHECK ("secret_hash" IS NOT NULL AND (typeof("secret_hash") = 'text' AND instr("secret_hash", char(0)) = 0 AND length("secret_hash") >= 71 AND length("secret_hash") <= 71)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("grant_id") REFERENCES "cz_637265657a696f2e616363657373_6f617574685f6772616e7473" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6f617574685f6772616e7473" (
  "account_version" INTEGER NOT NULL CHECK ("account_version" IS NOT NULL AND (typeof("account_version") = 'integer' AND "account_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "account_version" >= 1 AND "account_version" <= 9007199254740991)),
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "auth_version" INTEGER NOT NULL CHECK ("auth_version" IS NOT NULL AND (typeof("auth_version") = 'integer' AND "auth_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "auth_version" >= 1 AND "auth_version" <= 9007199254740991)),
  "client_id" TEXT NOT NULL CHECK ("client_id" IS NOT NULL AND (typeof("client_id") = 'text' AND instr("client_id", char(0)) = 0 AND length("client_id") >= 1 AND length("client_id") <= 2048)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "credential_version" INTEGER NOT NULL CHECK ("credential_version" IS NOT NULL AND (typeof("credential_version") = 'integer' AND "credential_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "credential_version" >= 1 AND "credential_version" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "permission_ids_json" TEXT NOT NULL CHECK ("permission_ids_json" IS NOT NULL AND (typeof("permission_ids_json") = 'text' AND instr("permission_ids_json", char(0)) = 0 AND length("permission_ids_json") >= 2 AND length("permission_ids_json") <= 65536)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "resource" TEXT NOT NULL CHECK ("resource" IS NOT NULL AND (typeof("resource") = 'text' AND instr("resource", char(0)) = 0 AND length("resource") >= 1 AND length("resource") <= 2048)),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" IS NULL OR (typeof("revoked_at_ms") = 'integer' AND "revoked_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "revoked_at_ms" >= 0 AND "revoked_at_ms" <= 9007199254740991)),
  "scopes_json" TEXT NOT NULL CHECK ("scopes_json" IS NOT NULL AND (typeof("scopes_json") = 'text' AND instr("scopes_json", char(0)) = 0 AND length("scopes_json") >= 2 AND length("scopes_json") <= 65536)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("client_id") REFERENCES "cz_637265657a696f2e616363657373_6f617574685f636c69656e7473" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("context_id") REFERENCES "cz_637265657a696f2e616363657373_636f6e7465787473" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73" (
  "consumed_at_ms" INTEGER CHECK ("consumed_at_ms" IS NULL OR (typeof("consumed_at_ms") = 'integer' AND "consumed_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "consumed_at_ms" >= 0 AND "consumed_at_ms" <= 9007199254740991)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "family_id" TEXT NOT NULL CHECK ("family_id" IS NOT NULL AND (typeof("family_id") = 'text' AND instr("family_id", char(0)) = 0 AND length("family_id") >= 1 AND length("family_id") <= 128)),
  "grant_id" TEXT NOT NULL CHECK ("grant_id" IS NOT NULL AND (typeof("grant_id") = 'text' AND instr("grant_id", char(0)) = 0 AND length("grant_id") >= 1 AND length("grant_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "parent_id" TEXT CHECK ("parent_id" IS NULL OR (typeof("parent_id") = 'text' AND instr("parent_id", char(0)) = 0 AND length("parent_id") >= 1 AND length("parent_id") <= 128)),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" IS NULL OR (typeof("revoked_at_ms") = 'integer' AND "revoked_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "revoked_at_ms" >= 0 AND "revoked_at_ms" <= 9007199254740991)),
  "secret_hash" TEXT NOT NULL CHECK ("secret_hash" IS NOT NULL AND (typeof("secret_hash") = 'text' AND instr("secret_hash", char(0)) = 0 AND length("secret_hash") >= 71 AND length("secret_hash") <= 71)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("grant_id") REFERENCES "cz_637265657a696f2e616363657373_6f617574685f6772616e7473" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("parent_id") REFERENCES "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_6f617574685f7265717565737473" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "client_id" TEXT NOT NULL CHECK ("client_id" IS NOT NULL AND (typeof("client_id") = 'text' AND instr("client_id", char(0)) = 0 AND length("client_id") >= 1 AND length("client_id") <= 2048)),
  "code_challenge" TEXT NOT NULL CHECK ("code_challenge" IS NOT NULL AND (typeof("code_challenge") = 'text' AND instr("code_challenge", char(0)) = 0 AND length("code_challenge") >= 43 AND length("code_challenge") <= 43)),
  "consumed_at_ms" INTEGER CHECK ("consumed_at_ms" IS NULL OR (typeof("consumed_at_ms") = 'integer' AND "consumed_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "consumed_at_ms" >= 0 AND "consumed_at_ms" <= 9007199254740991)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "csrf_digest" TEXT CHECK ("csrf_digest" IS NULL OR (typeof("csrf_digest") = 'text' AND instr("csrf_digest", char(0)) = 0 AND length("csrf_digest") >= 71 AND length("csrf_digest") <= 71)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "principal_id" TEXT CHECK ("principal_id" IS NULL OR (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "redirect_uri" TEXT NOT NULL CHECK ("redirect_uri" IS NOT NULL AND (typeof("redirect_uri") = 'text' AND instr("redirect_uri", char(0)) = 0 AND length("redirect_uri") >= 1 AND length("redirect_uri") <= 2048)),
  "resource" TEXT NOT NULL CHECK ("resource" IS NOT NULL AND (typeof("resource") = 'text' AND instr("resource", char(0)) = 0 AND length("resource") >= 1 AND length("resource") <= 2048)),
  "scopes_json" TEXT NOT NULL CHECK ("scopes_json" IS NOT NULL AND (typeof("scopes_json") = 'text' AND instr("scopes_json", char(0)) = 0 AND length("scopes_json") >= 2 AND length("scopes_json") <= 65536)),
  "session_id" TEXT CHECK ("session_id" IS NULL OR (typeof("session_id") = 'text' AND instr("session_id", char(0)) = 0 AND length("session_id") >= 1 AND length("session_id") <= 128)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND length("state") >= 0 AND length("state") <= 1024)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("client_id") REFERENCES "cz_637265657a696f2e616363657373_6f617574685f636c69656e7473" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("context_id") REFERENCES "cz_637265657a696f2e616363657373_636f6e7465787473" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("session_id") REFERENCES "cz_637265657a696f2e616363657373_73657373696f6e73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_70617373776f72645f63726564656e7469616c73" (
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "expires_at_ms" INTEGER CHECK ("expires_at_ms" IS NULL OR (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "password_record" TEXT NOT NULL CHECK ("password_record" IS NOT NULL AND (typeof("password_record") = 'text' AND instr("password_record", char(0)) = 0 AND length("password_record") >= 1 AND length("password_record") <= 128)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "updated_at_ms" INTEGER NOT NULL CHECK ("updated_at_ms" IS NOT NULL AND (typeof("updated_at_ms") = 'integer' AND "updated_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "updated_at_ms" >= 0 AND "updated_at_ms" <= 9007199254740991)),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1 AND "version" <= 9007199254740991)),
  PRIMARY KEY ("principal_id"),
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_7072696e636970616c5f6f7665727269646573" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "effect" TEXT NOT NULL CHECK ("effect" IS NOT NULL AND (typeof("effect") = 'text' AND instr("effect", char(0)) = 0 AND "effect" IN ('allow', 'deny'))),
  "permission_id" TEXT NOT NULL CHECK ("permission_id" IS NOT NULL AND (typeof("permission_id") = 'text' AND instr("permission_id", char(0)) = 0 AND length("permission_id") >= 1 AND length("permission_id") <= 256)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  PRIMARY KEY ("principal_id", "context_id", "audience", "permission_id"),
  FOREIGN KEY ("principal_id", "context_id", "audience") REFERENCES "cz_637265657a696f2e616363657373_6d656d6265727368697073" ("principal_id", "context_id", "audience") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_7072696e636970616c73" (
  "auth_version" INTEGER NOT NULL CHECK ("auth_version" IS NOT NULL AND (typeof("auth_version") = 'integer' AND "auth_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "auth_version" >= 1 AND "auth_version" <= 9007199254740991)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "display_name" TEXT NOT NULL CHECK ("display_name" IS NOT NULL AND (typeof("display_name") = 'text' AND instr("display_name", char(0)) = 0 AND length("display_name") >= 1 AND length("display_name") <= 200)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "kind" TEXT NOT NULL CHECK ("kind" IS NOT NULL AND (typeof("kind") = 'text' AND instr("kind", char(0)) = 0 AND "kind" IN ('human', 'service'))),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('active', 'disabled'))),
  "updated_at_ms" INTEGER NOT NULL CHECK ("updated_at_ms" IS NOT NULL AND (typeof("updated_at_ms") = 'integer' AND "updated_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "updated_at_ms" >= 0 AND "updated_at_ms" <= 9007199254740991)),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_726f6c655f61737369676e6d656e7473" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "role_id" TEXT NOT NULL CHECK ("role_id" IS NOT NULL AND (typeof("role_id") = 'text' AND instr("role_id", char(0)) = 0 AND length("role_id") >= 1 AND length("role_id") <= 128)),
  PRIMARY KEY ("principal_id", "context_id", "audience", "role_id"),
  FOREIGN KEY ("principal_id", "context_id", "audience") REFERENCES "cz_637265657a696f2e616363657373_6d656d6265727368697073" ("principal_id", "context_id", "audience") ON DELETE RESTRICT,
  FOREIGN KEY ("role_id") REFERENCES "cz_637265657a696f2e616363657373_726f6c6573" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_726f6c655f6772616e7473" (
  "permission_id" TEXT NOT NULL CHECK ("permission_id" IS NOT NULL AND (typeof("permission_id") = 'text' AND instr("permission_id", char(0)) = 0 AND length("permission_id") >= 1 AND length("permission_id") <= 256)),
  "role_id" TEXT NOT NULL CHECK ("role_id" IS NOT NULL AND (typeof("role_id") = 'text' AND instr("role_id", char(0)) = 0 AND length("role_id") >= 1 AND length("role_id") <= 128)),
  PRIMARY KEY ("role_id", "permission_id"),
  FOREIGN KEY ("role_id") REFERENCES "cz_637265657a696f2e616363657373_726f6c6573" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_726f6c655f6f7665727269646573" (
  "effect" TEXT NOT NULL CHECK ("effect" IS NOT NULL AND (typeof("effect") = 'text' AND instr("effect", char(0)) = 0 AND "effect" IN ('allow', 'deny'))),
  "permission_id" TEXT NOT NULL CHECK ("permission_id" IS NOT NULL AND (typeof("permission_id") = 'text' AND instr("permission_id", char(0)) = 0 AND length("permission_id") >= 1 AND length("permission_id") <= 256)),
  "role_id" TEXT NOT NULL CHECK ("role_id" IS NOT NULL AND (typeof("role_id") = 'text' AND instr("role_id", char(0)) = 0 AND length("role_id") >= 1 AND length("role_id") <= 128)),
  PRIMARY KEY ("role_id", "permission_id"),
  FOREIGN KEY ("role_id") REFERENCES "cz_637265657a696f2e616363657373_726f6c6573" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_726f6c655f706172656e7473" (
  "parent_role_id" TEXT NOT NULL CHECK ("parent_role_id" IS NOT NULL AND (typeof("parent_role_id") = 'text' AND instr("parent_role_id", char(0)) = 0 AND length("parent_role_id") >= 1 AND length("parent_role_id") <= 128)),
  "role_id" TEXT NOT NULL CHECK ("role_id" IS NOT NULL AND (typeof("role_id") = 'text' AND instr("role_id", char(0)) = 0 AND length("role_id") >= 1 AND length("role_id") <= 128)),
  PRIMARY KEY ("role_id", "parent_role_id"),
  FOREIGN KEY ("parent_role_id") REFERENCES "cz_637265657a696f2e616363657373_726f6c6573" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("role_id") REFERENCES "cz_637265657a696f2e616363657373_726f6c6573" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_726f6c6573" (
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616363657373_73657373696f6e73" (
  "account_version" INTEGER NOT NULL CHECK ("account_version" IS NOT NULL AND (typeof("account_version") = 'integer' AND "account_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "account_version" >= 1 AND "account_version" <= 9007199254740991)),
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "auth_version" INTEGER NOT NULL CHECK ("auth_version" IS NOT NULL AND (typeof("auth_version") = 'integer' AND "auth_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "auth_version" >= 1 AND "auth_version" <= 9007199254740991)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "credential_version" INTEGER NOT NULL CHECK ("credential_version" IS NOT NULL AND (typeof("credential_version") = 'integer' AND "credential_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "credential_version" >= 1 AND "credential_version" <= 9007199254740991)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "revocation_nonce" TEXT CHECK ("revocation_nonce" IS NULL OR (typeof("revocation_nonce") = 'text' AND instr("revocation_nonce", char(0)) = 0 AND length("revocation_nonce") >= 1 AND length("revocation_nonce") <= 128)),
  "revoked_at_ms" INTEGER CHECK ("revoked_at_ms" IS NULL OR (typeof("revoked_at_ms") = 'integer' AND "revoked_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "revoked_at_ms" >= 0 AND "revoked_at_ms" <= 9007199254740991)),
  "secret_hash" TEXT NOT NULL CHECK ("secret_hash" IS NOT NULL AND (typeof("secret_hash") = 'text' AND instr("secret_hash", char(0)) = 0 AND length("secret_hash") >= 1 AND length("secret_hash") <= 71)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("principal_id") REFERENCES "cz_637265657a696f2e616363657373_7072696e636970616c73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e616363657373_6163636573735f6175646974_idx_6368726f6e6f6c6f676963616c" ON "cz_637265657a696f2e616363657373_6163636573735f6175646974" ("created_at_ms", "id");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6163636573735f6175646974_idx_636c61696d" ON "cz_637265657a696f2e616363657373_6163636573735f6175646974" ("claim_nonce");

CREATE INDEX "cz_637265657a696f2e616363657373_6163636573735f6175646974_idx_7072696e636970616c" ON "cz_637265657a696f2e616363657373_6163636573735f6175646974" ("principal_id");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573_idx_636c61696d" ON "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573" ("claim_nonce");

CREATE INDEX "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573_idx_657870697279" ON "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573" ("expires_at_ms");

CREATE INDEX "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573_idx_6f75747374616e64696e67" ON "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573" ("revoked_at_ms", "consumed_at_ms", "expires_at_ms");

CREATE INDEX "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573_idx_6f75747374616e64696e672d7072696e636970616c" ON "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573" ("principal_id", "revoked_at_ms", "consumed_at_ms", "expires_at_ms");

CREATE INDEX "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573_idx_6f75747374616e64696e672d7072696e636970616c2d76657273696f6e" ON "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573" ("principal_id", "auth_version", "revoked_at_ms", "consumed_at_ms", "expires_at_ms");

CREATE INDEX "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573_idx_7072696e636970616c" ON "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573" ("principal_id");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573_idx_7365637265742d68617368" ON "cz_637265657a696f2e616363657373_6163636f756e745f6361706162696c6974696573" ("secret_hash");

CREATE INDEX "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73_idx_6163746976652d676c6f62616c" ON "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73" ("revoked_at_ms", "expires_at_ms", "principal_id", "auth_version");

CREATE INDEX "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73_idx_6163746976652d7072696e636970616c" ON "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73" ("principal_id", "auth_version", "revoked_at_ms", "expires_at_ms");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73_idx_7265766f636174696f6e" ON "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73" ("revocation_nonce");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73_idx_7365637265742d68617368" ON "cz_637265657a696f2e616363657373_6170695f63726564656e7469616c73" ("secret_hash");

CREATE INDEX "cz_637265657a696f2e616363657373_617574685f7468726f74746c6573_idx_657870697279" ON "cz_637265657a696f2e616363657373_617574685f7468726f74746c6573" ("expires_at_ms");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_626f6f747374726170_idx_6361706162696c697479" ON "cz_637265657a696f2e616363657373_626f6f747374726170" ("capability_digest");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_626f6f747374726170_idx_636c61696d" ON "cz_637265657a696f2e616363657373_626f6f747374726170" ("claim_nonce");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_68756d616e5f6163636f756e7473_idx_6c6f67696e2d6964656e746966696572" ON "cz_637265657a696f2e616363657373_68756d616e5f6163636f756e7473" ("login_identifier");

CREATE INDEX "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73_idx_6f75747374616e64696e67" ON "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73" ("ended_at_ms", "expires_at_ms");

CREATE INDEX "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73_idx_6f75747374616e64696e672d736f75726365" ON "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73" ("source_session_id", "ended_at_ms", "expires_at_ms");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73_idx_7265766f636174696f6e" ON "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73" ("revocation_nonce");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73_idx_7365637265742d68617368" ON "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73" ("secret_hash");

CREATE INDEX "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73_idx_7375626a656374" ON "cz_637265657a696f2e616363657373_696d706572736f6e6174696f6e73" ("subject_principal_id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f6163636573735f746f6b656e73_idx_657870697265732d6964" ON "cz_637265657a696f2e616363657373_6f617574685f6163636573735f746f6b656e73" ("expires_at_ms", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f6163636573735f746f6b656e73_idx_6772616e742d6964" ON "cz_637265657a696f2e616363657373_6f617574685f6163636573735f746f6b656e73" ("grant_id", "id");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6f617574685f6163636573735f746f6b656e73_idx_736563726574" ON "cz_637265657a696f2e616363657373_6f617574685f6163636573735f746f6b656e73" ("secret_hash");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f636c69656e7473_idx_637265617465642d6964" ON "cz_637265657a696f2e616363657373_6f617574685f636c69656e7473" ("created_at_ms", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f636f646573_idx_657870697265732d6964" ON "cz_637265657a696f2e616363657373_6f617574685f636f646573" ("expires_at_ms", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f636f646573_idx_6772616e742d6964" ON "cz_637265657a696f2e616363657373_6f617574685f636f646573" ("grant_id", "id");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6f617574685f636f646573_idx_736563726574" ON "cz_637265657a696f2e616363657373_6f617574685f636f646573" ("secret_hash");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f6772616e7473_idx_636c69656e742d6964" ON "cz_637265657a696f2e616363657373_6f617574685f6772616e7473" ("client_id", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f6772616e7473_idx_7072696e636970616c2d6964" ON "cz_637265657a696f2e616363657373_6f617574685f6772616e7473" ("principal_id", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73_idx_657870697265732d6964" ON "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73" ("expires_at_ms", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73_idx_66616d696c792d6964" ON "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73" ("family_id", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73_idx_6772616e742d6964" ON "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73" ("grant_id", "id");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73_idx_706172656e74" ON "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73" ("parent_id");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73_idx_736563726574" ON "cz_637265657a696f2e616363657373_6f617574685f726566726573685f746f6b656e73" ("secret_hash");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f7265717565737473_idx_657870697265732d6964" ON "cz_637265657a696f2e616363657373_6f617574685f7265717565737473" ("expires_at_ms", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_6f617574685f7265717565737473_idx_73657373696f6e2d6964" ON "cz_637265657a696f2e616363657373_6f617574685f7265717565737473" ("session_id", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_7072696e636970616c73_idx_6b696e642d6964" ON "cz_637265657a696f2e616363657373_7072696e636970616c73" ("kind", "id");

CREATE INDEX "cz_637265657a696f2e616363657373_73657373696f6e73_idx_657870697279" ON "cz_637265657a696f2e616363657373_73657373696f6e73" ("expires_at_ms");

CREATE INDEX "cz_637265657a696f2e616363657373_73657373696f6e73_idx_6c6976652d7072696e636970616c" ON "cz_637265657a696f2e616363657373_73657373696f6e73" ("principal_id", "revoked_at_ms", "expires_at_ms");

CREATE INDEX "cz_637265657a696f2e616363657373_73657373696f6e73_idx_6c6976652d7072696e636970616c2d76657273696f6e" ON "cz_637265657a696f2e616363657373_73657373696f6e73" ("principal_id", "auth_version", "revoked_at_ms", "expires_at_ms");

CREATE INDEX "cz_637265657a696f2e616363657373_73657373696f6e73_idx_7072696e636970616c" ON "cz_637265657a696f2e616363657373_73657373696f6e73" ("principal_id");

CREATE INDEX "cz_637265657a696f2e616363657373_73657373696f6e73_idx_7072696e636970616c2d6964" ON "cz_637265657a696f2e616363657373_73657373696f6e73" ("principal_id", "id");

CREATE UNIQUE INDEX "cz_637265657a696f2e616363657373_73657373696f6e73_idx_7365637265742d68617368" ON "cz_637265657a696f2e616363657373_73657373696f6e73" ("secret_hash");
