-- Creezio D1 current-model creation v1
-- Module: creezio.modules-settings
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e6d6f64756c65732d73657474696e6773_68656164" (
  "accepted_at_ms" INTEGER NOT NULL CHECK ("accepted_at_ms" IS NOT NULL AND (typeof("accepted_at_ms") = 'integer' AND "accepted_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "accepted_at_ms" >= 0 AND "accepted_at_ms" <= 9007199254740991)),
  "accepted_plan_digest" TEXT NOT NULL CHECK ("accepted_plan_digest" IS NOT NULL AND (typeof("accepted_plan_digest") = 'text' AND instr("accepted_plan_digest", char(0)) = 0 AND length("accepted_plan_digest") >= 71 AND length("accepted_plan_digest") <= 71)),
  "accepted_plan_id" TEXT NOT NULL CHECK ("accepted_plan_id" IS NOT NULL AND (typeof("accepted_plan_id") = 'text' AND instr("accepted_plan_id", char(0)) = 0 AND length("accepted_plan_id") >= 1 AND length("accepted_plan_id") <= 128)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 11 AND "id" IN ('application'))),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "target_composition_digest" TEXT NOT NULL CHECK ("target_composition_digest" IS NOT NULL AND (typeof("target_composition_digest") = 'text' AND instr("target_composition_digest", char(0)) = 0 AND length("target_composition_digest") >= 71 AND length("target_composition_digest") <= 71)),
  "target_lock_digest" TEXT NOT NULL CHECK ("target_lock_digest" IS NOT NULL AND (typeof("target_lock_digest") = 'text' AND instr("target_lock_digest", char(0)) = 0 AND length("target_lock_digest") >= 71 AND length("target_lock_digest") <= 71)),
  PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d6f64756c65732d73657474696e6773_6a6f75726e616c" (
  "actor_principal_id" TEXT NOT NULL CHECK ("actor_principal_id" IS NOT NULL AND (typeof("actor_principal_id") = 'text' AND instr("actor_principal_id", char(0)) = 0 AND length("actor_principal_id") >= 1 AND length("actor_principal_id") <= 128)),
  "base_composition_digest" TEXT NOT NULL CHECK ("base_composition_digest" IS NOT NULL AND (typeof("base_composition_digest") = 'text' AND instr("base_composition_digest", char(0)) = 0 AND length("base_composition_digest") >= 71 AND length("base_composition_digest") <= 71)),
  "event_kind" TEXT NOT NULL CHECK ("event_kind" IS NOT NULL AND (typeof("event_kind") = 'text' AND instr("event_kind", char(0)) = 0 AND length("event_kind") >= 1 AND length("event_kind") <= 32 AND "event_kind" IN ('plan-accepted'))),
  "occurred_at_ms" INTEGER NOT NULL CHECK ("occurred_at_ms" IS NOT NULL AND (typeof("occurred_at_ms") = 'integer' AND "occurred_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "occurred_at_ms" >= 0 AND "occurred_at_ms" <= 9007199254740991)),
  "plan_digest" TEXT NOT NULL CHECK ("plan_digest" IS NOT NULL AND (typeof("plan_digest") = 'text' AND instr("plan_digest", char(0)) = 0 AND length("plan_digest") >= 71 AND length("plan_digest") <= 71)),
  "plan_id" TEXT NOT NULL CHECK ("plan_id" IS NOT NULL AND (typeof("plan_id") = 'text' AND instr("plan_id", char(0)) = 0 AND length("plan_id") >= 1 AND length("plan_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "target_composition_digest" TEXT NOT NULL CHECK ("target_composition_digest" IS NOT NULL AND (typeof("target_composition_digest") = 'text' AND instr("target_composition_digest", char(0)) = 0 AND length("target_composition_digest") >= 71 AND length("target_composition_digest") <= 71)),
  PRIMARY KEY ("revision")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d6f64756c65732d73657474696e6773_706c616e2d6f7574636f6d6573" (
  "actor_principal_id" TEXT NOT NULL CHECK ("actor_principal_id" IS NOT NULL AND (typeof("actor_principal_id") = 'text' AND instr("actor_principal_id", char(0)) = 0 AND length("actor_principal_id") >= 1 AND length("actor_principal_id") <= 128)),
  "base_composition_digest" TEXT NOT NULL CHECK ("base_composition_digest" IS NOT NULL AND (typeof("base_composition_digest") = 'text' AND instr("base_composition_digest", char(0)) = 0 AND length("base_composition_digest") >= 71 AND length("base_composition_digest") <= 71)),
  "event_kind" TEXT NOT NULL CHECK ("event_kind" IS NOT NULL AND (typeof("event_kind") = 'text' AND instr("event_kind", char(0)) = 0 AND length("event_kind") >= 1 AND length("event_kind") <= 32 AND "event_kind" IN ('plan-effective', 'plan-cancelled'))),
  "observed_composition_digest" TEXT NOT NULL CHECK ("observed_composition_digest" IS NOT NULL AND (typeof("observed_composition_digest") = 'text' AND instr("observed_composition_digest", char(0)) = 0 AND length("observed_composition_digest") >= 71 AND length("observed_composition_digest") <= 71)),
  "observed_lock_digest" TEXT NOT NULL CHECK ("observed_lock_digest" IS NOT NULL AND (typeof("observed_lock_digest") = 'text' AND instr("observed_lock_digest", char(0)) = 0 AND length("observed_lock_digest") >= 71 AND length("observed_lock_digest") <= 71)),
  "occurred_at_ms" INTEGER NOT NULL CHECK ("occurred_at_ms" IS NOT NULL AND (typeof("occurred_at_ms") = 'integer' AND "occurred_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "occurred_at_ms" >= 0 AND "occurred_at_ms" <= 9007199254740991)),
  "plan_digest" TEXT NOT NULL CHECK ("plan_digest" IS NOT NULL AND (typeof("plan_digest") = 'text' AND instr("plan_digest", char(0)) = 0 AND length("plan_digest") >= 71 AND length("plan_digest") <= 71)),
  "plan_id" TEXT NOT NULL CHECK ("plan_id" IS NOT NULL AND (typeof("plan_id") = 'text' AND instr("plan_id", char(0)) = 0 AND length("plan_id") >= 1 AND length("plan_id") <= 128)),
  "reason" TEXT CHECK ("reason" IS NULL OR (typeof("reason") = 'text' AND instr("reason", char(0)) = 0 AND length("reason") >= 1 AND length("reason") <= 512)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "target_composition_digest" TEXT NOT NULL CHECK ("target_composition_digest" IS NOT NULL AND (typeof("target_composition_digest") = 'text' AND instr("target_composition_digest", char(0)) = 0 AND length("target_composition_digest") >= 71 AND length("target_composition_digest") <= 71)),
  "target_lock_digest" TEXT NOT NULL CHECK ("target_lock_digest" IS NOT NULL AND (typeof("target_lock_digest") = 'text' AND instr("target_lock_digest", char(0)) = 0 AND length("target_lock_digest") >= 71 AND length("target_lock_digest") <= 71)),
  PRIMARY KEY ("revision")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d6f64756c65732d73657474696e6773_706c616e73" (
  "accepted_at_ms" INTEGER NOT NULL CHECK ("accepted_at_ms" IS NOT NULL AND (typeof("accepted_at_ms") = 'integer' AND "accepted_at_ms" BETWEEN -9007199254740991 AND 9007199254740991 AND "accepted_at_ms" >= 0 AND "accepted_at_ms" <= 9007199254740991)),
  "accepted_by_principal_id" TEXT NOT NULL CHECK ("accepted_by_principal_id" IS NOT NULL AND (typeof("accepted_by_principal_id") = 'text' AND instr("accepted_by_principal_id", char(0)) = 0 AND length("accepted_by_principal_id") >= 1 AND length("accepted_by_principal_id") <= 128)),
  "base_composition_digest" TEXT NOT NULL CHECK ("base_composition_digest" IS NOT NULL AND (typeof("base_composition_digest") = 'text' AND instr("base_composition_digest", char(0)) = 0 AND length("base_composition_digest") >= 71 AND length("base_composition_digest") <= 71)),
  "base_lock_digest" TEXT NOT NULL CHECK ("base_lock_digest" IS NOT NULL AND (typeof("base_lock_digest") = 'text' AND instr("base_lock_digest", char(0)) = 0 AND length("base_lock_digest") >= 71 AND length("base_lock_digest") <= 71)),
  "choices_json" TEXT NOT NULL CHECK ("choices_json" IS NOT NULL AND (typeof("choices_json") = 'text' AND instr("choices_json", char(0)) = 0 AND length("choices_json") >= 1 AND length("choices_json") <= 8192)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "inventory_digest" TEXT NOT NULL CHECK ("inventory_digest" IS NOT NULL AND (typeof("inventory_digest") = 'text' AND instr("inventory_digest", char(0)) = 0 AND length("inventory_digest") >= 71 AND length("inventory_digest") <= 71)),
  "plan_digest" TEXT NOT NULL CHECK ("plan_digest" IS NOT NULL AND (typeof("plan_digest") = 'text' AND instr("plan_digest", char(0)) = 0 AND length("plan_digest") >= 71 AND length("plan_digest") <= 71)),
  "requires_publication" INTEGER NOT NULL CHECK ("requires_publication" IS NOT NULL AND (typeof("requires_publication") = 'integer' AND "requires_publication" IN (0, 1))),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "summary_digest" TEXT NOT NULL CHECK ("summary_digest" IS NOT NULL AND (typeof("summary_digest") = 'text' AND instr("summary_digest", char(0)) = 0 AND length("summary_digest") >= 71 AND length("summary_digest") <= 71)),
  "summary_json" TEXT NOT NULL CHECK ("summary_json" IS NOT NULL AND (typeof("summary_json") = 'text' AND instr("summary_json", char(0)) = 0 AND length("summary_json") >= 1 AND length("summary_json") <= 8192)),
  "target_composition_digest" TEXT NOT NULL CHECK ("target_composition_digest" IS NOT NULL AND (typeof("target_composition_digest") = 'text' AND instr("target_composition_digest", char(0)) = 0 AND length("target_composition_digest") >= 71 AND length("target_composition_digest") <= 71)),
  "target_lock_digest" TEXT NOT NULL CHECK ("target_lock_digest" IS NOT NULL AND (typeof("target_lock_digest") = 'text' AND instr("target_lock_digest", char(0)) = 0 AND length("target_lock_digest") >= 71 AND length("target_lock_digest") <= 71)),
  PRIMARY KEY ("id")
) WITHOUT ROWID;
