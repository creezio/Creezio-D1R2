-- Creezio D1 current-model creation v1
-- Module: creezio.pages-navigation
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e70616765732d6e617669676174696f6e_66696c655f6d65746164617461" (
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

CREATE TABLE "cz_637265657a696f2e70616765732d6e617669676174696f6e_6e617669676174696f6e" (
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "draft_items" TEXT NOT NULL CHECK ("draft_items" IS NOT NULL AND (typeof("draft_items") = 'text' AND json_valid("draft_items") = 1)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND "id" IN ('primary'))),
  "published_at" TEXT CHECK ("published_at" IS NULL OR (typeof("published_at") = 'text' AND length("published_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "published_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "published_at") = "published_at")),
  "published_items" TEXT NOT NULL CHECK ("published_items" IS NOT NULL AND (typeof("published_items") = 'text' AND json_valid("published_items") = 1)),
  "published_revision" INTEGER NOT NULL CHECK ("published_revision" IS NOT NULL AND (typeof("published_revision") = 'integer' AND "published_revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "published_revision" >= 0 AND "published_revision" <= 9007199254740991)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e70616765732d6e617669676174696f6e_70616765" (
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "draft_sections" TEXT NOT NULL CHECK ("draft_sections" IS NOT NULL AND (typeof("draft_sections") = 'text' AND json_valid("draft_sections") = 1)),
  "draft_seo" TEXT NOT NULL CHECK ("draft_seo" IS NOT NULL AND (typeof("draft_seo") = 'text' AND json_valid("draft_seo") = 1)),
  "draft_settings" TEXT NOT NULL CHECK ("draft_settings" IS NOT NULL AND (typeof("draft_settings") = 'text' AND json_valid("draft_settings") = 1)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 128)),
  "published_at" TEXT CHECK ("published_at" IS NULL OR (typeof("published_at") = 'text' AND length("published_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "published_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "published_at") = "published_at")),
  "published_revision" INTEGER NOT NULL CHECK ("published_revision" IS NOT NULL AND (typeof("published_revision") = 'integer' AND "published_revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "published_revision" >= 0 AND "published_revision" <= 9007199254740991)),
  "published_sections" TEXT CHECK ("published_sections" IS NULL OR (typeof("published_sections") = 'text' AND json_valid("published_sections") = 1)),
  "published_seo" TEXT CHECK ("published_seo" IS NULL OR (typeof("published_seo") = 'text' AND json_valid("published_seo") = 1)),
  "published_settings" TEXT CHECK ("published_settings" IS NULL OR (typeof("published_settings") = 'text' AND json_valid("published_settings") = 1)),
  "published_slug" TEXT CHECK ("published_slug" IS NULL OR (typeof("published_slug") = 'text' AND instr("published_slug", char(0)) = 0 AND length("published_slug") >= 1 AND length("published_slug") <= 160)),
  "published_title" TEXT CHECK ("published_title" IS NULL OR (typeof("published_title") = 'text' AND instr("published_title", char(0)) = 0 AND length("published_title") >= 1 AND length("published_title") <= 240)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "slug" TEXT NOT NULL CHECK ("slug" IS NOT NULL AND (typeof("slug") = 'text' AND instr("slug", char(0)) = 0 AND length("slug") >= 1 AND length("slug") <= 160)),
  "title" TEXT NOT NULL CHECK ("title" IS NOT NULL AND (typeof("title") = 'text' AND instr("title", char(0)) = 0 AND length("title") >= 1 AND length("title") <= 240)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e70616765732d6e617669676174696f6e_706167655f6d65646961" (
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" IS NOT NULL AND (typeof("byte_size") = 'integer' AND "byte_size" BETWEEN -9007199254740991 AND 9007199254740991 AND "byte_size" >= 0 AND "byte_size" <= 9007199254740991)),
  "content_type" TEXT NOT NULL CHECK ("content_type" IS NOT NULL AND (typeof("content_type") = 'text' AND instr("content_type", char(0)) = 0 AND length("content_type") >= 1 AND length("content_type") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "digest" TEXT NOT NULL CHECK ("digest" IS NOT NULL AND (typeof("digest") = 'text' AND instr("digest", char(0)) = 0 AND length("digest") >= 64 AND length("digest") <= 64)),
  "file_id" TEXT NOT NULL CHECK ("file_id" IS NOT NULL AND (typeof("file_id") = 'text' AND instr("file_id", char(0)) = 0 AND length("file_id") >= 1 AND length("file_id") <= 67)),
  "filename" TEXT NOT NULL CHECK ("filename" IS NOT NULL AND (typeof("filename") = 'text' AND instr("filename", char(0)) = 0 AND length("filename") >= 1 AND length("filename") <= 255)),
  "generation" TEXT NOT NULL CHECK ("generation" IS NOT NULL AND (typeof("generation") = 'text' AND instr("generation", char(0)) = 0 AND length("generation") >= 1 AND length("generation") <= 128)),
  "intent_id" TEXT NOT NULL CHECK ("intent_id" IS NOT NULL AND (typeof("intent_id") = 'text' AND instr("intent_id", char(0)) = 0 AND length("intent_id") >= 1 AND length("intent_id") <= 128)),
  "page_id" TEXT NOT NULL CHECK ("page_id" IS NOT NULL AND (typeof("page_id") = 'text' AND instr("page_id", char(0)) = 0 AND length("page_id") >= 1 AND length("page_id") <= 128)),
  PRIMARY KEY ("context_id", "page_id", "file_id"),
  FOREIGN KEY ("context_id", "page_id") REFERENCES "cz_637265657a696f2e70616765732d6e617669676174696f6e_70616765" ("context_id", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE UNIQUE INDEX "cz_637265657a696f2e70616765732d6e617669676174696f6e_66696c655f6d65746164617461_idx_696e74656e74" ON "cz_637265657a696f2e70616765732d6e617669676174696f6e_66696c655f6d65746164617461" ("context_id", "intent_id", "generation");

CREATE UNIQUE INDEX "cz_637265657a696f2e70616765732d6e617669676174696f6e_66696c655f6d65746164617461_idx_6f626a6563742d6b6579" ON "cz_637265657a696f2e70616765732d6e617669676174696f6e_66696c655f6d65746164617461" ("context_id", "object_key");

CREATE UNIQUE INDEX "cz_637265657a696f2e70616765732d6e617669676174696f6e_70616765_idx_62792d7075626c69736865642d736c7567" ON "cz_637265657a696f2e70616765732d6e617669676174696f6e_70616765" ("context_id", "published_slug");

CREATE UNIQUE INDEX "cz_637265657a696f2e70616765732d6e617669676174696f6e_70616765_idx_62792d736c7567" ON "cz_637265657a696f2e70616765732d6e617669676174696f6e_70616765" ("context_id", "slug");

CREATE INDEX "cz_637265657a696f2e70616765732d6e617669676174696f6e_70616765_idx_726563656e742d7061676573" ON "cz_637265657a696f2e70616765732d6e617669676174696f6e_70616765" ("context_id", "updated_at", "id");

CREATE INDEX "cz_637265657a696f2e70616765732d6e617669676174696f6e_706167655f6d65646961_idx_62792d70616765" ON "cz_637265657a696f2e70616765732d6e617669676174696f6e_706167655f6d65646961" ("context_id", "page_id", "created_at", "file_id");
