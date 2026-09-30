-- Creezio D1 current-model creation v1
-- Module: creezio.resend
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e726573656e64_636f6e6e6563746f725f636f6e666967" (
  "connection_id" TEXT CHECK ("connection_id" IS NULL OR (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "enabled" INTEGER NOT NULL CHECK ("enabled" IS NOT NULL AND (typeof("enabled") = 'integer' AND "enabled" IN (0, 1))),
  "from_address" TEXT NOT NULL CHECK ("from_address" IS NOT NULL AND (typeof("from_address") = 'text' AND instr("from_address", char(0)) = 0 AND length("from_address") >= 3 AND length("from_address") <= 320)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_ref" TEXT CHECK ("key_ref" IS NULL OR (typeof("key_ref") = 'text' AND instr("key_ref", char(0)) = 0 AND length("key_ref") >= 1 AND length("key_ref") <= 128)),
  "origin" TEXT NOT NULL CHECK ("origin" IS NOT NULL AND (typeof("origin") = 'text' AND instr("origin", char(0)) = 0 AND length("origin") >= 8 AND length("origin") <= 512)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "secret_version" INTEGER CHECK ("secret_version" IS NULL OR (typeof("secret_version") = 'integer' AND "secret_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "secret_version" >= 1)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  "webhook_key_ref" TEXT CHECK ("webhook_key_ref" IS NULL OR (typeof("webhook_key_ref") = 'text' AND instr("webhook_key_ref", char(0)) = 0 AND length("webhook_key_ref") >= 1 AND length("webhook_key_ref") <= 128)),
  "webhook_previous_key_ref" TEXT CHECK ("webhook_previous_key_ref" IS NULL OR (typeof("webhook_previous_key_ref") = 'text' AND instr("webhook_previous_key_ref", char(0)) = 0 AND length("webhook_previous_key_ref") >= 1 AND length("webhook_previous_key_ref") <= 128)),
  "webhook_previous_secret_version" INTEGER CHECK ("webhook_previous_secret_version" IS NULL OR (typeof("webhook_previous_secret_version") = 'integer' AND "webhook_previous_secret_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "webhook_previous_secret_version" >= 1)),
  "webhook_secret_version" INTEGER CHECK ("webhook_secret_version" IS NULL OR (typeof("webhook_secret_version") = 'integer' AND "webhook_secret_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "webhook_secret_version" >= 1)),
  "webhook_service_token_ref" TEXT CHECK ("webhook_service_token_ref" IS NULL OR (typeof("webhook_service_token_ref") = 'text' AND instr("webhook_service_token_ref", char(0)) = 0 AND length("webhook_service_token_ref") >= 1 AND length("webhook_service_token_ref") <= 128)),
  "webhook_service_token_version" INTEGER CHECK ("webhook_service_token_version" IS NULL OR (typeof("webhook_service_token_version") = 'integer' AND "webhook_service_token_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "webhook_service_token_version" >= 1)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e726573656e64_636f6e6e6563746f725f736563726574" (
  "binding_id" TEXT NOT NULL CHECK ("binding_id" IS NOT NULL AND (typeof("binding_id") = 'text' AND instr("binding_id", char(0)) = 0 AND length("binding_id") >= 1 AND length("binding_id") <= 128)),
  "ciphertext" TEXT NOT NULL CHECK ("ciphertext" IS NOT NULL AND (typeof("ciphertext") = 'text' AND instr("ciphertext", char(0)) = 0 AND length("ciphertext") >= 1 AND length("ciphertext") <= 32768)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_id" TEXT NOT NULL CHECK ("key_id" IS NOT NULL AND (typeof("key_id") = 'text' AND instr("key_id", char(0)) = 0 AND length("key_id") >= 1 AND length("key_id") <= 128)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('active', 'revoked'))),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e726573656e64_776562686f6f6b5f6576656e74" (
  "body_digest" TEXT NOT NULL CHECK ("body_digest" IS NOT NULL AND (typeof("body_digest") = 'text' AND instr("body_digest", char(0)) = 0 AND length("body_digest") >= 64 AND length("body_digest") <= 64)),
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "email_id" TEXT NOT NULL CHECK ("email_id" IS NOT NULL AND (typeof("email_id") = 'text' AND instr("email_id", char(0)) = 0 AND length("email_id") >= 1 AND length("email_id") <= 256)),
  "event_type" TEXT NOT NULL CHECK ("event_type" IS NOT NULL AND (typeof("event_type") = 'text' AND instr("event_type", char(0)) = 0 AND "event_type" IN ('email.sent', 'email.delivered', 'email.bounced', 'email.failed', 'email.received'))),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "occurred_at" TEXT NOT NULL CHECK ("occurred_at" IS NOT NULL AND (typeof("occurred_at") = 'text' AND length("occurred_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "occurred_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "occurred_at") = "occurred_at")),
  "received_at" TEXT NOT NULL CHECK ("received_at" IS NOT NULL AND (typeof("received_at") = 'text' AND length("received_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "received_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "received_at") = "received_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e726573656e64_776562686f6f6b5f6576656e74_idx_62792d656d61696c" ON "cz_637265657a696f2e726573656e64_776562686f6f6b5f6576656e74" ("context_id", "connection_id", "email_id", "occurred_at", "id");
