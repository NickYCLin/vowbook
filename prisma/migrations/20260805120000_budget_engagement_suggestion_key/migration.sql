BEGIN;

ALTER TABLE "budget_items"
ADD COLUMN "suggestion_key" VARCHAR(100);

ALTER TABLE "budget_items"
ADD CONSTRAINT "budget_items_suggestion_key_shape_check"
CHECK (
  "suggestion_key" IS NULL
  OR (
    "suggestion_key" ~ '^ENGAGEMENT_(GROOM|BRIDE)_[A-Z0-9_]+$'
    AND "source" = 'MANUAL'
    AND "kind" = 'EXPENSE'
    AND "system_taxonomy_key" IS NULL
    AND "external_id" IS NULL
    AND "source_hash" IS NULL
    AND "source_order" IS NULL
    AND cardinality("source_hierarchy_path") = 0
  )
);

CREATE UNIQUE INDEX "budget_items_workspace_suggestion_key_key"
ON "budget_items" ("workspace_id", "suggestion_key");

COMMIT;
