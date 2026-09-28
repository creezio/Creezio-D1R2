-- Creezio D1 current-model creation v1
-- Module: creezio.crm
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e63726d_636f6d70616e79" (
  "archived_at" TEXT CHECK ("archived_at" IS NULL OR (typeof("archived_at") = 'text' AND length("archived_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") = "archived_at")),
  "city" TEXT CHECK ("city" IS NULL OR (typeof("city") = 'text' AND instr("city", char(0)) = 0 AND length("city") >= 0 AND length("city") <= 240)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "name" TEXT NOT NULL CHECK ("name" IS NOT NULL AND (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 1 AND length("name") <= 240)),
  "notes" TEXT CHECK ("notes" IS NULL OR (typeof("notes") = 'text' AND instr("notes", char(0)) = 0 AND length("notes") >= 0 AND length("notes") <= 4000)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  "website" TEXT CHECK ("website" IS NULL OR (typeof("website") = 'text' AND instr("website", char(0)) = 0 AND length("website") >= 0 AND length("website") <= 512)),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e63726d_636f6e74616374" (
  "archived_at" TEXT CHECK ("archived_at" IS NULL OR (typeof("archived_at") = 'text' AND length("archived_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") = "archived_at")),
  "city" TEXT CHECK ("city" IS NULL OR (typeof("city") = 'text' AND instr("city", char(0)) = 0 AND length("city") >= 0 AND length("city") <= 240)),
  "company_id" TEXT CHECK ("company_id" IS NULL OR (typeof("company_id") = 'text' AND instr("company_id", char(0)) = 0 AND length("company_id") >= 1 AND length("company_id") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "email" TEXT CHECK ("email" IS NULL OR (typeof("email") = 'text' AND instr("email", char(0)) = 0 AND length("email") >= 0 AND length("email") <= 320)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "name" TEXT NOT NULL CHECK ("name" IS NOT NULL AND (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 1 AND length("name") <= 240)),
  "notes" TEXT CHECK ("notes" IS NULL OR (typeof("notes") = 'text' AND instr("notes", char(0)) = 0 AND length("notes") >= 0 AND length("notes") <= 4000)),
  "phone" TEXT CHECK ("phone" IS NULL OR (typeof("phone") = 'text' AND instr("phone", char(0)) = 0 AND length("phone") >= 0 AND length("phone") <= 240)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id"),
  FOREIGN KEY ("context_id", "company_id") REFERENCES "cz_637265657a696f2e63726d_636f6d70616e79" ("context_id", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e63726d_70726f7370656374" (
  "archived_at" TEXT CHECK ("archived_at" IS NULL OR (typeof("archived_at") = 'text' AND length("archived_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") = "archived_at")),
  "city" TEXT CHECK ("city" IS NULL OR (typeof("city") = 'text' AND instr("city", char(0)) = 0 AND length("city") >= 0 AND length("city") <= 240)),
  "company_id" TEXT CHECK ("company_id" IS NULL OR (typeof("company_id") = 'text' AND instr("company_id", char(0)) = 0 AND length("company_id") >= 1 AND length("company_id") <= 128)),
  "contact_id" TEXT CHECK ("contact_id" IS NULL OR (typeof("contact_id") = 'text' AND instr("contact_id", char(0)) = 0 AND length("contact_id") >= 1 AND length("contact_id") <= 128)),
  "contact_name" TEXT CHECK ("contact_name" IS NULL OR (typeof("contact_name") = 'text' AND instr("contact_name", char(0)) = 0 AND length("contact_name") >= 0 AND length("contact_name") <= 240)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "email" TEXT CHECK ("email" IS NULL OR (typeof("email") = 'text' AND instr("email", char(0)) = 0 AND length("email") >= 0 AND length("email") <= 320)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "name" TEXT NOT NULL CHECK ("name" IS NOT NULL AND (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 1 AND length("name") <= 240)),
  "notes" TEXT CHECK ("notes" IS NULL OR (typeof("notes") = 'text' AND instr("notes", char(0)) = 0 AND length("notes") >= 0 AND length("notes") <= 4000)),
  "phone" TEXT CHECK ("phone" IS NULL OR (typeof("phone") = 'text' AND instr("phone", char(0)) = 0 AND length("phone") >= 0 AND length("phone") <= 240)),
  "position" INTEGER NOT NULL CHECK ("position" IS NOT NULL AND (typeof("position") = 'integer' AND "position" BETWEEN -9007199254740991 AND 9007199254740991 AND "position" >= 0 AND "position" <= 9007199254740991)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "stage" TEXT NOT NULL CHECK ("stage" IS NOT NULL AND (typeof("stage") = 'text' AND instr("stage", char(0)) = 0 AND "stage" IN ('a_contacter', 'contacte', 'rdv', 'client', 'perdu'))),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  "website" TEXT CHECK ("website" IS NULL OR (typeof("website") = 'text' AND instr("website", char(0)) = 0 AND length("website") >= 0 AND length("website") <= 512)),
  PRIMARY KEY ("context_id", "id"),
  FOREIGN KEY ("context_id", "company_id") REFERENCES "cz_637265657a696f2e63726d_636f6d70616e79" ("context_id", "id") ON DELETE RESTRICT,
  FOREIGN KEY ("context_id", "contact_id") REFERENCES "cz_637265657a696f2e63726d_636f6e74616374" ("context_id", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e63726d_636f6d70616e79_idx_726563656e74" ON "cz_637265657a696f2e63726d_636f6d70616e79" ("context_id", "updated_at", "id");

CREATE INDEX "cz_637265657a696f2e63726d_636f6e74616374_idx_726563656e74" ON "cz_637265657a696f2e63726d_636f6e74616374" ("context_id", "updated_at", "id");

CREATE INDEX "cz_637265657a696f2e63726d_70726f7370656374_idx_726563656e74" ON "cz_637265657a696f2e63726d_70726f7370656374" ("context_id", "updated_at", "id");
