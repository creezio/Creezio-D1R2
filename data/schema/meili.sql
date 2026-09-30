-- Creezio D1 current-model creation v1
-- Module: creezio.meili
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e6d65696c69_636f6e6e6563746f725f636f6e666967" (
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "enabled" INTEGER NOT NULL CHECK ("enabled" IS NOT NULL AND (typeof("enabled") = 'integer' AND "enabled" IN (0, 1))),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_ref" TEXT CHECK ("key_ref" IS NULL OR (typeof("key_ref") = 'text' AND instr("key_ref", char(0)) = 0 AND length("key_ref") >= 1 AND length("key_ref") <= 128)),
  "origin" TEXT NOT NULL CHECK ("origin" IS NOT NULL AND (typeof("origin") = 'text' AND instr("origin", char(0)) = 0 AND length("origin") >= 8 AND length("origin") <= 512)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "secret_version" INTEGER CHECK ("secret_version" IS NULL OR (typeof("secret_version") = 'integer' AND "secret_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "secret_version" >= 1)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d65696c69_636f6e6e6563746f725f736563726574" (
  "binding_id" TEXT NOT NULL CHECK ("binding_id" IS NOT NULL AND (typeof("binding_id") = 'text' AND instr("binding_id", char(0)) = 0 AND length("binding_id") >= 1 AND length("binding_id") <= 128)),
  "ciphertext" TEXT NOT NULL CHECK ("ciphertext" IS NOT NULL AND (typeof("ciphertext") = 'text' AND instr("ciphertext", char(0)) = 0 AND length("ciphertext") >= 1 AND length("ciphertext") <= 32768)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_id" TEXT NOT NULL CHECK ("key_id" IS NOT NULL AND (typeof("key_id") = 'text' AND instr("key_id", char(0)) = 0 AND length("key_id") >= 1 AND length("key_id") <= 128)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('active', 'revoked'))),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d65696c69_696e6465785f6a6f62" (
  "abandoned_uid" TEXT CHECK ("abandoned_uid" IS NULL OR (typeof("abandoned_uid") = 'text' AND instr("abandoned_uid", char(0)) = 0 AND length("abandoned_uid") >= 1 AND length("abandoned_uid") <= 64)),
  "active_epoch" TEXT CHECK ("active_epoch" IS NULL OR (typeof("active_epoch") = 'text' AND instr("active_epoch", char(0)) = 0 AND length("active_epoch") >= 1 AND length("active_epoch") <= 64)),
  "active_uid" TEXT CHECK ("active_uid" IS NULL OR (typeof("active_uid") = 'text' AND instr("active_uid", char(0)) = 0 AND length("active_uid") >= 1 AND length("active_uid") <= 64)),
  "building_count" INTEGER NOT NULL CHECK ("building_count" IS NOT NULL AND (typeof("building_count") = 'integer' AND "building_count" BETWEEN -9007199254740991 AND 9007199254740991 AND "building_count" >= 0)),
  "building_epoch" TEXT CHECK ("building_epoch" IS NULL OR (typeof("building_epoch") = 'text' AND instr("building_epoch", char(0)) = 0 AND length("building_epoch") >= 1 AND length("building_epoch") <= 64)),
  "building_uid" TEXT CHECK ("building_uid" IS NULL OR (typeof("building_uid") = 'text' AND instr("building_uid", char(0)) = 0 AND length("building_uid") >= 1 AND length("building_uid") <= 64)),
  "config_revision" INTEGER NOT NULL CHECK ("config_revision" IS NOT NULL AND (typeof("config_revision") = 'integer' AND "config_revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "config_revision" >= 1)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "cursor" TEXT CHECK ("cursor" IS NULL OR (typeof("cursor") = 'text' AND instr("cursor", char(0)) = 0 AND length("cursor") >= 1 AND length("cursor") <= 2048)),
  "emit_key" TEXT CHECK ("emit_key" IS NULL OR (typeof("emit_key") = 'text' AND instr("emit_key", char(0)) = 0 AND length("emit_key") >= 1 AND length("emit_key") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 257)),
  "mode" TEXT NOT NULL CHECK ("mode" IS NOT NULL AND (typeof("mode") = 'text' AND instr("mode", char(0)) = 0 AND "mode" IN ('rebuild', 'sync'))),
  "pending_cursor" TEXT CHECK ("pending_cursor" IS NULL OR (typeof("pending_cursor") = 'text' AND instr("pending_cursor", char(0)) = 0 AND length("pending_cursor") >= 1 AND length("pending_cursor") <= 2048)),
  "pending_kind" TEXT CHECK ("pending_kind" IS NULL OR (typeof("pending_kind") = 'text' AND instr("pending_kind", char(0)) = 0 AND "pending_kind" IN ('upsert', 'delete'))),
  "pending_payload" TEXT CHECK ("pending_payload" IS NULL OR (typeof("pending_payload") = 'text' AND json_valid("pending_payload") = 1)),
  "pending_records" TEXT CHECK ("pending_records" IS NULL OR (typeof("pending_records") = 'text' AND json_valid("pending_records") = 1)),
  "pending_task_uid" INTEGER CHECK ("pending_task_uid" IS NULL OR (typeof("pending_task_uid") = 'integer' AND "pending_task_uid" BETWEEN -9007199254740991 AND 9007199254740991 AND "pending_task_uid" >= 0)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('building', 'prepared', 'waiting', 'failed', 'ready'))),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d65696c69_696e6465785f70726f6a656374696f6e" (
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "deleted" INTEGER NOT NULL CHECK ("deleted" IS NOT NULL AND (typeof("deleted") = 'integer' AND "deleted" IN (0, 1))),
  "epoch" TEXT NOT NULL CHECK ("epoch" IS NOT NULL AND (typeof("epoch") = 'text' AND instr("epoch", char(0)) = 0 AND length("epoch") >= 1 AND length("epoch") <= 64)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 256)),
  "record_id" TEXT NOT NULL CHECK ("record_id" IS NOT NULL AND (typeof("record_id") = 'text' AND instr("record_id", char(0)) = 0 AND length("record_id") >= 1 AND length("record_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "source_id" TEXT NOT NULL CHECK ("source_id" IS NOT NULL AND (typeof("source_id") = 'text' AND instr("source_id", char(0)) = 0 AND length("source_id") >= 1 AND length("source_id") <= 257)),
  "source_revision" INTEGER NOT NULL CHECK ("source_revision" IS NOT NULL AND (typeof("source_revision") = 'integer' AND "source_revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "source_revision" >= 1)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;
