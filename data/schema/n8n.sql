-- Creezio D1 current-model creation v1
-- Module: creezio.n8n
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e6e386e_636f6e6e6563746f725f636f6e666967" (
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

CREATE TABLE "cz_637265657a696f2e6e386e_636f6e6e6563746f725f736563726574" (
  "binding_id" TEXT NOT NULL CHECK ("binding_id" IS NOT NULL AND (typeof("binding_id") = 'text' AND instr("binding_id", char(0)) = 0 AND length("binding_id") >= 1 AND length("binding_id") <= 128)),
  "ciphertext" TEXT NOT NULL CHECK ("ciphertext" IS NOT NULL AND (typeof("ciphertext") = 'text' AND instr("ciphertext", char(0)) = 0 AND length("ciphertext") >= 1 AND length("ciphertext") <= 32768)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_id" TEXT NOT NULL CHECK ("key_id" IS NOT NULL AND (typeof("key_id") = 'text' AND instr("key_id", char(0)) = 0 AND length("key_id") >= 1 AND length("key_id") <= 128)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('active', 'revoked'))),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;
