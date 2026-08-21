BEGIN;

ALTER TABLE "budget_items"
DROP CONSTRAINT "budget_items_suggestion_key_shape_check";

ALTER TABLE "budget_items"
ADD CONSTRAINT "budget_items_suggestion_key_shape_check"
CHECK (
  "suggestion_key" IS NULL
  OR (
    "suggestion_key" ~ '^(ENGAGEMENT_(GROOM|BRIDE)|PREPARATION)_[A-Z0-9_]+$'
    AND "source" = 'MANUAL'
    AND "kind" = 'EXPENSE'
    AND "system_taxonomy_key" IS NULL
    AND "external_id" IS NULL
    AND "source_hash" IS NULL
    AND "source_order" IS NULL
    AND cardinality("source_hierarchy_path") = 0
  )
) NOT VALID;

ALTER TABLE "budget_items"
VALIDATE CONSTRAINT "budget_items_suggestion_key_shape_check";

COMMIT;
