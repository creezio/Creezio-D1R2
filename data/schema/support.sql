-- Creezio D1 current-model creation v1
-- Module: creezio.support
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e737570706f7274_6d657373616765" (
  "author_id" TEXT NOT NULL CHECK ("author_id" IS NOT NULL AND (typeof("author_id") = 'text' AND instr("author_id", char(0)) = 0 AND length("author_id") >= 1 AND length("author_id") <= 128)),
  "body" TEXT NOT NULL CHECK ("body" IS NOT NULL AND (typeof("body") = 'text' AND instr("body", char(0)) = 0 AND length("body") >= 1 AND length("body") <= 4000)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "origin" TEXT NOT NULL CHECK ("origin" IS NOT NULL AND (typeof("origin") = 'text' AND instr("origin", char(0)) = 0 AND "origin" IN ('client', 'support'))),
  "ticket_id" TEXT NOT NULL CHECK ("ticket_id" IS NOT NULL AND (typeof("ticket_id") = 'text' AND instr("ticket_id", char(0)) = 0 AND length("ticket_id") >= 1 AND length("ticket_id") <= 128)),
  PRIMARY KEY ("context_id", "ticket_id", "id"),
  FOREIGN KEY ("context_id", "ticket_id") REFERENCES "cz_637265657a696f2e737570706f7274_7469636b6574" ("context_id", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e737570706f7274_7469636b6574" (
  "assigned_to" TEXT CHECK ("assigned_to" IS NULL OR (typeof("assigned_to") = 'text' AND instr("assigned_to", char(0)) = 0 AND length("assigned_to") >= 1 AND length("assigned_to") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "last_message_at" TEXT CHECK ("last_message_at" IS NULL OR (typeof("last_message_at") = 'text' AND length("last_message_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "last_message_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "last_message_at") = "last_message_at")),
  "last_preview" TEXT CHECK ("last_preview" IS NULL OR (typeof("last_preview") = 'text' AND instr("last_preview", char(0)) = 0 AND length("last_preview") >= 0 AND length("last_preview") <= 240)),
  "message_count" INTEGER NOT NULL CHECK ("message_count" IS NOT NULL AND (typeof("message_count") = 'integer' AND "message_count" BETWEEN -9007199254740991 AND 9007199254740991 AND "message_count" >= 0 AND "message_count" <= 9007199254740991)),
  "requester_id" TEXT NOT NULL CHECK ("requester_id" IS NOT NULL AND (typeof("requester_id") = 'text' AND instr("requester_id", char(0)) = 0 AND length("requester_id") >= 1 AND length("requester_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('ouvert', 'repondu', 'resolu', 'ferme'))),
  "subject" TEXT NOT NULL CHECK ("subject" IS NOT NULL AND (typeof("subject") = 'text' AND instr("subject", char(0)) = 0 AND length("subject") >= 1 AND length("subject") <= 240)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e737570706f7274_6d657373616765_idx_62792d7469636b6574" ON "cz_637265657a696f2e737570706f7274_6d657373616765" ("context_id", "ticket_id", "created_at", "id");

CREATE INDEX "cz_637265657a696f2e737570706f7274_7469636b6574_idx_726563656e74" ON "cz_637265657a696f2e737570706f7274_7469636b6574" ("context_id", "updated_at", "id");
