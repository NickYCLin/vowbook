ALTER TABLE "seating_tables" ADD COLUMN "position" INTEGER;
ALTER TABLE "seating_tables" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

WITH "ranked_tables" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspace_id"
      ORDER BY "created_at", "id"
    )::INTEGER AS "position"
  FROM "seating_tables"
)
UPDATE "seating_tables" AS "table"
SET "position" = "ranked_tables"."position"
FROM "ranked_tables"
WHERE "table"."id" = "ranked_tables"."id";

ALTER TABLE "seating_tables" ALTER COLUMN "position" SET NOT NULL;

ALTER TABLE "seating_tables"
ADD CONSTRAINT "seating_tables_position_check" CHECK ("position" > 0);

DROP INDEX "seating_tables_workspace_id_created_at_id_idx";

CREATE UNIQUE INDEX "seating_tables_workspace_id_position_key"
ON "seating_tables"("workspace_id", "position");
