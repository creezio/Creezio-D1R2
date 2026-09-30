-- Creezio D1 current-model creation v1
-- Module: creezio.granola
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e6772616e6f6c61_636f6e6e6563746f725f636f6e666967" (
  "connection_id" TEXT CHECK ("connection_id" IS NULL OR (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "enabled" INTEGER NOT NULL CHECK ("enabled" IS NOT NULL AND (typeof("enabled") = 'integer' AND "enabled" IN (0, 1))),
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

CREATE TABLE "cz_637265657a696f2e6772616e6f6c61_636f6e6e6563746f725f736563726574" (
  "binding_id" TEXT NOT NULL CHECK ("binding_id" IS NOT NULL AND (typeof("binding_id") = 'text' AND instr("binding_id", char(0)) = 0 AND length("binding_id") >= 1 AND length("binding_id") <= 128)),
  "ciphertext" TEXT NOT NULL CHECK ("ciphertext" IS NOT NULL AND (typeof("ciphertext") = 'text' AND instr("ciphertext", char(0)) = 0 AND length("ciphertext") >= 1 AND length("ciphertext") <= 32768)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_id" TEXT NOT NULL CHECK ("key_id" IS NOT NULL AND (typeof("key_id") = 'text' AND instr("key_id", char(0)) = 0 AND length("key_id") >= 1 AND length("key_id") <= 128)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('active', 'revoked'))),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6772616e6f6c61_666f6c646572" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "name" TEXT NOT NULL CHECK ("name" IS NOT NULL AND (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 0 AND length("name") <= 500)),
  "parent_folder_id" TEXT CHECK ("parent_folder_id" IS NULL OR (typeof("parent_folder_id") = 'text' AND instr("parent_folder_id", char(0)) = 0 AND length("parent_folder_id") >= 1 AND length("parent_folder_id") <= 64)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "synced_at" TEXT NOT NULL CHECK ("synced_at" IS NOT NULL AND (typeof("synced_at") = 'text' AND length("synced_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "synced_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "synced_at") = "synced_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6772616e6f6c61_6e6f7465" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "folder_id" TEXT CHECK ("folder_id" IS NULL OR (typeof("folder_id") = 'text' AND instr("folder_id", char(0)) = 0 AND length("folder_id") >= 1 AND length("folder_id") <= 64)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "note_created_at" TEXT CHECK ("note_created_at" IS NULL OR (typeof("note_created_at") = 'text' AND length("note_created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "note_created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "note_created_at") = "note_created_at")),
  "note_updated_at" TEXT CHECK ("note_updated_at" IS NULL OR (typeof("note_updated_at") = 'text' AND length("note_updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "note_updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "note_updated_at") = "note_updated_at")),
  "owner" TEXT CHECK ("owner" IS NULL OR (typeof("owner") = 'text' AND instr("owner", char(0)) = 0 AND length("owner") >= 0 AND length("owner") <= 256)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "summary_text" TEXT CHECK ("summary_text" IS NULL OR (typeof("summary_text") = 'text' AND instr("summary_text", char(0)) = 0 AND length("summary_text") >= 0 AND length("summary_text") <= 16000)),
  "synced_at" TEXT NOT NULL CHECK ("synced_at" IS NOT NULL AND (typeof("synced_at") = 'text' AND length("synced_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "synced_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "synced_at") = "synced_at")),
  "title" TEXT CHECK ("title" IS NULL OR (typeof("title") = 'text' AND instr("title", char(0)) = 0 AND length("title") >= 0 AND length("title") <= 1000)),
  "web_url" TEXT CHECK ("web_url" IS NULL OR (typeof("web_url") = 'text' AND instr("web_url", char(0)) = 0 AND length("web_url") >= 0 AND length("web_url") <= 2048)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6772616e6f6c61_73796e635f7374617465" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "cursor" TEXT CHECK ("cursor" IS NULL OR (typeof("cursor") = 'text' AND instr("cursor", char(0)) = 0 AND length("cursor") >= 1 AND length("cursor") <= 512)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND "id" IN ('notes', 'folders'))),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "run_id" TEXT NOT NULL CHECK ("run_id" IS NOT NULL AND (typeof("run_id") = 'text' AND instr("run_id", char(0)) = 0 AND length("run_id") >= 1 AND length("run_id") <= 128)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('partial', 'pages_exhausted'))),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6772616e6f6c61_7472616e7363726970745f7365676d656e74" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "end_time" TEXT NOT NULL CHECK ("end_time" IS NOT NULL AND (typeof("end_time") = 'text' AND length("end_time") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "end_time") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "end_time") = "end_time")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "note_id" TEXT NOT NULL CHECK ("note_id" IS NOT NULL AND (typeof("note_id") = 'text' AND instr("note_id", char(0)) = 0 AND length("note_id") >= 1 AND length("note_id") <= 64)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "speaker_name" TEXT CHECK ("speaker_name" IS NULL OR (typeof("speaker_name") = 'text' AND instr("speaker_name", char(0)) = 0 AND length("speaker_name") >= 0 AND length("speaker_name") <= 256)),
  "start_time" TEXT NOT NULL CHECK ("start_time" IS NOT NULL AND (typeof("start_time") = 'text' AND length("start_time") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "start_time") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "start_time") = "start_time")),
  "synced_at" TEXT NOT NULL CHECK ("synced_at" IS NOT NULL AND (typeof("synced_at") = 'text' AND length("synced_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "synced_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "synced_at") = "synced_at")),
  "text" TEXT NOT NULL CHECK ("text" IS NOT NULL AND (typeof("text") = 'text' AND instr("text", char(0)) = 0 AND length("text") >= 0 AND length("text") <= 8192)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6772616e6f6c61_776562686f6f6b5f6576656e74" (
  "body_digest" TEXT NOT NULL CHECK ("body_digest" IS NOT NULL AND (typeof("body_digest") = 'text' AND instr("body_digest", char(0)) = 0 AND length("body_digest") >= 64 AND length("body_digest") <= 64)),
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "event_type" TEXT NOT NULL CHECK ("event_type" IS NOT NULL AND (typeof("event_type") = 'text' AND instr("event_type", char(0)) = 0 AND "event_type" IN ('note.generated', 'note.edited', 'note.access_granted'))),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "note_id" TEXT NOT NULL CHECK ("note_id" IS NOT NULL AND (typeof("note_id") = 'text' AND instr("note_id", char(0)) = 0 AND length("note_id") >= 1 AND length("note_id") <= 64)),
  "occurred_at" TEXT NOT NULL CHECK ("occurred_at" IS NOT NULL AND (typeof("occurred_at") = 'text' AND length("occurred_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "occurred_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "occurred_at") = "occurred_at")),
  "received_at" TEXT NOT NULL CHECK ("received_at" IS NOT NULL AND (typeof("received_at") = 'text' AND length("received_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "received_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "received_at") = "received_at")),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e6772616e6f6c61_666f6c646572_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e6772616e6f6c61_666f6c646572" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e6772616e6f6c61_6e6f7465_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e6772616e6f6c61_6e6f7465" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e6772616e6f6c61_7472616e7363726970745f7365676d656e74_idx_62792d6e6f7465" ON "cz_637265657a696f2e6772616e6f6c61_7472616e7363726970745f7365676d656e74" ("context_id", "connection_id", "note_id", "id");

CREATE INDEX "cz_637265657a696f2e6772616e6f6c61_776562686f6f6b5f6576656e74_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e6772616e6f6c61_776562686f6f6b5f6576656e74" ("context_id", "connection_id", "id");
