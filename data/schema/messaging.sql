-- Creezio D1 current-model creation v1
-- Module: creezio.messaging
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e6d6573736167696e67_626f78" (
  "address" TEXT NOT NULL CHECK ("address" IS NOT NULL AND (typeof("address") = 'text' AND instr("address", char(0)) = 0 AND length("address") >= 0 AND length("address") <= 320)),
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "kind" TEXT NOT NULL CHECK ("kind" IS NOT NULL AND (typeof("kind") = 'text' AND instr("kind", char(0)) = 0 AND "kind" IN ('local'))),
  "name" TEXT NOT NULL CHECK ("name" IS NOT NULL AND (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 1 AND length("name") <= 120)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "owner_id", "audience", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d6573736167696e67_6472616674" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "bcc_addr" TEXT NOT NULL CHECK ("bcc_addr" IS NOT NULL AND (typeof("bcc_addr") = 'text' AND instr("bcc_addr", char(0)) = 0 AND length("bcc_addr") >= 0 AND length("bcc_addr") <= 2048)),
  "box_id" TEXT NOT NULL CHECK ("box_id" IS NOT NULL AND (typeof("box_id") = 'text' AND instr("box_id", char(0)) = 0 AND length("box_id") >= 1 AND length("box_id") <= 128)),
  "cc_addr" TEXT NOT NULL CHECK ("cc_addr" IS NOT NULL AND (typeof("cc_addr") = 'text' AND instr("cc_addr", char(0)) = 0 AND length("cc_addr") >= 0 AND length("cc_addr") <= 2048)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "html_body" TEXT NOT NULL CHECK ("html_body" IS NOT NULL AND (typeof("html_body") = 'text' AND instr("html_body", char(0)) = 0 AND length("html_body") >= 0 AND length("html_body") <= 32000)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "subject" TEXT NOT NULL CHECK ("subject" IS NOT NULL AND (typeof("subject") = 'text' AND instr("subject", char(0)) = 0 AND length("subject") >= 0 AND length("subject") <= 240)),
  "text_body" TEXT NOT NULL CHECK ("text_body" IS NOT NULL AND (typeof("text_body") = 'text' AND instr("text_body", char(0)) = 0 AND length("text_body") >= 0 AND length("text_body") <= 16000)),
  "to_addr" TEXT NOT NULL CHECK ("to_addr" IS NOT NULL AND (typeof("to_addr") = 'text' AND instr("to_addr", char(0)) = 0 AND length("to_addr") >= 0 AND length("to_addr") <= 2048)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "owner_id", "audience", "box_id", "id"),
  FOREIGN KEY ("context_id", "owner_id", "audience", "box_id") REFERENCES "cz_637265657a696f2e6d6573736167696e67_626f78" ("context_id", "owner_id", "audience", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d6573736167696e67_64726166745f6174746163686d656e74" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "box_id" TEXT NOT NULL CHECK ("box_id" IS NOT NULL AND (typeof("box_id") = 'text' AND instr("box_id", char(0)) = 0 AND length("box_id") >= 1 AND length("box_id") <= 128)),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" IS NOT NULL AND (typeof("byte_size") = 'integer' AND "byte_size" BETWEEN -9007199254740991 AND 9007199254740991 AND "byte_size" >= 0 AND "byte_size" <= 9007199254740991)),
  "content_type" TEXT NOT NULL CHECK ("content_type" IS NOT NULL AND (typeof("content_type") = 'text' AND instr("content_type", char(0)) = 0 AND length("content_type") >= 1 AND length("content_type") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "digest" TEXT NOT NULL CHECK ("digest" IS NOT NULL AND (typeof("digest") = 'text' AND instr("digest", char(0)) = 0 AND length("digest") >= 64 AND length("digest") <= 64)),
  "draft_id" TEXT NOT NULL CHECK ("draft_id" IS NOT NULL AND (typeof("draft_id") = 'text' AND instr("draft_id", char(0)) = 0 AND length("draft_id") >= 1 AND length("draft_id") <= 128)),
  "file_id" TEXT NOT NULL CHECK ("file_id" IS NOT NULL AND (typeof("file_id") = 'text' AND instr("file_id", char(0)) = 0 AND length("file_id") >= 1 AND length("file_id") <= 67)),
  "filename" TEXT NOT NULL CHECK ("filename" IS NOT NULL AND (typeof("filename") = 'text' AND instr("filename", char(0)) = 0 AND length("filename") >= 1 AND length("filename") <= 255)),
  "generation" TEXT NOT NULL CHECK ("generation" IS NOT NULL AND (typeof("generation") = 'text' AND instr("generation", char(0)) = 0 AND length("generation") >= 1 AND length("generation") <= 128)),
  "intent_id" TEXT NOT NULL CHECK ("intent_id" IS NOT NULL AND (typeof("intent_id") = 'text' AND instr("intent_id", char(0)) = 0 AND length("intent_id") >= 1 AND length("intent_id") <= 128)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  PRIMARY KEY ("context_id", "owner_id", "audience", "box_id", "draft_id", "file_id"),
  FOREIGN KEY ("context_id", "owner_id", "audience", "box_id") REFERENCES "cz_637265657a696f2e6d6573736167696e67_626f78" ("context_id", "owner_id", "audience", "id") ON DELETE RESTRICT,
  FOREIGN KEY ("context_id", "owner_id", "audience", "box_id", "draft_id") REFERENCES "cz_637265657a696f2e6d6573736167696e67_6472616674" ("context_id", "owner_id", "audience", "box_id", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d6573736167696e67_66696c655f6d65746164617461" (
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" IS NOT NULL AND (typeof("byte_size") = 'integer' AND "byte_size" BETWEEN -9007199254740991 AND 9007199254740991 AND "byte_size" >= 0 AND "byte_size" <= 9007199254740991)),
  "content_type" TEXT NOT NULL CHECK ("content_type" IS NOT NULL AND (typeof("content_type") = 'text' AND instr("content_type", char(0)) = 0 AND length("content_type") >= 1 AND length("content_type") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "digest" TEXT NOT NULL CHECK ("digest" IS NOT NULL AND (typeof("digest") = 'text' AND instr("digest", char(0)) = 0 AND length("digest") >= 64 AND length("digest") <= 64)),
  "file_id" TEXT NOT NULL CHECK ("file_id" IS NOT NULL AND (typeof("file_id") = 'text' AND instr("file_id", char(0)) = 0 AND length("file_id") >= 1 AND length("file_id") <= 67)),
  "file_owner" TEXT NOT NULL CHECK ("file_owner" IS NOT NULL AND (typeof("file_owner") = 'text' AND instr("file_owner", char(0)) = 0 AND length("file_owner") >= 1 AND length("file_owner") <= 260)),
  "filename" TEXT NOT NULL CHECK ("filename" IS NOT NULL AND (typeof("filename") = 'text' AND instr("filename", char(0)) = 0 AND length("filename") >= 1 AND length("filename") <= 255)),
  "generation" TEXT NOT NULL CHECK ("generation" IS NOT NULL AND (typeof("generation") = 'text' AND instr("generation", char(0)) = 0 AND length("generation") >= 1 AND length("generation") <= 128)),
  "intent_id" TEXT NOT NULL CHECK ("intent_id" IS NOT NULL AND (typeof("intent_id") = 'text' AND instr("intent_id", char(0)) = 0 AND length("intent_id") >= 1 AND length("intent_id") <= 128)),
  "object_key" TEXT NOT NULL CHECK ("object_key" IS NOT NULL AND (typeof("object_key") = 'text' AND instr("object_key", char(0)) = 0 AND length("object_key") >= 1 AND length("object_key") <= 512)),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('staging', 'staged', 'available', 'abandoned', 'deleted'))),
  "version" INTEGER NOT NULL CHECK ("version" IS NOT NULL AND (typeof("version") = 'integer' AND "version" BETWEEN -9007199254740991 AND 9007199254740991 AND "version" >= 1 AND "version" <= 9007199254740991)),
  PRIMARY KEY ("context_id", "file_id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e6d6573736167696e67_6d657373616765" (
  "audience" TEXT NOT NULL CHECK ("audience" IS NOT NULL AND (typeof("audience") = 'text' AND instr("audience", char(0)) = 0 AND "audience" IN ('admin', 'app'))),
  "box_id" TEXT NOT NULL CHECK ("box_id" IS NOT NULL AND (typeof("box_id") = 'text' AND instr("box_id", char(0)) = 0 AND length("box_id") >= 1 AND length("box_id") <= 128)),
  "cc_addr" TEXT NOT NULL CHECK ("cc_addr" IS NOT NULL AND (typeof("cc_addr") = 'text' AND instr("cc_addr", char(0)) = 0 AND length("cc_addr") >= 0 AND length("cc_addr") <= 2048)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "direction" TEXT NOT NULL CHECK ("direction" IS NOT NULL AND (typeof("direction") = 'text' AND instr("direction", char(0)) = 0 AND "direction" IN ('inbound', 'outbound'))),
  "folder" TEXT NOT NULL CHECK ("folder" IS NOT NULL AND (typeof("folder") = 'text' AND instr("folder", char(0)) = 0 AND "folder" IN ('inbox', 'sent', 'outbox', 'archive', 'trash'))),
  "from_addr" TEXT NOT NULL CHECK ("from_addr" IS NOT NULL AND (typeof("from_addr") = 'text' AND instr("from_addr", char(0)) = 0 AND length("from_addr") >= 0 AND length("from_addr") <= 320)),
  "html_body" TEXT NOT NULL CHECK ("html_body" IS NOT NULL AND (typeof("html_body") = 'text' AND instr("html_body", char(0)) = 0 AND length("html_body") >= 0 AND length("html_body") <= 32000)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "in_reply_to" TEXT CHECK ("in_reply_to" IS NULL OR (typeof("in_reply_to") = 'text' AND instr("in_reply_to", char(0)) = 0 AND length("in_reply_to") >= 1 AND length("in_reply_to") <= 256)),
  "owner_id" TEXT NOT NULL CHECK ("owner_id" IS NOT NULL AND (typeof("owner_id") = 'text' AND instr("owner_id", char(0)) = 0 AND length("owner_id") >= 1 AND length("owner_id") <= 128)),
  "provider_message_id" TEXT CHECK ("provider_message_id" IS NULL OR (typeof("provider_message_id") = 'text' AND instr("provider_message_id", char(0)) = 0 AND length("provider_message_id") >= 1 AND length("provider_message_id") <= 256)),
  "read_at" TEXT CHECK ("read_at" IS NULL OR (typeof("read_at") = 'text' AND length("read_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "read_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "read_at") = "read_at")),
  "received_at" TEXT CHECK ("received_at" IS NULL OR (typeof("received_at") = 'text' AND length("received_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "received_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "received_at") = "received_at")),
  "reply_to" TEXT CHECK ("reply_to" IS NULL OR (typeof("reply_to") = 'text' AND instr("reply_to", char(0)) = 0 AND length("reply_to") >= 1 AND length("reply_to") <= 320)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "sent_at" TEXT CHECK ("sent_at" IS NULL OR (typeof("sent_at") = 'text' AND length("sent_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "sent_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "sent_at") = "sent_at")),
  "state" TEXT NOT NULL CHECK ("state" IS NOT NULL AND (typeof("state") = 'text' AND instr("state", char(0)) = 0 AND "state" IN ('received', 'queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'unknown'))),
  "subject" TEXT NOT NULL CHECK ("subject" IS NOT NULL AND (typeof("subject") = 'text' AND instr("subject", char(0)) = 0 AND length("subject") >= 0 AND length("subject") <= 240)),
  "text_body" TEXT NOT NULL CHECK ("text_body" IS NOT NULL AND (typeof("text_body") = 'text' AND instr("text_body", char(0)) = 0 AND length("text_body") >= 0 AND length("text_body") <= 16000)),
  "thread_id" TEXT CHECK ("thread_id" IS NULL OR (typeof("thread_id") = 'text' AND instr("thread_id", char(0)) = 0 AND length("thread_id") >= 1 AND length("thread_id") <= 128)),
  "to_addr" TEXT NOT NULL CHECK ("to_addr" IS NOT NULL AND (typeof("to_addr") = 'text' AND instr("to_addr", char(0)) = 0 AND length("to_addr") >= 0 AND length("to_addr") <= 2048)),
  PRIMARY KEY ("context_id", "owner_id", "audience", "box_id", "id"),
  FOREIGN KEY ("context_id", "owner_id", "audience", "box_id") REFERENCES "cz_637265657a696f2e6d6573736167696e67_626f78" ("context_id", "owner_id", "audience", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e6d6573736167696e67_626f78_idx_726563656e742d626f786573" ON "cz_637265657a696f2e6d6573736167696e67_626f78" ("context_id", "owner_id", "audience", "updated_at", "id");

CREATE INDEX "cz_637265657a696f2e6d6573736167696e67_6472616674_idx_726563656e742d647261667473" ON "cz_637265657a696f2e6d6573736167696e67_6472616674" ("context_id", "owner_id", "audience", "box_id", "updated_at", "id");

CREATE INDEX "cz_637265657a696f2e6d6573736167696e67_64726166745f6174746163686d656e74_idx_62792d6472616674" ON "cz_637265657a696f2e6d6573736167696e67_64726166745f6174746163686d656e74" ("context_id", "owner_id", "audience", "box_id", "draft_id", "created_at", "file_id");

CREATE UNIQUE INDEX "cz_637265657a696f2e6d6573736167696e67_66696c655f6d65746164617461_idx_696e74656e74" ON "cz_637265657a696f2e6d6573736167696e67_66696c655f6d65746164617461" ("context_id", "intent_id", "generation");

CREATE UNIQUE INDEX "cz_637265657a696f2e6d6573736167696e67_66696c655f6d65746164617461_idx_6f626a6563742d6b6579" ON "cz_637265657a696f2e6d6573736167696e67_66696c655f6d65746164617461" ("context_id", "object_key");

CREATE INDEX "cz_637265657a696f2e6d6573736167696e67_6d657373616765_idx_726563656e742d6d65737361676573" ON "cz_637265657a696f2e6d6573736167696e67_6d657373616765" ("context_id", "owner_id", "audience", "box_id", "created_at", "id");
