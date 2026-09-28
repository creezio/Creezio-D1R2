-- Creezio D1 current-model creation v1
-- Module: creezio.catalog
-- Inspect before applying to a new database. No automatic repair.

CREATE TABLE "cz_637265657a696f2e636174616c6f67_63617465676f7279" (
  "archived_at" TEXT CHECK ("archived_at" IS NULL OR (typeof("archived_at") = 'text' AND length("archived_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "archived_at") = "archived_at")),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 36)),
  "name" TEXT NOT NULL CHECK ("name" IS NOT NULL AND (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 1 AND length("name") <= 120)),
  "parent_id" TEXT CHECK ("parent_id" IS NULL OR (typeof("parent_id") = 'text' AND instr("parent_id", char(0)) = 0 AND length("parent_id") >= 1 AND length("parent_id") <= 36)),
  "position" INTEGER NOT NULL CHECK ("position" IS NOT NULL AND (typeof("position") = 'integer' AND "position" BETWEEN -9007199254740991 AND 9007199254740991 AND "position" >= 0 AND "position" <= 100000)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "slug" TEXT NOT NULL CHECK ("slug" IS NOT NULL AND (typeof("slug") = 'text' AND instr("slug", char(0)) = 0 AND length("slug") >= 1 AND length("slug") <= 80)),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id")
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e636174616c6f67_66696c655f6d65746164617461" (
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

CREATE TABLE "cz_637265657a696f2e636174616c6f67_70726f64756374" (
  "attributes" TEXT NOT NULL CHECK ("attributes" IS NOT NULL AND (typeof("attributes") = 'text' AND json_valid("attributes") = 1)),
  "category_id" TEXT CHECK ("category_id" IS NULL OR (typeof("category_id") = 'text' AND instr("category_id", char(0)) = 0 AND length("category_id") >= 1 AND length("category_id") <= 36)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "currency" TEXT NOT NULL CHECK ("currency" IS NOT NULL AND (typeof("currency") = 'text' AND instr("currency", char(0)) = 0 AND length("currency") >= 3 AND length("currency") <= 3)),
  "description" TEXT NOT NULL CHECK ("description" IS NOT NULL AND (typeof("description") = 'text' AND instr("description", char(0)) = 0 AND length("description") >= 0 AND length("description") <= 1200)),
  "id" TEXT NOT NULL CHECK ("id" IS NOT NULL AND (typeof("id") = 'text' AND instr("id", char(0)) = 0 AND length("id") >= 1 AND length("id") <= 36)),
  "name" TEXT NOT NULL CHECK ("name" IS NOT NULL AND (typeof("name") = 'text' AND instr("name", char(0)) = 0 AND length("name") >= 1 AND length("name") <= 160)),
  "price_minor" INTEGER NOT NULL CHECK ("price_minor" IS NOT NULL AND (typeof("price_minor") = 'integer' AND "price_minor" BETWEEN -9007199254740991 AND 9007199254740991 AND "price_minor" >= 0 AND "price_minor" <= 1000000000000)),
  "revision" INTEGER NOT NULL CHECK ("revision" IS NOT NULL AND (typeof("revision") = 'integer' AND "revision" BETWEEN -9007199254740991 AND 9007199254740991 AND "revision" >= 1 AND "revision" <= 9007199254740991)),
  "sku" TEXT NOT NULL CHECK ("sku" IS NOT NULL AND (typeof("sku") = 'text' AND instr("sku", char(0)) = 0 AND length("sku") >= 1 AND length("sku") <= 80)),
  "status" TEXT NOT NULL CHECK ("status" IS NOT NULL AND (typeof("status") = 'text' AND instr("status", char(0)) = 0 AND "status" IN ('draft', 'published', 'archived'))),
  "updated_at" TEXT NOT NULL CHECK ("updated_at" IS NOT NULL AND (typeof("updated_at") = 'text' AND length("updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "updated_at") = "updated_at")),
  PRIMARY KEY ("context_id", "id"),
  FOREIGN KEY ("context_id", "category_id") REFERENCES "cz_637265657a696f2e636174616c6f67_63617465676f7279" ("context_id", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE "cz_637265657a696f2e636174616c6f67_70726f647563745f6d65646961" (
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" IS NOT NULL AND (typeof("byte_size") = 'integer' AND "byte_size" BETWEEN -9007199254740991 AND 9007199254740991 AND "byte_size" >= 0 AND "byte_size" <= 9007199254740991)),
  "content_type" TEXT NOT NULL CHECK ("content_type" IS NOT NULL AND (typeof("content_type") = 'text' AND instr("content_type", char(0)) = 0 AND length("content_type") >= 1 AND length("content_type") <= 128)),
  "context_id" TEXT NOT NULL CHECK ("context_id" IS NOT NULL AND (typeof("context_id") = 'text' AND instr("context_id", char(0)) = 0 AND length("context_id") >= 1 AND length("context_id") <= 128)),
  "created_at" TEXT NOT NULL CHECK ("created_at" IS NOT NULL AND (typeof("created_at") = 'text' AND length("created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', "created_at") = "created_at")),
  "digest" TEXT NOT NULL CHECK ("digest" IS NOT NULL AND (typeof("digest") = 'text' AND instr("digest", char(0)) = 0 AND length("digest") >= 64 AND length("digest") <= 64)),
  "file_id" TEXT NOT NULL CHECK ("file_id" IS NOT NULL AND (typeof("file_id") = 'text' AND instr("file_id", char(0)) = 0 AND length("file_id") >= 1 AND length("file_id") <= 67)),
  "filename" TEXT NOT NULL CHECK ("filename" IS NOT NULL AND (typeof("filename") = 'text' AND instr("filename", char(0)) = 0 AND length("filename") >= 1 AND length("filename") <= 255)),
  "generation" TEXT NOT NULL CHECK ("generation" IS NOT NULL AND (typeof("generation") = 'text' AND instr("generation", char(0)) = 0 AND length("generation") >= 1 AND length("generation") <= 128)),
  "intent_id" TEXT NOT NULL CHECK ("intent_id" IS NOT NULL AND (typeof("intent_id") = 'text' AND instr("intent_id", char(0)) = 0 AND length("intent_id") >= 1 AND length("intent_id") <= 128)),
  "product_id" TEXT NOT NULL CHECK ("product_id" IS NOT NULL AND (typeof("product_id") = 'text' AND instr("product_id", char(0)) = 0 AND length("product_id") >= 1 AND length("product_id") <= 36)),
  PRIMARY KEY ("context_id", "product_id", "file_id"),
  FOREIGN KEY ("context_id", "product_id") REFERENCES "cz_637265657a696f2e636174616c6f67_70726f64756374" ("context_id", "id") ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX "cz_637265657a696f2e636174616c6f67_63617465676f7279_idx_62792d706172656e74" ON "cz_637265657a696f2e636174616c6f67_63617465676f7279" ("context_id", "parent_id", "id");

CREATE INDEX "cz_637265657a696f2e636174616c6f67_63617465676f7279_idx_62792d706f736974696f6e" ON "cz_637265657a696f2e636174616c6f67_63617465676f7279" ("context_id", "position", "id");

CREATE UNIQUE INDEX "cz_637265657a696f2e636174616c6f67_63617465676f7279_idx_62792d736c7567" ON "cz_637265657a696f2e636174616c6f67_63617465676f7279" ("context_id", "slug");

CREATE UNIQUE INDEX "cz_637265657a696f2e636174616c6f67_66696c655f6d65746164617461_idx_62792d696e74656e74" ON "cz_637265657a696f2e636174616c6f67_66696c655f6d65746164617461" ("context_id", "intent_id", "generation");

CREATE UNIQUE INDEX "cz_637265657a696f2e636174616c6f67_66696c655f6d65746164617461_idx_62792d6f626a656374" ON "cz_637265657a696f2e636174616c6f67_66696c655f6d65746164617461" ("context_id", "object_key");

CREATE INDEX "cz_637265657a696f2e636174616c6f67_70726f64756374_idx_62792d63617465676f7279" ON "cz_637265657a696f2e636174616c6f67_70726f64756374" ("context_id", "category_id", "updated_at", "id");

CREATE UNIQUE INDEX "cz_637265657a696f2e636174616c6f67_70726f64756374_idx_62792d736b75" ON "cz_637265657a696f2e636174616c6f67_70726f64756374" ("context_id", "sku");

CREATE INDEX "cz_637265657a696f2e636174616c6f67_70726f64756374_idx_62792d75706461746564" ON "cz_637265657a696f2e636174616c6f67_70726f64756374" ("context_id", "updated_at", "id");

CREATE INDEX "cz_637265657a696f2e636174616c6f67_70726f647563745f6d65646961_idx_62792d70726f64756374" ON "cz_637265657a696f2e636174616c6f67_70726f647563745f6d65646961" ("context_id", "product_id", "created_at", "file_id");
