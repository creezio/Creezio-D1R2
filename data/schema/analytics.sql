-- Creezio D1 current-model creation v1
-- Module: creezio.analytics
-- Inspect before applying to a new database. No automatic repair.

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

CREATE INDEX "cz_637265657a696f2e616e616c7974696373_6576656e74_idx_62792d74696d65" ON "cz_637265657a696f2e616e616c7974696373_6576656e74" ("context_id", "created_at", "id");
