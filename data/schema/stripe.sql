-- Creezio D1 current-model creation v1
-- Module: creezio.stripe
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e737472697065_636f6e6e6563746f725f636f6e666967" (
  "checkout_app_return_path" TEXT CHECK ("checkout_app_return_path" IS NULL OR (typeof("checkout_app_return_path") = 'text' AND instr("checkout_app_return_path", char(0)) = 0 AND length("checkout_app_return_path") >= 1 AND length("checkout_app_return_path") <= 256)),
  "checkout_return_origin" TEXT CHECK ("checkout_return_origin" IS NULL OR (typeof("checkout_return_origin") = 'text' AND instr("checkout_return_origin", char(0)) = 0 AND length("checkout_return_origin") >= 8 AND length("checkout_return_origin") <= 512)),
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

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f636174616c6f675f73796e635f7374617465" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "cursor" TEXT CHECK ("cursor" IS NULL OR (typeof("cursor") = 'text' AND instr("cursor", char(0)) = 0 AND length("cursor") >= 1 AND length("cursor") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND "id" IN ('products', 'prices_active', 'prices_inactive'))),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "run_id" TEXT NOT NULL CHECK ("run_id" IS NOT NULL AND (typeof("run_id") = 'text' AND instr("run_id", char(0)) = 0 AND length("run_id") >= 1 AND length("run_id") <= 128)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('partial', 'pages_exhausted'))),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f636865636b6f7574" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "customer_id" TEXT CHECK ("customer_id" IS NULL OR (typeof("customer_id") = 'text' AND instr("customer_id", char(0)) = 0 AND length("customer_id") >= 1 AND length("customer_id") <= 128)),
  "execution_id" TEXT NOT NULL CHECK ("execution_id" IS NOT NULL AND (typeof("execution_id") = 'text' AND instr("execution_id", char(0)) = 0 AND length("execution_id") >= 1 AND length("execution_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "livemode" INTEGER NOT NULL CHECK ("livemode" IS NOT NULL AND (typeof("livemode") = 'integer' AND "livemode" IN (0, 1))),
  "mode" TEXT NOT NULL CHECK ("mode" IS NOT NULL AND (typeof("mode") = 'text' AND instr("mode", char(0)) = 0 AND "mode" IN ('payment', 'subscription'))),
  "offer_id" TEXT CHECK ("offer_id" IS NULL OR (typeof("offer_id") = 'text' AND instr("offer_id", char(0)) = 0 AND length("offer_id") >= 1 AND length("offer_id") <= 128)),
  "offer_revision" INTEGER CHECK ("offer_revision" IS NULL OR (typeof("offer_revision") = 'integer' AND "offer_revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "offer_revision" >= 1)),
  "owner_principal_id" TEXT CHECK ("owner_principal_id" IS NULL OR (typeof("owner_principal_id") = 'text' AND instr("owner_principal_id", char(0)) = 0 AND length("owner_principal_id") >= 1 AND length("owner_principal_id") <= 128)),
  "payment_status" TEXT NOT NULL CHECK ("payment_status" IS NOT NULL AND (typeof("payment_status") = 'text' AND instr("payment_status", char(0)) = 0 AND length("payment_status") >= 1 AND length("payment_status") <= 32)),
  "price_id" TEXT NOT NULL CHECK ("price_id" IS NOT NULL AND (typeof("price_id") = 'text' AND instr("price_id", char(0)) = 0 AND length("price_id") >= 1 AND length("price_id") <= 128)),
  "product_id" TEXT CHECK ("product_id" IS NULL OR (typeof("product_id") = 'text' AND instr("product_id", char(0)) = 0 AND length("product_id") >= 1 AND length("product_id") <= 128)),
  "quantity" INTEGER NOT NULL CHECK ("quantity" IS NOT NULL AND (typeof("quantity") = 'integer' AND "quantity" BETWEEN -9007199254740991 AND 9007199254740991 AND "quantity" >= 1 AND "quantity" <= 100)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND length("status") >= 1 AND length("status") <= 32)),
  "subscription_id" TEXT CHECK ("subscription_id" IS NULL OR (typeof("subscription_id") = 'text' AND instr("subscription_id", char(0)) = 0 AND length("subscription_id") >= 1 AND length("subscription_id") <= 128)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  "url" TEXT CHECK ("url" IS NULL OR (typeof("url") = 'text' AND instr("url", char(0)) = 0 AND length("url") >= 8 AND length("url") <= 2048)),
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

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f6576656e74" (
  "body_digest" TEXT NOT NULL CHECK ("body_digest" IS NOT NULL AND (typeof("body_digest") = 'text' AND instr("body_digest", char(0)) = 0 AND length("body_digest") >= 64 AND length("body_digest") <= 64)),
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "livemode" INTEGER NOT NULL CHECK ("livemode" IS NOT NULL AND (typeof("livemode") = 'integer' AND "livemode" IN (0, 1))),
  "object_id" TEXT NOT NULL CHECK ("object_id" IS NOT NULL AND (typeof("object_id") = 'text' AND instr("object_id", char(0)) = 0 AND length("object_id") >= 1 AND length("object_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "type" TEXT NOT NULL CHECK ("type" IS NOT NULL AND (typeof("type") = 'text' AND instr("type", char(0)) = 0 AND length("type") >= 1 AND length("type") <= 128)),
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

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f6f66666572" (
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "currency" TEXT NOT NULL CHECK ("currency" IS NOT NULL AND (typeof("currency") = 'text' AND instr("currency", char(0)) = 0 AND length("currency") >= 3 AND length("currency") <= 3)),
  "enabled" INTEGER NOT NULL CHECK ("enabled" IS NOT NULL AND (typeof("enabled") = 'integer' AND "enabled" IN (0, 1))),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "interval" TEXT CHECK ("interval" IS NULL OR (typeof("interval") = 'text' AND instr("interval", char(0)) = 0 AND length("interval") >= 1 AND length("interval") <= 16)),
  "interval_count" INTEGER CHECK ("interval_count" IS NULL OR (typeof("interval_count") = 'integer' AND "interval_count" BETWEEN -9007199254740991 AND 9007199254740991 AND "interval_count" >= 1)),
  "mode" TEXT NOT NULL CHECK ("mode" IS NOT NULL AND (typeof("mode") = 'text' AND instr("mode", char(0)) = 0 AND "mode" IN ('payment', 'subscription'))),
  "price_id" TEXT NOT NULL CHECK ("price_id" IS NOT NULL AND (typeof("price_id") = 'text' AND instr("price_id", char(0)) = 0 AND length("price_id") >= 1 AND length("price_id") <= 128)),
  "product_id" TEXT NOT NULL CHECK ("product_id" IS NOT NULL AND (typeof("product_id") = 'text' AND instr("product_id", char(0)) = 0 AND length("product_id") >= 1 AND length("product_id") <= 128)),
  "product_name" TEXT NOT NULL CHECK ("product_name" IS NOT NULL AND (typeof("product_name") = 'text' AND instr("product_name", char(0)) = 0 AND length("product_name") >= 1 AND length("product_name") <= 500)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "unit_amount_minor" INTEGER NOT NULL CHECK ("unit_amount_minor" IS NOT NULL AND (typeof("unit_amount_minor") = 'integer' AND "unit_amount_minor" BETWEEN -9007199254740991 AND 9007199254740991 AND "unit_amount_minor" >= 1)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f7072696365" (
  "active" INTEGER NOT NULL CHECK ("active" IS NOT NULL AND (typeof("active") = 'integer' AND "active" IN (0, 1))),
  "billing_scheme" TEXT NOT NULL CHECK ("billing_scheme" IS NOT NULL AND (typeof("billing_scheme") = 'text' AND instr("billing_scheme", char(0)) = 0 AND "billing_scheme" IN ('per_unit', 'tiered'))),
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "currency" TEXT NOT NULL CHECK ("currency" IS NOT NULL AND (typeof("currency") = 'text' AND instr("currency", char(0)) = 0 AND length("currency") >= 3 AND length("currency") <= 3)),
  "custom_amount" INTEGER NOT NULL CHECK ("custom_amount" IS NOT NULL AND (typeof("custom_amount") = 'integer' AND "custom_amount" IN (0, 1))),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "interval" TEXT CHECK ("interval" IS NULL OR (typeof("interval") = 'text' AND instr("interval", char(0)) = 0 AND length("interval") >= 1 AND length("interval") <= 16)),
  "interval_count" INTEGER CHECK ("interval_count" IS NULL OR (typeof("interval_count") = 'integer' AND "interval_count" BETWEEN -9007199254740991 AND 9007199254740991 AND "interval_count" >= 1)),
  "livemode" INTEGER NOT NULL CHECK ("livemode" IS NOT NULL AND (typeof("livemode") = 'integer' AND "livemode" IN (0, 1))),
  "product_id" TEXT NOT NULL CHECK ("product_id" IS NOT NULL AND (typeof("product_id") = 'text' AND instr("product_id", char(0)) = 0 AND length("product_id") >= 1 AND length("product_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "tiers_mode" TEXT CHECK ("tiers_mode" IS NULL OR (typeof("tiers_mode") = 'text' AND instr("tiers_mode", char(0)) = 0 AND length("tiers_mode") >= 1 AND length("tiers_mode") <= 16)),
  "type" TEXT NOT NULL CHECK ("type" IS NOT NULL AND (typeof("type") = 'text' AND instr("type", char(0)) = 0 AND "type" IN ('one_time', 'recurring'))),
  "unit_amount_decimal" TEXT CHECK ("unit_amount_decimal" IS NULL OR (typeof("unit_amount_decimal") = 'text' AND instr("unit_amount_decimal", char(0)) = 0 AND length("unit_amount_decimal") >= 1 AND length("unit_amount_decimal") <= 64)),
  "unit_amount_minor" INTEGER CHECK ("unit_amount_minor" IS NULL OR (typeof("unit_amount_minor") = 'integer' AND "unit_amount_minor" BETWEEN -9007199254740991 AND 9007199254740991 AND "unit_amount_minor" >= 0)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  "usage_type" TEXT CHECK ("usage_type" IS NULL OR (typeof("usage_type") = 'text' AND instr("usage_type", char(0)) = 0 AND length("usage_type") >= 1 AND length("usage_type") <= 16)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f70726f64756374" (
  "active" INTEGER NOT NULL CHECK ("active" IS NOT NULL AND (typeof("active") = 'integer' AND "active" IN (0, 1))),
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "default_price_id" TEXT CHECK ("default_price_id" IS NULL OR (typeof("default_price_id") = 'text' AND instr("default_price_id", char(0)) = 0 AND length("default_price_id") >= 1 AND length("default_price_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "livemode" INTEGER NOT NULL CHECK ("livemode" IS NOT NULL AND (typeof("livemode") = 'integer' AND "livemode" IN (0, 1))),
  "name" TEXT NOT NULL CHECK ("name" IS NOT NULL AND (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 1 AND length("name") <= 500)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737472697065_7374726970655f737562736372697074696f6e" (
  "cancel_at_period_end" INTEGER CHECK ("cancel_at_period_end" IS NULL OR (typeof("cancel_at_period_end") = 'integer' AND "cancel_at_period_end" IN (0, 1))),
  "connection_id" TEXT NOT NULL CHECK ("connection_id" IS NOT NULL AND (typeof("connection_id") = 'text' AND instr("connection_id", char(0)) = 0 AND length("connection_id") >= 1 AND length("connection_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "currency" TEXT CHECK ("currency" IS NULL OR (typeof("currency") = 'text' AND instr("currency", char(0)) = 0 AND length("currency") >= 3 AND length("currency") <= 3)),
  "customer_id" TEXT NOT NULL CHECK ("customer_id" IS NOT NULL AND (typeof("customer_id") = 'text' AND instr("customer_id", char(0)) = 0 AND length("customer_id") >= 1 AND length("customer_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "interval" TEXT CHECK ("interval" IS NULL OR (typeof("interval") = 'text' AND instr("interval", char(0)) = 0 AND length("interval") >= 1 AND length("interval") <= 32)),
  "interval_count" INTEGER CHECK ("interval_count" IS NULL OR (typeof("interval_count") = 'integer' AND "interval_count" BETWEEN -9007199254740991 AND 9007199254740991 AND "interval_count" >= 1)),
  "item_id" TEXT CHECK ("item_id" IS NULL OR (typeof("item_id") = 'text' AND instr("item_id", char(0)) = 0 AND length("item_id") >= 1 AND length("item_id") <= 128)),
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

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f636865636b6f7574_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f636865636b6f7574" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f637573746f6d6572_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f637573746f6d6572" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f6576656e74_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f6576656e74" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f696e766f696365_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f696e766f696365" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f6f66666572_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f6f66666572" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f7072696365_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f7072696365" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f70726f64756374_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f70726f64756374" ("context_id", "connection_id", "id");

CREATE INDEX "cz_637265657a696f2e737472697065_7374726970655f737562736372697074696f6e_idx_62792d636f6e6e656374696f6e" ON "cz_637265657a696f2e737472697065_7374726970655f737562736372697074696f6e" ("context_id", "connection_id", "id");
