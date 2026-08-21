BEGIN;

ALTER TABLE "budget_items"
  ADD COLUMN "source_hierarchy_path" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "budget_items"
  ADD CONSTRAINT "budget_items_source_hierarchy_path_check"
  CHECK (
    cardinality("source_hierarchy_path") <= 4
    AND array_position("source_hierarchy_path", NULL) IS NULL
    AND array_position("source_hierarchy_path", '') IS NULL
    AND (
      cardinality("source_hierarchy_path") = 0
      OR "source" = 'NOTION'::"BudgetItemSource"
    )
  );

COMMIT;
