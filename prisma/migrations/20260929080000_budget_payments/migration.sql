CREATE TABLE "budget_payments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "budget_item_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "BudgetBalancePaymentMethod",
    "notes" VARCHAR(200),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "budget_payments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "budget_payments_notes_check" CHECK (
        "notes" IS NULL OR ("notes" = btrim("notes") AND char_length("notes") BETWEEN 1 AND 200)
    )
);

CREATE INDEX "budget_payments_ws_item_paid_on_idx" ON "budget_payments"("workspace_id", "budget_item_id", "paid_on", "created_at", "id");
CREATE INDEX "budget_payments_creator_idx" ON "budget_payments"("created_by_user_id");

ALTER TABLE "budget_payments" ADD CONSTRAINT "budget_payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budget_payments" ADD CONSTRAINT "budget_payments_budget_item_id_workspace_id_fkey" FOREIGN KEY ("budget_item_id", "workspace_id") REFERENCES "budget_items"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budget_payments" ADD CONSTRAINT "budget_payments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
