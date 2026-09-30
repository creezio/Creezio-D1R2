-- Creezio D1 current-model creation v1
-- Module: creezio.analytics
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e616e616c7974696373_636f6c6c656374696f6e5f706f6c696379" (
  "clicks_enabled" INTEGER NOT NULL CHECK ("clicks_enabled" IS NOT NULL AND (typeof("clicks_enabled") = 'integer' AND "clicks_enabled" IN (0, 1))),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 36)),
  "navigation_enabled" INTEGER NOT NULL CHECK ("navigation_enabled" IS NOT NULL AND (typeof("navigation_enabled") = 'integer' AND "navigation_enabled" IN (0, 1))),
  "refusal_retention_days" INTEGER NOT NULL CHECK ("refusal_retention_days" IS NOT NULL AND (typeof("refusal_retention_days") = 'integer' AND "refusal_retention_days" BETWEEN -9007199254740991 AND 9007199254740991 AND "refusal_retention_days" >= 1 AND "refusal_retention_days" <= 365)),
  "refusals_enabled" INTEGER NOT NULL CHECK ("refusals_enabled" IS NOT NULL AND (typeof("refusals_enabled") = 'integer' AND "refusals_enabled" IN (0, 1))),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616e616c7974696373_6576656e74" (
  "action_id" TEXT CHECK ("action_id" IS NULL OR (typeof("action_id") = 'text' AND instr("action_id", char(0)) = 0 AND length("action_id") >= 1 AND length("action_id") <= 80)),
  "actor_principal_id" TEXT NOT NULL CHECK ("actor_principal_id" IS NOT NULL AND (typeof("actor_principal_id") = 'text' AND instr("actor_principal_id", char(0)) = 0 AND length("actor_principal_id") >= 1 AND length("actor_principal_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "duration_ms" INTEGER CHECK ("duration_ms" IS NULL OR (typeof("duration_ms") = 'integer' AND "duration_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "duration_ms" >= 0 AND "duration_ms" <= 86400000)),
  "error_code" TEXT CHECK ("error_code" IS NULL OR (typeof("error_code") = 'text' AND instr("error_code", char(0)) = 0 AND length("error_code") >= 1 AND length("error_code") <= 80)),
  "event_type" TEXT NOT NULL CHECK ("event_type" IS NOT NULL AND (typeof("event_type") = 'text' AND instr("event_type", char(0)) = 0 AND "event_type" IN ('page_view', 'click', 'activity', 'error'))),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 36)),
  "path" TEXT CHECK ("path" IS NULL OR (typeof("path") = 'text' AND instr("path", char(0)) = 0 AND length("path") >= 1 AND length("path") <= 256)),
  "principal_id" TEXT NOT NULL CHECK ("principal_id" IS NOT NULL AND (typeof("principal_id") = 'text' AND instr("principal_id", char(0)) = 0 AND length("principal_id") >= 1 AND length("principal_id") <= 128)),
  "surface" TEXT NOT NULL CHECK ("surface" IS NOT NULL AND (typeof("surface") = 'text' AND instr("surface", char(0)) = 0 AND length("surface") >= 1 AND length("surface") <= 64)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616e616c7974696373_726574656e74696f6e5f706f6c696379" (
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 36)),
  "retention_days" INTEGER NOT NULL CHECK ("retention_days" IS NOT NULL AND (typeof("retention_days") = 'integer' AND "retention_days" BETWEEN -9007199254740991 AND 9007199254740991 AND "retention_days" >= 1 AND "retention_days" <= 3650)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e616e616c7974696373_7472616e73706f72745f7265667573616c" (
  "created_at_ms" INTEGER NOT NULL CHECK ("created_at_ms" IS NOT NULL AND (typeof("created_at_ms") = 'integer' AND "created_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "created_at_ms" >= 0 AND "created_at_ms" <= 9007199254740991)),
  "duration_ms" INTEGER NOT NULL CHECK ("duration_ms" IS NOT NULL AND (typeof("duration_ms") = 'integer' AND "duration_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "duration_ms" >= 0 AND "duration_ms" <= 9007199254740991)),
  "error_code" TEXT NOT NULL CHECK ("error_code" IS NOT NULL AND (typeof("error_code") = 'text' AND instr("error_code", char(0)) = 0 AND length("error_code") >= 1 AND length("error_code") <= 80)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 36)),
  "method" TEXT NOT NULL CHECK ("method" IS NOT NULL AND (typeof("method") = 'text' AND instr("method", char(0)) = 0 AND "method" IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'))),
  "route_template" TEXT NOT NULL CHECK ("route_template" IS NOT NULL AND (typeof("route_template") = 'text' AND instr("route_template", char(0)) = 0 AND length("route_template") >= 1 AND length("route_template") <= 512)),
  "status" INTEGER NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'integer' AND "status" BETWEEN -9007199254740991 AND 9007199254740991 AND "status" >= 400 AND "status" <= 599)),
  "transport" TEXT NOT NULL CHECK ("transport" IS NOT NULL AND (typeof("transport") = 'text' AND instr("transport", char(0)) = 0 AND "transport" IN ('api', 'mcp'))),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e616e616c7974696373_6576656e74_idx_62792d74696d65" ON "cz_637265657a696f2e616e616c7974696373_6576656e74" ("context_id", "created_at", "id");

CREATE INDEX "cz_637265657a696f2e616e616c7974696373_7472616e73706f72745f7265667573616c_idx_62792d74696d65" ON "cz_637265657a696f2e616e616c7974696373_7472616e73706f72745f7265667573616c" ("created_at_ms", "id");
