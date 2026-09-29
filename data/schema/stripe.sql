-- Creezio D1 current-model creation v1
-- Module: creezio.stripe
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e737472697065_636f6e6e6563746f725f636f6e666967" (
  "connection_id" TEXT CHECK ("connection_id" IS NULL OR (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
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

CREATE TABLE "cz_637265657a696f2e737472697065_636f6e6e6563746f725f736563726574" (
  "binding_id" TEXT NOT NULL CHECK ("binding_id" IS NOT NULL AND (typeof("binding_id") = 'text' AND instr("binding_id", char(0)) = 0 AND length("binding_id") >= 1 AND length("binding_id") <= 128)),
  "ciphertext" TEXT NOT NULL CHECK ("ciphertext" IS NOT NULL AND (typeof("ciphertext") = 'text' AND instr("ciphertext", char(0)) = 0 AND length("ciphertext") >= 1 AND length("ciphertext") <= 32768)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "key_id" TEXT NOT NULL CHECK ("key_id" IS NOT NULL AND (typeof("key_id") = 'text' AND instr("key_id", char(0)) = 0 AND length("key_id") >= 1 AND length("key_id") <= 128)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('active', 'revoked'))),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f637573746f6d6572" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "livemode" INTEGER NOT NULL CHECK ("livemode" IS NOT NULL AND (typeof("livemode") = 'integer' AND "livemode" IN (0, 1))),
  "name" TEXT CHECK ("name" IS NULL OR (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 0 AND length("name") <= 160)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f696e766f696365" (
  "amount_due_minor" INTEGER NOT NULL CHECK ("amount_due_minor" IS NOT NULL AND (typeof("amount_due_minor") = 'integer' AND "amount_due_minor" BETWEEN -9007199254740991 AND 9007199254740991)),
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "currency" TEXT NOT NULL CHECK ("currency" IS NOT NULL AND (typeof("currency") = 'text' AND instr("currency", char(0)) = 0 AND length("currency") >= 3 AND length("currency") <= 3)),
  "customer_id" TEXT CHECK ("customer_id" IS NULL OR (typeof("customer_id") = 'text' AND instr("customer_id", char(0)) = 0 AND length("customer_id") >= 1 AND length("customer_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "livemode" INTEGER NOT NULL CHECK ("livemode" IS NOT NULL AND (typeof("livemode") = 'integer' AND "livemode" IN (0, 1))),
  "period_end_at" TEXT CHECK ("period_end_at" IS NULL OR (typeof("period_end_at") = 'text' AND length("period_end_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "period_end_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "period_end_at") = "period_end_at")),
  "period_start_at" TEXT CHECK ("period_start_at" IS NULL OR (typeof("period_start_at") = 'text' AND length("period_start_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "period_start_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "period_start_at") = "period_start_at")),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "status" TEXT CHECK ("status" IS NULL OR (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND length("status") >= 1 AND length("status") <= 64)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f737562736372697074696f6e" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "currency" TEXT CHECK ("currency" IS NULL OR (typeof("currency") = 'text' AND instr("currency", char(0)) = 0 AND length("currency") >= 3 AND length("currency") <= 3)),
  "customer_id" TEXT NOT NULL CHECK ("customer_id" IS NOT NULL AND (typeof("customer_id") = 'text' AND instr("customer_id", char(0)) = 0 AND length("customer_id") >= 1 AND length("customer_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "interval" TEXT CHECK ("interval" IS NULL OR (typeof("interval") = 'text' AND instr("interval", char(0)) = 0 AND length("interval") >= 1 AND length("interval") <= 32)),
  "interval_count" INTEGER CHECK ("interval_count" IS NULL OR (typeof("interval_count") = 'integer' AND "interval_count" BETWEEN -9007199254740991 AND 9007199254740991 AND "interval_count" >= 1)),
  "livemode" INTEGER NOT NULL CHECK ("livemode" IS NOT NULL AND (typeof("livemode") = 'integer' AND "livemode" IN (0, 1))),
  "period_end_at" TEXT CHECK ("period_end_at" IS NULL OR (typeof("period_end_at") = 'text' AND length("period_end_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "period_end_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "period_end_at") = "period_end_at")),
  "price_id" TEXT CHECK ("price_id" IS NULL OR (typeof("price_id") = 'text' AND instr("price_id", char(0)) = 0 AND length("price_id") >= 1 AND length("price_id") <= 128)),
  "quantity" INTEGER CHECK ("quantity" IS NULL OR (typeof("quantity") = 'integer' AND "quantity" BETWEEN -9007199254740991 AND 9007199254740991 AND "quantity" >= 0)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND length("status") >= 1 AND length("status") <= 64)),
  "unit_amount_minor" INTEGER CHECK ("unit_amount_minor" IS NULL OR (typeof("unit_amount_minor") = 'integer' AND "unit_amount_minor" BETWEEN -9007199254740991 AND 9007199254740991)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737472697065_73796e635f7374617465" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "cursor" TEXT CHECK ("cursor" IS NULL OR (typeof("cursor") = 'text' AND instr("cursor", char(0)) = 0 AND length("cursor") >= 1 AND length("cursor") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND "id" IN ('customers', 'subscriptions', 'invoices'))),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "run_id" TEXT NOT NULL CHECK ("run_id" IS NOT NULL AND (typeof("run_id") = 'text' AND instr("run_id", char(0)) = 0 AND length("run_id") >= 1 AND length("run_id") <= 128)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('partial', 'pages_exhausted'))),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f637573746f6d6572_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f637573746f6d6572" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f696e766f696365_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f696e766f696365" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f737562736372697074696f6e_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f737562736372697074696f6e" ("context_id", "connection_id", "id");
