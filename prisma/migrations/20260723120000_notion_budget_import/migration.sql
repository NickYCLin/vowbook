-- CreateEnum
CREATE TYPE "BudgetItemSource" AS ENUM ('MANUAL', 'NOTION');

-- CreateEnum
CREATE TYPE "BudgetBookingStatus" AS ENUM ('PLANNING', 'BOOKED_BALANCE_DUE', 'PAID');

-- CreateEnum
CREATE TYPE "BudgetPrimaryContact" AS ENUM ('PARTNER_A', 'PARTNER_B');

-- AlterTable
ALTER TABLE "budget_items"
    ADD COLUMN "parent_id" TEXT,
    ADD COLUMN "source" "BudgetItemSource" NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "external_id" VARCHAR(36),
    ADD COLUMN "source_hash" VARCHAR(64),
    ADD COLUMN "source_order" INTEGER,
    ADD COLUMN "booking_status" "BudgetBookingStatus" NOT NULL DEFAULT 'PLANNING',
    ADD COLUMN "deposit_amount" INTEGER,
    ADD COLUMN "balance_amount" INTEGER,
    ADD COLUMN "additional_amount" INTEGER,
    ADD COLUMN "estimated_range" VARCHAR(200),
    ADD COLUMN "candidate_vendors" VARCHAR(1000),
    ADD COLUMN "confirmed_vendor" VARCHAR(300),
    ADD COLUMN "vendor_contact" VARCHAR(500),
    ADD COLUMN "primary_contact" "BudgetPrimaryContact";

-- Backfill the prior-head v6 rows without changing their existing values.
UPDATE "budget_items"
SET "booking_status" = CASE
    WHEN "paid" = TRUE THEN 'PAID'::"BudgetBookingStatus"
    ELSE 'PLANNING'::"BudgetBookingStatus"
END;

-- Replace the v6 paid-at invariant so imported PAID rows may preserve an unknown timestamp.
ALTER TABLE "budget_items"
    DROP CONSTRAINT "budget_items_paid_at_check";

ALTER TABLE "budget_items"
    ADD CONSTRAINT "budget_items_parent_not_self_check"
        CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
    ADD CONSTRAINT "budget_items_source_identity_check"
        CHECK (
            (
                "source" = 'MANUAL'
                AND "external_id" IS NULL
                AND "source_hash" IS NULL
                AND "source_order" IS NULL
            )
            OR
            (
                "source" = 'NOTION'
                AND "external_id" IS NOT NULL
                AND "source_hash" IS NOT NULL
                AND "source_order" IS NOT NULL
            )
        ),
    ADD CONSTRAINT "budget_items_external_id_check"
        CHECK (
            "source" <> 'NOTION'
            OR "external_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        ),
    ADD CONSTRAINT "budget_items_source_hash_check"
        CHECK (
            "source" <> 'NOTION'
            OR "source_hash" ~ '^[0-9a-f]{64}$'
        ),
    ADD CONSTRAINT "budget_items_source_order_check"
        CHECK ("source_order" IS NULL OR "source_order" BETWEEN 0 AND 2147483647),
    ADD CONSTRAINT "budget_items_components_check"
        CHECK (
            ("deposit_amount" IS NULL OR "deposit_amount" BETWEEN 0 AND 2147483647)
            AND ("balance_amount" IS NULL OR "balance_amount" BETWEEN 0 AND 2147483647)
            AND ("additional_amount" IS NULL OR "additional_amount" BETWEEN 0 AND 2147483647)
        ),
    ADD CONSTRAINT "budget_items_estimated_range_check"
        CHECK (
            "estimated_range" IS NULL
            OR (
                "estimated_range" = btrim("estimated_range")
                AND char_length("estimated_range") BETWEEN 1 AND 200
            )
        ),
    ADD CONSTRAINT "budget_items_candidate_vendors_check"
        CHECK (
            "candidate_vendors" IS NULL
            OR (
                "candidate_vendors" = btrim("candidate_vendors")
                AND char_length("candidate_vendors") BETWEEN 1 AND 1000
            )
        ),
    ADD CONSTRAINT "budget_items_confirmed_vendor_check"
        CHECK (
            "confirmed_vendor" IS NULL
            OR (
                "confirmed_vendor" = btrim("confirmed_vendor")
                AND char_length("confirmed_vendor") BETWEEN 1 AND 300
            )
        ),
    ADD CONSTRAINT "budget_items_vendor_contact_check"
        CHECK (
            "vendor_contact" IS NULL
            OR (
                "vendor_contact" = btrim("vendor_contact")
                AND char_length("vendor_contact") BETWEEN 1 AND 500
            )
        ),
    ADD CONSTRAINT "budget_items_booking_status_paid_check"
        CHECK ("paid" = ("booking_status" = 'PAID')),
    ADD CONSTRAINT "budget_items_paid_at_check"
        CHECK (
            "booking_status" = 'PAID'
            OR ("paid" = FALSE AND "paid_at" IS NULL)
        );

-- CreateIndex
CREATE UNIQUE INDEX "budget_items_workspace_source_external_id_key"
    ON "budget_items"("workspace_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "budget_items_ws_source_idx"
    ON "budget_items"("workspace_id", "source");

-- CreateIndex
CREATE INDEX "budget_items_ws_parent_source_order_tree_idx"
    ON "budget_items"("workspace_id", "parent_id", "source_order", "category", "name", "created_at", "id");

-- AddForeignKey
ALTER TABLE "budget_items"
    ADD CONSTRAINT "budget_items_parent_id_workspace_id_fkey"
    FOREIGN KEY ("parent_id", "workspace_id")
    REFERENCES "budget_items"("id", "workspace_id")
    ON DELETE NO ACTION ON UPDATE CASCADE;
