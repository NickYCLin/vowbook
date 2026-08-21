-- CreateTable
CREATE TABLE "budget_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "planned_amount" INTEGER NOT NULL,
    "actual_amount" INTEGER,
    "due_date" DATE,
    "notes" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT FALSE,
    "paid_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "budget_items_name_check" CHECK ("name" = btrim("name") AND "name" ~ '[^[:space:]]' AND char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "budget_items_category_check" CHECK ("category" = btrim("category") AND "category" ~ '[^[:space:]]' AND char_length("category") BETWEEN 1 AND 60),
    CONSTRAINT "budget_items_planned_amount_check" CHECK ("planned_amount" BETWEEN 0 AND 2147483647),
    CONSTRAINT "budget_items_actual_amount_check" CHECK ("actual_amount" IS NULL OR "actual_amount" BETWEEN 0 AND 2147483647),
    CONSTRAINT "budget_items_notes_check" CHECK ("notes" IS NULL OR ("notes" = btrim("notes") AND char_length("notes") <= 1000)),
    CONSTRAINT "budget_items_version_check" CHECK ("version" >= 0),
    CONSTRAINT "budget_items_paid_at_check" CHECK (("paid" = TRUE AND "paid_at" IS NOT NULL) OR ("paid" = FALSE AND "paid_at" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_items_id_workspace_id_key" ON "budget_items"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "budget_items_ws_paid_due_category_created_id_idx" ON "budget_items"("workspace_id", "paid", "due_date", "category", "created_at", "id");

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
