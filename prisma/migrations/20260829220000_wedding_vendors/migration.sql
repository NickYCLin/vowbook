BEGIN;

CREATE TYPE "WeddingVendorStatus" AS ENUM (
  'RESEARCHING',
  'CONTACTING',
  'QUOTED',
  'SELECTED',
  'NOT_SELECTED'
);

CREATE TABLE "wedding_vendors" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "service_category" VARCHAR(80) NOT NULL,
  "status" "WeddingVendorStatus" NOT NULL DEFAULT 'RESEARCHING',
  "contact_name" VARCHAR(120),
  "contact_phone" VARCHAR(40),
  "contact_email" VARCHAR(254),
  "website" VARCHAR(500),
  "notes" VARCHAR(1000),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wedding_vendors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wedding_vendors_name_check" CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 120
    AND "name" ~ '[^[:space:]]'
  ),
  CONSTRAINT "wedding_vendors_service_category_check" CHECK (
    "service_category" = btrim("service_category")
    AND char_length("service_category") BETWEEN 1 AND 80
    AND "service_category" ~ '[^[:space:]]'
  ),
  CONSTRAINT "wedding_vendors_contact_name_check" CHECK (
    "contact_name" IS NULL OR (
      "contact_name" = btrim("contact_name")
      AND char_length("contact_name") BETWEEN 1 AND 120
      AND "contact_name" ~ '[^[:space:]]'
    )
  ),
  CONSTRAINT "wedding_vendors_contact_phone_check" CHECK (
    "contact_phone" IS NULL OR (
      "contact_phone" = btrim("contact_phone")
      AND char_length("contact_phone") BETWEEN 1 AND 40
      AND "contact_phone" ~ '[^[:space:]]'
    )
  ),
  CONSTRAINT "wedding_vendors_contact_email_check" CHECK (
    "contact_email" IS NULL OR (
      "contact_email" = btrim("contact_email")
      AND char_length("contact_email") BETWEEN 1 AND 254
      AND "contact_email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  CONSTRAINT "wedding_vendors_website_check" CHECK (
    "website" IS NULL OR (
      "website" = btrim("website")
      AND char_length("website") BETWEEN 1 AND 500
      AND "website" ~ '^https?://'
    )
  ),
  CONSTRAINT "wedding_vendors_notes_check" CHECK (
    "notes" IS NULL OR (
      "notes" = btrim("notes")
      AND char_length("notes") BETWEEN 1 AND 1000
      AND "notes" ~ '[^[:space:]]'
    )
  ),
  CONSTRAINT "wedding_vendors_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "wedding_vendor_budget_items" (
  "vendor_id" TEXT NOT NULL,
  "budget_item_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wedding_vendor_budget_items_pkey"
    PRIMARY KEY ("vendor_id", "budget_item_id", "workspace_id")
);

CREATE UNIQUE INDEX "wedding_vendors_id_workspace_id_key"
  ON "wedding_vendors"("id", "workspace_id");

CREATE INDEX "wedding_vendors_ws_status_category_name_created_id_idx"
  ON "wedding_vendors"(
    "workspace_id",
    "status",
    "service_category",
    "name",
    "created_at",
    "id"
  );

CREATE INDEX "vendor_budget_items_ws_budget_vendor_idx"
  ON "wedding_vendor_budget_items"("workspace_id", "budget_item_id", "vendor_id");

ALTER TABLE "wedding_vendors"
  ADD CONSTRAINT "wedding_vendors_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wedding_vendor_budget_items"
  ADD CONSTRAINT "wedding_vendor_budget_items_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wedding_vendor_budget_items"
  ADD CONSTRAINT "vendor_budget_items_vendor_ws_fkey"
  FOREIGN KEY ("vendor_id", "workspace_id")
  REFERENCES "wedding_vendors"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wedding_vendor_budget_items"
  ADD CONSTRAINT "vendor_budget_items_budget_ws_fkey"
  FOREIGN KEY ("budget_item_id", "workspace_id")
  REFERENCES "budget_items"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
