BEGIN;

-- CreateEnum
CREATE TYPE "BudgetItemKind" AS ENUM ('GROUP', 'EXPENSE');

-- CreateEnum
CREATE TYPE "BudgetCostCategory" AS ENUM (
    'RINGS_KEEPSAKES',
    'PHOTOGRAPHY_VIDEO',
    'ATTIRE_STYLING',
    'VENUE_CATERING',
    'TRANSPORT_LODGING',
    'DECOR_GIFTS',
    'PEOPLE_SERVICES',
    'OTHER_PENDING'
);

-- Add the new columns without interpreting a tenant-specific hierarchy.
ALTER TABLE "budget_items"
    ADD COLUMN "kind" "BudgetItemKind" NOT NULL DEFAULT 'EXPENSE',
    ADD COLUMN "cost_category" "BudgetCostCategory",
    ADD COLUMN "legacy_category" VARCHAR(60);

-- Preserve the exact prior free-text label as immutable migration provenance.
-- Product taxonomy and hierarchy never read or write this audit-only field.
UPDATE "budget_items"
SET "legacy_category" = "category";

-- A legacy row is a group only when it has at least one same-workspace child and
-- every direct cost/payment and expense metadata field is already neutral.
-- Everything else remains
-- an expense.
UPDATE "budget_items" AS item
SET "kind" = 'GROUP'::"BudgetItemKind"
WHERE EXISTS (
        SELECT 1
        FROM "budget_items" AS child
        WHERE child."parent_id" = item."id"
          AND child."workspace_id" = item."workspace_id"
    )
  AND item."planned_amount" = 0
  AND item."actual_amount" IS NULL
  AND item."deposit_amount" IS NULL
  AND item."balance_amount" IS NULL
  AND item."additional_amount" IS NULL
  AND item."paid_at" IS NULL
  AND item."due_date" IS NULL
  AND item."booking_status" = 'PLANNING'
  AND item."paid" = FALSE
  AND item."estimated_range" IS NULL
  AND item."candidate_vendors" IS NULL
  AND item."confirmed_vendor" IS NULL
  AND item."vendor_contact" IS NULL
  AND item."primary_contact" IS NULL
  AND item."notes" IS NULL;

-- Map only explicit, generally recognizable legacy values. Unknown values are
-- retained as expenses under the safe review bucket.
UPDATE "budget_items"
SET "cost_category" = CASE
    WHEN "kind" = 'GROUP' THEN NULL
    WHEN "category" IN ('戒指與信物', '戒指', '信物')
        THEN 'RINGS_KEEPSAKES'::"BudgetCostCategory"
    WHEN "category" IN ('攝影與影像', '攝影', '影像', '錄影', '婚禮攝影')
        THEN 'PHOTOGRAPHY_VIDEO'::"BudgetCostCategory"
    WHEN "category" IN ('服裝與造型', '服裝', '造型')
        THEN 'ATTIRE_STYLING'::"BudgetCostCategory"
    WHEN "category" IN ('場地與餐飲', '場地', '餐飲')
        THEN 'VENUE_CATERING'::"BudgetCostCategory"
    WHEN "category" IN ('交通與住宿', '交通', '住宿')
        THEN 'TRANSPORT_LODGING'::"BudgetCostCategory"
    WHEN "category" IN ('佈置與禮品', '佈置', '禮品')
        THEN 'DECOR_GIFTS'::"BudgetCostCategory"
    WHEN "category" IN ('人員與服務', '人員', '服務')
        THEN 'PEOPLE_SERVICES'::"BudgetCostCategory"
    ELSE 'OTHER_PENDING'::"BudgetCostCategory"
END;

-- Replace indexes and the legacy free-text category column.
DROP INDEX "budget_items_ws_parent_source_order_tree_idx";
DROP INDEX "budget_items_ws_paid_due_category_created_id_idx";
ALTER TABLE "budget_items"
    DROP CONSTRAINT "budget_items_category_check",
    DROP COLUMN "category";
ALTER TABLE "budget_items"
    RENAME COLUMN "cost_category" TO "category";

ALTER TABLE "budget_items"
    ADD CONSTRAINT "budget_items_kind_category_check"
        CHECK (
            ("kind" = 'GROUP' AND "category" IS NULL)
            OR
            ("kind" = 'EXPENSE' AND "category" IS NOT NULL)
        ),
    ADD CONSTRAINT "budget_items_group_neutral_fields_check"
        CHECK (
            "kind" <> 'GROUP'
            OR (
                "planned_amount" = 0
                AND "actual_amount" IS NULL
                AND "deposit_amount" IS NULL
                AND "balance_amount" IS NULL
                AND "additional_amount" IS NULL
                AND "paid_at" IS NULL
                AND "due_date" IS NULL
                AND "booking_status" = 'PLANNING'
                AND "paid" = FALSE
                AND "estimated_range" IS NULL
                AND "candidate_vendors" IS NULL
                AND "confirmed_vendor" IS NULL
                AND "vendor_contact" IS NULL
                AND "primary_contact" IS NULL
                AND "notes" IS NULL
            )
        );

CREATE INDEX "budget_items_ws_parent_source_order_tree_idx"
    ON "budget_items"(
        "workspace_id",
        "parent_id",
        "source_order",
        "category",
        "name",
        "created_at",
        "id"
    );

CREATE INDEX "budget_items_ws_paid_due_category_created_id_idx"
    ON "budget_items"(
        "workspace_id",
        "paid",
        "due_date",
        "category",
        "created_at",
        "id"
    );

CREATE INDEX "budget_items_ws_kind_category_created_id_idx"
    ON "budget_items"("workspace_id", "kind", "category", "created_at", "id");

COMMIT;
