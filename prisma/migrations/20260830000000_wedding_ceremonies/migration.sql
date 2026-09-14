BEGIN;

CREATE TYPE "WeddingCeremonyType" AS ENUM (
  'WESTERN_CEREMONY',
  'ENGAGEMENT',
  'PROCESSION',
  'RECEPTION',
  'CUSTOM'
);

CREATE TABLE "wedding_ceremonies" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "type" "WeddingCeremonyType" NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "event_date" DATE,
  "start_minute" INTEGER,
  "location" VARCHAR(120),
  "notes" VARCHAR(1000),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wedding_ceremonies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wedding_ceremonies_name_check" CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 120
    AND "name" ~ '[^[:space:]]'
  ),
  CONSTRAINT "wedding_ceremonies_start_minute_check"
    CHECK ("start_minute" IS NULL OR "start_minute" BETWEEN 0 AND 1439),
  CONSTRAINT "wedding_ceremonies_location_check" CHECK (
    "location" IS NULL OR (
      "location" = btrim("location")
      AND char_length("location") BETWEEN 1 AND 120
      AND "location" ~ '[^[:space:]]'
    )
  ),
  CONSTRAINT "wedding_ceremonies_notes_check" CHECK (
    "notes" IS NULL OR (
      "notes" = btrim("notes")
      AND char_length("notes") BETWEEN 1 AND 1000
      AND "notes" ~ '[^[:space:]]'
    )
  ),
  CONSTRAINT "wedding_ceremonies_version_check" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "wedding_ceremonies_id_workspace_id_key"
  ON "wedding_ceremonies"("id", "workspace_id");

CREATE UNIQUE INDEX "wedding_ceremonies_standard_type_unique"
  ON "wedding_ceremonies"("workspace_id", "type")
  WHERE "type" <> 'CUSTOM';

CREATE INDEX "wedding_ceremonies_ws_date_start_created_id_idx"
  ON "wedding_ceremonies"(
    "workspace_id",
    "event_date",
    "start_minute",
    "created_at",
    "id"
  );

ALTER TABLE "wedding_ceremonies"
  ADD CONSTRAINT "wedding_ceremonies_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
