-- The ceremony directory is no longer an interactive module. These flags keep
-- the two Chinese-ceremony Budget suggestion sets explicitly workspace-owned
-- and opt-in, without deleting any existing ceremony or attendance records.
BEGIN;

ALTER TABLE "wedding_workspaces"
  ADD COLUMN "has_engagement_ceremony" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "has_procession_ceremony" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ceremony_preferences_version" INTEGER NOT NULL DEFAULT 0;

-- A ceremony previously created through the removed page was already an
-- explicit choice. Preserve that intent when moving the setting to Budget.
UPDATE "wedding_workspaces" AS w
SET
  "has_engagement_ceremony" = EXISTS (
    SELECT 1
    FROM "wedding_ceremonies" AS wc
    WHERE wc."workspace_id" = w."id"
      AND wc."type" = 'ENGAGEMENT'
  ),
  "has_procession_ceremony" = EXISTS (
    SELECT 1
    FROM "wedding_ceremonies" AS wc
    WHERE wc."workspace_id" = w."id"
      AND wc."type" = 'PROCESSION'
  );

ALTER TABLE "wedding_workspaces"
  ADD CONSTRAINT "wedding_workspaces_ceremony_preferences_version_check"
  CHECK ("ceremony_preferences_version" >= 0);

COMMIT;
