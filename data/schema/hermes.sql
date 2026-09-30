-- Creezio D1 current-model creation v1
-- Module: creezio.hermes
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e6865726d6573_6361706162696c6974795f736e617073686f74" (
  "connection_generation" INTEGER NOT NULL CHECK ("connection_generation" IS NOT NULL AND (typeof("connection_generation") = 'integer' AND "connection_generation" BETWEEN -9007199254740991 AND 9007199254740991 AND "connection_generation" >= 1)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "model" TEXT NOT NULL CHECK ("model" IS NOT NULL AND (typeof("model") = 'text' AND instr("model", char(0)) = 0 AND length("model") >= 1 AND length("model") <= 128)),
  "observed_at" TEXT NOT NULL CHECK ("observed_at" IS NOT NULL AND (typeof("observed_at") = 'text' AND length("observed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "observed_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "observed_at") = "observed_at")),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "run_events_sse" INTEGER NOT NULL CHECK ("run_events_sse" IS NOT NULL AND (typeof("run_events_sse") = 'integer' AND "run_events_sse" IN (0, 1))),
  "run_status" INTEGER NOT NULL CHECK ("run_status" IS NOT NULL AND (typeof("run_status") = 'integer' AND "run_status" IN (0, 1))),
  "run_stop" INTEGER NOT NULL CHECK ("run_stop" IS NOT NULL AND (typeof("run_stop") = 'integer' AND "run_stop" IN (0, 1))),
  "run_submission" INTEGER NOT NULL CHECK ("run_submission" IS NOT NULL AND (typeof("run_submission") = 'integer' AND "run_submission" IN (0, 1))),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6865726d6573_636f6e6e656374696f6e5f7374616d70" (
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "generation" INTEGER NOT NULL CHECK ("generation" IS NOT NULL AND (typeof("generation") = 'integer' AND "generation" BETWEEN -9007199254740991 AND 9007199254740991 AND "generation" >= 1)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6865726d6573_636f6e6e6563746f725f636f6e666967" (
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "enabled" INTEGER NOT NULL CHECK ("enabled" IS NOT NULL AND (typeof("enabled") = 'integer' AND "enabled" IN (0, 1))),
  "generation" INTEGER NOT NULL CHECK ("generation" IS NOT NULL AND (typeof("generation") = 'integer' AND "generation" BETWEEN -9007199254740991 AND 9007199254740991 AND "generation" >= 1)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_ref" TEXT CHECK ("key_ref" IS NULL OR (typeof("key_ref") = 'text' AND instr("key_ref", char(0)) = 0 AND length("key_ref") >= 1 AND length("key_ref") <= 128)),
  "origin" TEXT NOT NULL CHECK ("origin" IS NOT NULL AND (typeof("origin") = 'text' AND instr("origin", char(0)) = 0 AND length("origin") >= 8 AND length("origin") <= 512)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "secret_version" INTEGER CHECK ("secret_version" IS NULL OR (typeof("secret_version") = 'integer' AND "secret_version" BETWEEN -9007199254740991 AND 9007199254740991 AND "secret_version" >= 1)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6865726d6573_636f6e6e6563746f725f736563726574" (
  "binding_id" TEXT NOT NULL CHECK ("binding_id" IS NOT NULL AND (typeof("binding_id") = 'text' AND instr("binding_id", char(0)) = 0 AND length("binding_id") >= 1 AND length("binding_id") <= 128)),
  "ciphertext" TEXT NOT NULL CHECK ("ciphertext" IS NOT NULL AND (typeof("ciphertext") = 'text' AND instr("ciphertext", char(0)) = 0 AND length("ciphertext") >= 1 AND length("ciphertext") <= 32768)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_id" TEXT NOT NULL CHECK ("key_id" IS NOT NULL AND (typeof("key_id") = 'text' AND instr("key_id", char(0)) = 0 AND length("key_id") >= 1 AND length("key_id") <= 128)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('active', 'revoked'))),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6865726d6573_72756e" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "connection_generation" INTEGER NOT NULL CHECK ("connection_generation" IS NOT NULL AND (typeof("connection_generation") = 'integer' AND "connection_generation" BETWEEN -9007199254740991 AND 9007199254740991 AND "connection_generation" >= 1)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "input" TEXT NOT NULL CHECK ("input" IS NOT NULL AND (typeof("input") = 'text' AND instr("input", char(0)) = 0 AND length("input") >= 1 AND length("input") <= 8192)),
  "model" TEXT CHECK ("model" IS NULL OR (typeof("model") = 'text' AND instr("model", char(0)) = 0 AND length("model") >= 1 AND length("model") <= 128)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "remote_id" TEXT CHECK ("remote_id" IS NULL OR (typeof("remote_id") = 'text' AND instr("remote_id", char(0)) = 0 AND length("remote_id") >= 1 AND length("remote_id") <= 128)),
  "result_text" TEXT CHECK ("result_text" IS NULL OR (typeof("result_text") = 'text' AND instr("result_text", char(0)) = 0 AND length("result_text") >= 0 AND length("result_text") <= 64000)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "session_id" TEXT CHECK ("session_id" IS NULL OR (typeof("session_id") = 'text' AND instr("session_id", char(0)) = 0 AND length("session_id") >= 1 AND length("session_id") <= 128)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND length("status") >= 1 AND length("status") <= 32)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;
