-- Creezio D1 current-model creation v1
-- Module: creezio.runtime
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e72756e74696d65_617070726f76616c73" (
  "actor_principal_id" TEXT NOT NULL CHECK ("actor_principal_id" IS NOT NULL AND (typeof("actor_principal_id") = 'text' AND instr("actor_principal_id", char(0)) = 0 AND length("actor_principal_id") >= 1 AND length("actor_principal_id") <= 128)),
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "consumed_at_ms" INTEGER CHECK ("consumed_at_ms" IS NULL OR (typeof("consumed_at_ms") = 'integer' AND "consumed_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "consumed_at_ms" >= 0 AND "consumed_at_ms" <= 9007199254740991)),
  "consumed_nonce" TEXT CHECK ("consumed_nonce" IS NULL OR (typeof("consumed_nonce") = 'text' AND instr("consumed_nonce", char(0)) = 0 AND length("consumed_nonce") >= 1 AND length("consumed_nonce") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "credential_digest" TEXT NOT NULL CHECK ("credential_digest" IS NOT NULL AND (typeof("credential_digest") = 'text' AND instr("credential_digest", char(0)) = 0 AND length("credential_digest") >= 1 AND length("credential_digest") <= 71)),
  "csrf_digest" TEXT CHECK ("csrf_digest" IS NULL OR (typeof("csrf_digest") = 'text' AND instr("csrf_digest", char(0)) = 0 AND length("csrf_digest") >= 1 AND length("csrf_digest") <= 71)),
  "decided_at_ms" INTEGER CHECK ("decided_at_ms" IS NULL OR (typeof("decided_at_ms") = 'integer' AND "decided_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "decided_at_ms" >= 0 AND "decided_at_ms" <= 9007199254740991)),
  "decision_nonce" TEXT CHECK ("decision_nonce" IS NULL OR (typeof("decision_nonce") = 'text' AND instr("decision_nonce", char(0)) = 0 AND length("decision_nonce") >= 1 AND length("decision_nonce") <= 128)),
  "decision_session_id" TEXT CHECK ("decision_session_id" IS NULL OR (typeof("decision_session_id") = 'text' AND instr("decision_session_id", char(0)) = 0 AND length("decision_session_id") >= 1 AND length("decision_session_id") <= 128)),
  "expires_at_ms" INTEGER NOT NULL CHECK ("expires_at_ms" IS NOT NULL AND (typeof("expires_at_ms") = 'integer' AND "expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "expires_at_ms" >= 0 AND "expires_at_ms" <= 9007199254740991)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "input_hash" TEXT NOT NULL CHECK ("input_hash" IS NOT NULL AND (typeof("input_hash") = 'text' AND instr("input_hash", char(0)) = 0 AND length("input_hash") >= 1 AND length("input_hash") <= 71)),
  "module_id" TEXT NOT NULL CHECK ("module_id" IS NOT NULL AND (typeof("module_id") = 'text' AND instr("module_id", char(0)) = 0 AND length("module_id") >= 1 AND length("module_id") <= 128)),
  "oauth_client_id" TEXT CHECK ("oauth_client_id" IS NULL OR (typeof("oauth_client_id") = 'text' AND instr("oauth_client_id", char(0)) = 0 AND length("oauth_client_id") >= 1 AND length("oauth_client_id") <= 128)),
  "oauth_grant_id" TEXT CHECK ("oauth_grant_id" IS NULL OR (typeof("oauth_grant_id") = 'text' AND instr("oauth_grant_id", char(0)) = 0 AND length("oauth_grant_id") >= 1 AND length("oauth_grant_id") <= 128)),
  "object_version" TEXT NOT NULL CHECK ("object_version" IS NOT NULL AND (typeof("object_version") = 'text' AND instr("object_version", char(0)) = 0 AND length("object_version") >= 1 AND length("object_version") <= 128)),
  "operation_digest" TEXT NOT NULL CHECK ("operation_digest" IS NOT NULL AND (typeof("operation_digest") = 'text' AND instr("operation_digest", char(0)) = 0 AND length("operation_digest") >= 1 AND length("operation_digest") <= 128)),
  "operation_id" TEXT NOT NULL CHECK ("operation_id" IS NOT NULL AND (typeof("operation_id") = 'text' AND instr("operation_id", char(0)) = 0 AND length("operation_id") >= 1 AND length("operation_id") <= 128)),
  "preview" TEXT NOT NULL CHECK ("preview" IS NOT NULL AND (typeof("preview") = 'text' AND json_valid("preview") = 1)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "request_key_hash" TEXT NOT NULL CHECK ("request_key_hash" IS NOT NULL AND (typeof("request_key_hash") = 'text' AND instr("request_key_hash", char(0)) = 0 AND length("request_key_hash") >= 1 AND length("request_key_hash") <= 71)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('pending', 'approved', 'rejected', 'consumed'))),
  "updated_at_ms" INTEGER NOT NULL CHECK ("updated_at_ms" IS NOT NULL AND (typeof("updated_at_ms") = 'integer' AND "updated_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "updated_at_ms" >= 0 AND "updated_at_ms" <= 9007199254740991)),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e72756e74696d65_617474656d707473" (
  "claim_nonce" TEXT NOT NULL CHECK ("claim_nonce" IS NOT NULL AND (typeof("claim_nonce") = 'text' AND instr("claim_nonce", char(0)) = 0 AND length("claim_nonce") >= 1 AND length("claim_nonce") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "execution_id" TEXT NOT NULL CHECK ("execution_id" IS NOT NULL AND (typeof("execution_id") = 'text' AND instr("execution_id", char(0)) = 0 AND length("execution_id") >= 1 AND length("execution_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "number" INTEGER NOT NULL CHECK ("number" IS NOT NULL AND (typeof("number") = 'integer' AND "number" BETWEEN -9007199254740991 AND 9007199254740991 AND "number" >= 0 AND "number" <= 9007199254740991)),
  "settled_at_ms" INTEGER CHECK ("settled_at_ms" IS NULL OR (typeof("settled_at_ms") = 'integer' AND "settled_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "settled_at_ms" >= 0 AND "settled_at_ms" <= 9007199254740991)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('running', 'succeeded', 'failed', 'unknown'))),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("execution_id") REFERENCES "cz_637265657a696f2e72756e74696d65_657865637574696f6e73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e72756e74696d65_6175646974" (
  "actor_principal_id" TEXT NOT NULL CHECK ("actor_principal_id" IS NOT NULL AND (typeof("actor_principal_id") = 'text' AND instr("actor_principal_id", char(0)) = 0 AND length("actor_principal_id") >= 1 AND length("actor_principal_id") <= 128)),
  "attempt_nonce" TEXT CHECK ("attempt_nonce" IS NULL OR (typeof("attempt_nonce") = 'text' AND instr("attempt_nonce", char(0)) = 0 AND length("attempt_nonce") >= 1 AND length("attempt_nonce") <= 128)),
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "code" TEXT CHECK ("code" IS NULL OR (typeof("code") = 'text' AND instr("code", char(0)) = 0 AND length("code") >= 1 AND length("code") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "event" TEXT NOT NULL CHECK ("event" IS NOT NULL AND (typeof("event") = 'text' AND instr("event", char(0)) = 0 AND "event" IN ('started', 'resumed', 'committed', 'failed', 'unknown', 'delivery-claimed', 'delivery-checkpointed', 'delivery-resumed', 'delivery-appended', 'delivery-succeeded', 'delivery-failed', 'delivery-unknown'))),
  "execution_id" TEXT NOT NULL CHECK ("execution_id" IS NOT NULL AND (typeof("execution_id") = 'text' AND instr("execution_id", char(0)) = 0 AND length("execution_id") >= 1 AND length("execution_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "outbox_id" TEXT CHECK ("outbox_id" IS NULL OR (typeof("outbox_id") = 'text' AND instr("outbox_id", char(0)) = 0 AND length("outbox_id") >= 1 AND length("outbox_id") <= 128)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("execution_id") REFERENCES "cz_637265657a696f2e72756e74696d65_657865637574696f6e73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e72756e74696d65_657865637574696f6e73" (
  "actor_principal_id" TEXT NOT NULL CHECK ("actor_principal_id" IS NOT NULL AND (typeof("actor_principal_id") = 'text' AND instr("actor_principal_id", char(0)) = 0 AND length("actor_principal_id") >= 1 AND length("actor_principal_id") <= 128)),
  "attempt_number" INTEGER NOT NULL CHECK ("attempt_number" IS NOT NULL AND (typeof("attempt_number") = 'integer' AND "attempt_number" BETWEEN -9007199254740991 AND 9007199254740991 AND "attempt_number" >= 0 AND "attempt_number" <= 9007199254740991)),
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "claim_expires_at_ms" INTEGER NOT NULL CHECK ("claim_expires_at_ms" IS NOT NULL AND (typeof("claim_expires_at_ms") = 'integer' AND "claim_expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "claim_expires_at_ms" >= 0 AND "claim_expires_at_ms" <= 9007199254740991)),
  "claim_nonce" TEXT NOT NULL CHECK ("claim_nonce" IS NOT NULL AND (typeof("claim_nonce") = 'text' AND instr("claim_nonce", char(0)) = 0 AND length("claim_nonce") >= 1 AND length("claim_nonce") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "error_code" TEXT CHECK ("error_code" IS NULL OR (typeof("error_code") = 'text' AND instr("error_code", char(0)) = 0 AND length("error_code") >= 1 AND length("error_code") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "input_hash" TEXT NOT NULL CHECK ("input_hash" IS NOT NULL AND (typeof("input_hash") = 'text' AND instr("input_hash", char(0)) = 0 AND length("input_hash") >= 1 AND length("input_hash") <= 71)),
  "module_id" TEXT NOT NULL CHECK ("module_id" IS NOT NULL AND (typeof("module_id") = 'text' AND instr("module_id", char(0)) = 0 AND length("module_id") >= 1 AND length("module_id") <= 128)),
  "operation_id" TEXT NOT NULL CHECK ("operation_id" IS NOT NULL AND (typeof("operation_id") = 'text' AND instr("operation_id", char(0)) = 0 AND length("operation_id") >= 1 AND length("operation_id") <= 128)),
  "operation_version" TEXT NOT NULL CHECK ("operation_version" IS NOT NULL AND (typeof("operation_version") = 'text' AND instr("operation_version", char(0)) = 0 AND length("operation_version") >= 1 AND length("operation_version") <= 128)),
  "output" TEXT CHECK ("output" IS NULL OR (typeof("output") = 'text' AND json_valid("output") = 1)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "retained_until_ms" INTEGER NOT NULL CHECK ("retained_until_ms" IS NOT NULL AND (typeof("retained_until_ms") = 'integer' AND "retained_until_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "retained_until_ms" >= 0 AND "retained_until_ms" <= 9007199254740991)),
  "scope_hash" TEXT NOT NULL CHECK ("scope_hash" IS NOT NULL AND (typeof("scope_hash") = 'text' AND instr("scope_hash", char(0)) = 0 AND length("scope_hash") >= 1 AND length("scope_hash") <= 71)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('running', 'waiting', 'succeeded', 'failed', 'unknown'))),
  "updated_at_ms" INTEGER NOT NULL CHECK ("updated_at_ms" IS NOT NULL AND (typeof("updated_at_ms") = 'integer' AND "updated_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "updated_at_ms" >= 0 AND "updated_at_ms" <= 9007199254740991)),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e72756e74696d65_6f7574626f78" (
  "claim_expires_at_ms" INTEGER CHECK ("claim_expires_at_ms" IS NULL OR (typeof("claim_expires_at_ms") = 'integer' AND "claim_expires_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "claim_expires_at_ms" >= 0 AND "claim_expires_at_ms" <= 9007199254740991)),
  "claim_nonce" TEXT CHECK ("claim_nonce" IS NULL OR (typeof("claim_nonce") = 'text' AND instr("claim_nonce", char(0)) = 0 AND length("claim_nonce") >= 1 AND length("claim_nonce") <= 128)),
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "execution_id" TEXT NOT NULL CHECK ("execution_id" IS NOT NULL AND (typeof("execution_id") = 'text' AND instr("execution_id", char(0)) = 0 AND length("execution_id") >= 1 AND length("execution_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "intent_id" TEXT NOT NULL CHECK ("intent_id" IS NOT NULL AND (typeof("intent_id") = 'text' AND instr("intent_id", char(0)) = 0 AND length("intent_id") >= 1 AND length("intent_id") <= 128)),
  "payload" TEXT NOT NULL CHECK ("payload" IS NOT NULL AND (typeof("payload") = 'text' AND json_valid("payload") = 1)),
  "provider" TEXT NOT NULL CHECK ("provider" IS NOT NULL AND (typeof("provider") = 'text' AND instr("provider", char(0)) = 0 AND length("provider") >= 1 AND length("provider") <= 128)),
  "provider_idempotency_key" TEXT NOT NULL CHECK ("provider_idempotency_key" IS NOT NULL AND (typeof("provider_idempotency_key") = 'text' AND instr("provider_idempotency_key", char(0)) = 0 AND length("provider_idempotency_key") >= 1 AND length("provider_idempotency_key") <= 256)),
  "receipt" TEXT CHECK ("receipt" IS NULL OR (typeof("receipt") = 'text' AND json_valid("receipt") = 1)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('queued', 'claimed', 'succeeded', 'failed', 'unknown'))),
  "updated_at_ms" INTEGER NOT NULL CHECK ("updated_at_ms" IS NOT NULL AND (typeof("updated_at_ms") = 'integer' AND "updated_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "updated_at_ms" >= 0 AND "updated_at_ms" <= 9007199254740991)),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("execution_id") REFERENCES "cz_637265657a696f2e72756e74696d65_657865637574696f6e73" ("id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e72756e74696d65_617070726f76616c73_idx_6163746f722d7374617465" ON "cz_637265657a696f2e72756e74696d65_617070726f76616c73" ("actor_principal_id", "context_id", "audience", "state", "created_at_ms");

CREATE INDEX "cz_637265657a696f2e72756e74696d65_617070726f76616c73_idx_657870697279" ON "cz_637265657a696f2e72756e74696d65_617070726f76616c73" ("expires_at_ms", "state");

CREATE UNIQUE INDEX "cz_637265657a696f2e72756e74696d65_617070726f76616c73_idx_72657175657374" ON "cz_637265657a696f2e72756e74696d65_617070726f76616c73" ("module_id", "operation_id", "actor_principal_id", "context_id", "audience", "request_key_hash");

CREATE UNIQUE INDEX "cz_637265657a696f2e72756e74696d65_617474656d707473_idx_636c61696d" ON "cz_637265657a696f2e72756e74696d65_617474656d707473" ("claim_nonce");

CREATE UNIQUE INDEX "cz_637265657a696f2e72756e74696d65_617474656d707473_idx_657865637574696f6e2d6e756d626572" ON "cz_637265657a696f2e72756e74696d65_617474656d707473" ("execution_id", "number");

CREATE INDEX "cz_637265657a696f2e72756e74696d65_6175646974_idx_657865637574696f6e2d74696d65" ON "cz_637265657a696f2e72756e74696d65_6175646974" ("execution_id", "created_at_ms");

CREATE INDEX "cz_637265657a696f2e72756e74696d65_657865637574696f6e73_idx_636f6e746578742d7374617465" ON "cz_637265657a696f2e72756e74696d65_657865637574696f6e73" ("context_id", "state", "updated_at_ms");

CREATE UNIQUE INDEX "cz_637265657a696f2e72756e74696d65_657865637574696f6e73_idx_73636f7065" ON "cz_637265657a696f2e72756e74696d65_657865637574696f6e73" ("scope_hash");

CREATE UNIQUE INDEX "cz_637265657a696f2e72756e74696d65_6f7574626f78_idx_64656c69766572792d636c61696d" ON "cz_637265657a696f2e72756e74696d65_6f7574626f78" ("claim_nonce");

CREATE UNIQUE INDEX "cz_637265657a696f2e72756e74696d65_6f7574626f78_idx_657865637574696f6e2d696e74656e74" ON "cz_637265657a696f2e72756e74696d65_6f7574626f78" ("execution_id", "intent_id");

CREATE INDEX "cz_637265657a696f2e72756e74696d65_6f7574626f78_idx_70656e64696e67" ON "cz_637265657a696f2e72756e74696d65_6f7574626f78" ("state", "updated_at_ms");
