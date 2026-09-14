CREATE TYPE "BudgetPreparationStatus" AS ENUM ('NEEDS_ACTION', 'ALREADY_OWNED', 'NOT_PLANNED');

ALTER TABLE "budget_items"
    ADD COLUMN "preparation_status" "BudgetPreparationStatus" NOT NULL DEFAULT 'NEEDS_ACTION',
    ADD CONSTRAINT "budget_items_preparation_status_kind_check"
      CHECK (
        "kind" = 'EXPENSE'::"BudgetItemKind"
        OR "preparation_status" = 'NEEDS_ACTION'::"BudgetPreparationStatus"
      );

CREATE INDEX "budget_items_ws_preparation_booking_due_created_id_idx"
    ON "budget_items"(
      "workspace_id",
      "preparation_status",
      "booking_status",
      "due_date",
      "created_at",
      "id"
    );
