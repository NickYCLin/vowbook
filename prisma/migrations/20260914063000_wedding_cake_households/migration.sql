CREATE TABLE "wedding_cake_households" (
  "id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "name" VARCHAR(100) NOT NULL,
  "boxes" INTEGER NOT NULL DEFAULT 1, "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wedding_cake_households_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wedding_cake_households_boxes_check" CHECK ("boxes" BETWEEN 0 AND 999)
);
CREATE UNIQUE INDEX "wedding_cake_households_id_workspace_id_key" ON "wedding_cake_households"("id", "workspace_id");
CREATE INDEX "wedding_cake_households_workspace_id_idx" ON "wedding_cake_households"("workspace_id");
ALTER TABLE "wedding_cake_households" ADD CONSTRAINT "wedding_cake_households_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guests" ADD COLUMN "cake_household_id" TEXT;
CREATE INDEX "guests_workspace_id_cake_household_id_idx" ON "guests"("workspace_id", "cake_household_id");
ALTER TABLE "guests" ADD CONSTRAINT "guests_cake_household_id_workspace_id_fkey" FOREIGN KEY ("cake_household_id", "workspace_id") REFERENCES "wedding_cake_households"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;
