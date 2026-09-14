BEGIN;

CREATE TABLE "wedding_gifts" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "guest_id" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "notes" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wedding_gifts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wedding_gifts_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "wedding_gifts_notes_check" CHECK (
    "notes" IS NULL OR (
      "notes" = btrim("notes")
      AND char_length("notes") BETWEEN 1 AND 500
      AND "notes" ~ '[^[:space:]]'
    )
  ),
  CONSTRAINT "wedding_gifts_version_check" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "wedding_gifts_guest_id_workspace_id_key"
  ON "wedding_gifts"("guest_id", "workspace_id");

CREATE UNIQUE INDEX "wedding_gifts_id_workspace_id_key"
  ON "wedding_gifts"("id", "workspace_id");

CREATE INDEX "wedding_gifts_ws_created_id_idx"
  ON "wedding_gifts"("workspace_id", "created_at", "id");

ALTER TABLE "wedding_gifts"
  ADD CONSTRAINT "wedding_gifts_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wedding_gifts"
  ADD CONSTRAINT "wedding_gifts_guest_ws_fkey"
  FOREIGN KEY ("guest_id", "workspace_id")
  REFERENCES "guests"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
