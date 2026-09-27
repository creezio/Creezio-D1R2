-- Creezio D1 current-model creation v1
-- Module: creezio.conversations
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e" (
  "archived_at" TEXT CHECK ("archived_at" IS NULL OR (typeof("archived_at") = 'text' AND length("archived_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") = "archived_at")),
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "mode" TEXT NOT NULL CHECK ("mode" IS NOT NULL AND (typeof("mode") = 'text' AND instr("mode", char(0)) = 0 AND "mode" IN ('chat', 'work'))),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "title" TEXT NOT NULL CHECK ("title" IS NOT NULL AND (typeof("title") = 'text' AND instr("title", char(0)) = 0 AND length("title") >= 1 AND length("title") <= 240)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "owner_id", "audience", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e5f6174746163686d656e74" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" IS NOT NULL AND (typeof("byte_size") = 'integer' AND "byte_size" BETWEEN -9007199254740991 AND 9007199254740991 AND "byte_size" >= 0 AND "byte_size" <= 9007199254740991)),
  "content_type" TEXT NOT NULL CHECK ("content_type" IS NOT NULL AND (typeof("content_type") = 'text' AND instr("content_type", char(0)) = 0 AND length("content_type") >= 1 AND length("content_type") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "conversation_id" TEXT NOT NULL CHECK ("conversation_id" IS NOT NULL AND (typeof("conversation_id") = 'text' AND instr("conversation_id", char(0)) = 0 AND length("conversation_id") >= 1 AND length("conversation_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "digest" TEXT NOT NULL CHECK ("digest" IS NOT NULL AND (typeof("digest") = 'text' AND instr("digest", char(0)) = 0 AND length("digest") >= 64 AND length("digest") <= 64)),
  "file_id" TEXT NOT NULL CHECK ("file_id" IS NOT NULL AND (typeof("file_id") = 'text' AND instr("file_id", char(0)) = 0 AND length("file_id") >= 1 AND length("file_id") <= 67)),
  "filename" TEXT NOT NULL CHECK ("filename" IS NOT NULL AND (typeof("filename") = 'text' AND instr("filename", char(0)) = 0 AND length("filename") >= 1 AND length("filename") <= 255)),
  "generation" TEXT NOT NULL CHECK ("generation" IS NOT NULL AND (typeof("generation") = 'text' AND instr("generation", char(0)) = 0 AND length("generation") >= 1 AND length("generation") <= 128)),
  "intent_id" TEXT NOT NULL CHECK ("intent_id" IS NOT NULL AND (typeof("intent_id") = 'text' AND instr("intent_id", char(0)) = 0 AND length("intent_id") >= 1 AND length("intent_id") <= 128)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  PRIMARY KEY ("context_id", "owner_id", "audience", "conversation_id", "file_id"),
  FOREIGN KEY ("context_id", "owner_id", "audience", "conversation_id") REFERENCES "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e" ("context_id", "owner_id", "audience", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e636f6e766572736174696f6e73_6472616674" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "conversation_id" TEXT NOT NULL CHECK ("conversation_id" IS NOT NULL AND (typeof("conversation_id") = 'text' AND instr("conversation_id", char(0)) = 0 AND length("conversation_id") >= 1 AND length("conversation_id") <= 128)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "text" TEXT NOT NULL CHECK ("text" IS NOT NULL AND (typeof("text") = 'text' AND instr("text", char(0)) = 0 AND length("text") >= 0 AND length("text") <= 16000)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "owner_id", "audience", "conversation_id"),
  FOREIGN KEY ("context_id", "owner_id", "audience", "conversation_id") REFERENCES "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e" ("context_id", "owner_id", "audience", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e636f6e766572736174696f6e73_6576656e74" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "conversation_id" TEXT NOT NULL CHECK ("conversation_id" IS NOT NULL AND (typeof("conversation_id") = 'text' AND instr("conversation_id", char(0)) = 0 AND length("conversation_id") >= 1 AND length("conversation_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "kind" TEXT NOT NULL CHECK ("kind" IS NOT NULL AND (typeof("kind") = 'text' AND instr("kind", char(0)) = 0 AND length("kind") >= 1 AND length("kind") <= 64)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  "payload" TEXT NOT NULL CHECK ("payload" IS NOT NULL AND (typeof("payload") = 'text' AND json_valid("payload") = 1)),
  "sequence" INTEGER NOT NULL CHECK ("sequence" IS NOT NULL AND (typeof("sequence") = 'integer' AND "sequence" BETWEEN -9007199254740991 AND 9007199254740991 AND "sequence" >= 1 AND "sequence" <= 9007199254740991)),
  "turn_id" TEXT NOT NULL CHECK ("turn_id" IS NOT NULL AND (typeof("turn_id") = 'text' AND instr("turn_id", char(0)) = 0 AND length("turn_id") >= 1 AND length("turn_id") <= 128)),
  PRIMARY KEY ("context_id", "owner_id", "audience", "conversation_id", "turn_id", "sequence"),
  FOREIGN KEY ("context_id", "owner_id", "audience", "conversation_id") REFERENCES "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e" ("context_id", "owner_id", "audience", "id") ON DELETE RESTRICT,
  FOREIGN KEY ("context_id", "owner_id", "audience", "conversation_id", "turn_id") REFERENCES "cz_637265657a696f2e636f6e766572736174696f6e73_7475726e" ("context_id", "owner_id", "audience", "conversation_id", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e636f6e766572736174696f6e73_66696c655f6d65746164617461" (
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" IS NOT NULL AND (typeof("byte_size") = 'integer' AND "byte_size" BETWEEN -9007199254740991 AND 9007199254740991 AND "byte_size" >= 0 AND "byte_size" <= 9007199254740991)),
  "content_type" TEXT NOT NULL CHECK ("content_type" IS NOT NULL AND (typeof("content_type") = 'text' AND instr("content_type", char(0)) = 0 AND length("content_type") >= 1 AND length("content_type") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "digest" TEXT NOT NULL CHECK ("digest" IS NOT NULL AND (typeof("digest") = 'text' AND instr("digest", char(0)) = 0 AND length("digest") >= 64 AND length("digest") <= 64)),
  "file_id" TEXT NOT NULL CHECK ("file_id" IS NOT NULL AND (typeof("file_id") = 'text' AND instr("file_id", char(0)) = 0 AND length("file_id") >= 1 AND length("file_id") <= 67)),
  "file_owner" TEXT NOT NULL CHECK ("file_owner" IS NOT NULL AND (typeof("file_owner") = 'text' AND instr("file_owner", char(0)) = 0 AND length("file_owner") >= 1 AND length("file_owner") <= 260)),
  "filename" TEXT NOT NULL CHECK ("filename" IS NOT NULL AND (typeof("filename") = 'text' AND instr("filename", char(0)) = 0 AND length("filename") >= 1 AND length("filename") <= 255)),
  "generation" TEXT NOT NULL CHECK ("generation" IS NOT NULL AND (typeof("generation") = 'text' AND instr("generation", char(0)) = 0 AND length("generation") >= 1 AND length("generation") <= 128)),
  "intent_id" TEXT NOT NULL CHECK ("intent_id" IS NOT NULL AND (typeof("intent_id") = 'text' AND instr("intent_id", char(0)) = 0 AND length("intent_id") >= 1 AND length("intent_id") <= 128)),
  "object_key" TEXT NOT NULL CHECK ("object_key" IS NOT NULL AND (typeof("object_key") = 'text' AND instr("object_key", char(0)) = 0 AND length("object_key") >= 1 AND length("object_key") <= 512)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('staging', 'staged', 'available', 'abandoned', 'deleted'))),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1 AND "version" <= 9007199254740991)),
  PRIMARY KEY ("context_id", "file_id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e636f6e766572736174696f6e73_6d657373616765" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "body" TEXT NOT NULL CHECK ("body" IS NOT NULL AND (typeof("body") = 'text' AND instr("body", char(0)) = 0 AND length("body") >= 0 AND length("body") <= 16000)),
  "content" TEXT CHECK ("content" IS NULL OR (typeof("content") = 'text' AND json_valid("content") = 1)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "conversation_id" TEXT NOT NULL CHECK ("conversation_id" IS NOT NULL AND (typeof("conversation_id") = 'text' AND instr("conversation_id", char(0)) = 0 AND length("conversation_id") >= 1 AND length("conversation_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "role" TEXT NOT NULL CHECK ("role" IS NOT NULL AND (typeof("role") = 'text' AND instr("role", char(0)) = 0 AND "role" IN ('user', 'assistant', 'tool', 'system'))),
  PRIMARY KEY ("context_id", "owner_id", "audience", "conversation_id", "id"),
  FOREIGN KEY ("context_id", "owner_id", "audience", "conversation_id") REFERENCES "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e" ("context_id", "owner_id", "audience", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e636f6e766572736174696f6e73_7475726e" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "conversation_id" TEXT NOT NULL CHECK ("conversation_id" IS NOT NULL AND (typeof("conversation_id") = 'text' AND instr("conversation_id", char(0)) = 0 AND length("conversation_id") >= 1 AND length("conversation_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "error_code" TEXT CHECK ("error_code" IS NULL OR (typeof("error_code") = 'text' AND instr("error_code", char(0)) = 0 AND length("error_code") >= 1 AND length("error_code") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "last_sequence" INTEGER NOT NULL CHECK ("last_sequence" IS NOT NULL AND (typeof("last_sequence") = 'integer' AND "last_sequence" BETWEEN -9007199254740991 AND 9007199254740991 AND "last_sequence" >= 0 AND "last_sequence" <= 9007199254740991)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  "provider_id" TEXT CHECK ("provider_id" IS NULL OR (typeof("provider_id") = 'text' AND instr("provider_id", char(0)) = 0 AND length("provider_id") >= 1 AND length("provider_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'cancelled', 'no_provider', 'unknown'))),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "owner_id", "audience", "conversation_id", "id"),
  FOREIGN KEY ("context_id", "owner_id", "audience", "conversation_id") REFERENCES "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e" ("context_id", "owner_id", "audience", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e_idx_726563656e74" ON "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e" ("context_id", "owner_id", "audience", "updated_at", "id");

CREATE INDEX "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e5f6174746163686d656e74_idx_62792d636f6e766572736174696f6e" ON "cz_637265657a696f2e636f6e766572736174696f6e73_636f6e766572736174696f6e5f6174746163686d656e74" ("context_id", "owner_id", "audience", "conversation_id", "created_at", "file_id");

CREATE UNIQUE INDEX "cz_637265657a696f2e636f6e766572736174696f6e73_6576656e74_idx_62792d7475726e" ON "cz_637265657a696f2e636f6e766572736174696f6e73_6576656e74" ("context_id", "owner_id", "audience", "conversation_id", "turn_id", "sequence");

CREATE UNIQUE INDEX "cz_637265657a696f2e636f6e766572736174696f6e73_66696c655f6d65746164617461_idx_696e74656e74" ON "cz_637265657a696f2e636f6e766572736174696f6e73_66696c655f6d65746164617461" ("context_id", "intent_id", "generation");

CREATE UNIQUE INDEX "cz_637265657a696f2e636f6e766572736174696f6e73_66696c655f6d65746164617461_idx_6f626a6563742d6b6579" ON "cz_637265657a696f2e636f6e766572736174696f6e73_66696c655f6d65746164617461" ("context_id", "object_key");

CREATE INDEX "cz_637265657a696f2e636f6e766572736174696f6e73_6d657373616765_idx_6368726f6e6f6c6f6779" ON "cz_637265657a696f2e636f6e766572736174696f6e73_6d657373616765" ("context_id", "owner_id", "audience", "conversation_id", "created_at", "id");

CREATE INDEX "cz_637265657a696f2e636f6e766572736174696f6e73_6d657373616765_idx_7365617263682d6368726f6e6f6c6f6779" ON "cz_637265657a696f2e636f6e766572736174696f6e73_6d657373616765" ("context_id", "owner_id", "audience", "created_at", "conversation_id", "id");

CREATE INDEX "cz_637265657a696f2e636f6e766572736174696f6e73_7475726e_idx_726563656e742d7475726e73" ON "cz_637265657a696f2e636f6e766572736174696f6e73_7475726e" ("context_id", "owner_id", "audience", "conversation_id", "created_at", "id");
