ALTER TABLE "seating_tables"
ADD COLUMN "layout_x" INTEGER,
ADD COLUMN "layout_y" INTEGER;

ALTER TABLE "seating_tables"
ADD CONSTRAINT "seating_tables_layout_pair_range_check"
CHECK (
  ("layout_x" IS NULL AND "layout_y" IS NULL)
  OR
  (
    "layout_x" IS NOT NULL
    AND "layout_y" IS NOT NULL
    AND "layout_x" BETWEEN 0 AND 1000
    AND "layout_y" BETWEEN 0 AND 1000
  )
);
