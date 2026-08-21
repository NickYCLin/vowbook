-- CreateTable
CREATE TABLE "seating_tables" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seating_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seating_tables_name_length_check" CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "seating_tables_capacity_check" CHECK ("capacity" BETWEEN 1 AND 100),
    CONSTRAINT "seating_tables_notes_length_check" CHECK ("notes" IS NULL OR char_length("notes") <= 500)
);

-- AlterTable
ALTER TABLE "guests" ADD COLUMN "seating_table_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "seating_tables_workspace_id_name_key" ON "seating_tables"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "seating_tables_id_workspace_id_key" ON "seating_tables"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "seating_tables_workspace_id_created_at_id_idx" ON "seating_tables"("workspace_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "guests_id_workspace_id_key" ON "guests"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "guests_workspace_id_seating_table_id_idx" ON "guests"("workspace_id", "seating_table_id");

-- AddForeignKey
ALTER TABLE "seating_tables" ADD CONSTRAINT "seating_tables_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_seating_table_id_workspace_id_fkey" FOREIGN KEY ("seating_table_id", "workspace_id") REFERENCES "seating_tables"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;
