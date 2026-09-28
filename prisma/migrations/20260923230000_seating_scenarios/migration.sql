-- 座位方案：正式安排仍是 seating_tables 與 guests.seating_table_id，
-- 方案只是沙盒，套用時才由應用程式在單一交易內整批寫回。
-- 全部 additive：不回填、不搬動既有桌次與賓客資料。

-- CreateEnum
CREATE TYPE "SeatingScenarioKind" AS ENUM ('DRAFT', 'BACKUP');

-- CreateTable
CREATE TABLE "seating_scenarios" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "kind" "SeatingScenarioKind" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "base_live_fingerprint" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seating_scenarios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seating_scenarios_name_check" CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 40),
    CONSTRAINT "seating_scenarios_version_check" CHECK ("version" >= 0)
    ,CONSTRAINT "seating_scenarios_fingerprint_check" CHECK ("base_live_fingerprint" IS NULL OR "base_live_fingerprint" ~ '^[0-9a-f]{64}$')
);

-- CreateTable
CREATE TABLE "seating_scenario_tables" (
    "id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "layout_x" INTEGER,
    "layout_y" INTEGER,
    "notes" TEXT,

    CONSTRAINT "seating_scenario_tables_pkey" PRIMARY KEY ("id"),
    -- 與正式桌次同一套規則，套用時才不會寫出違反 seating_tables 約束的資料。
    CONSTRAINT "seating_scenario_tables_name_check" CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "seating_scenario_tables_capacity_check" CHECK ("capacity" BETWEEN 1 AND 100),
    CONSTRAINT "seating_scenario_tables_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 500),
    CONSTRAINT "seating_scenario_tables_position_check" CHECK ("position" > 0),
    CONSTRAINT "seating_scenario_tables_layout_check" CHECK (
      ("layout_x" IS NULL AND "layout_y" IS NULL)
      OR ("layout_x" IS NOT NULL AND "layout_y" IS NOT NULL
          AND "layout_x" BETWEEN 0 AND 1000 AND "layout_y" BETWEEN 0 AND 1000)
    )
);

-- CreateTable
CREATE TABLE "seating_scenario_assignments" (
    "scenario_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,

    CONSTRAINT "seating_scenario_assignments_pkey" PRIMARY KEY ("scenario_id","guest_id")
);

-- CreateIndex
CREATE INDEX "seating_scenarios_workspace_id_created_at_idx" ON "seating_scenarios"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "seating_scenarios_id_workspace_id_key" ON "seating_scenarios"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "seating_scenario_tables_id_scenario_id_key" ON "seating_scenario_tables"("id", "scenario_id");

-- CreateIndex
CREATE UNIQUE INDEX "seating_scenario_tables_scenario_id_position_key" ON "seating_scenario_tables"("scenario_id", "position");

-- CreateIndex
CREATE INDEX "seating_scenario_assignments_table_id_idx" ON "seating_scenario_assignments"("table_id");

-- CreateIndex
CREATE INDEX "seating_scenario_assignments_guest_id_workspace_id_idx" ON "seating_scenario_assignments"("guest_id", "workspace_id");

-- AddForeignKey
ALTER TABLE "seating_scenarios" ADD CONSTRAINT "seating_scenarios_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_scenario_tables" ADD CONSTRAINT "seating_scenario_tables_scenario_id_workspace_id_fkey" FOREIGN KEY ("scenario_id", "workspace_id") REFERENCES "seating_scenarios"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_scenario_assignments" ADD CONSTRAINT "seating_scenario_assignments_scenario_id_workspace_id_fkey" FOREIGN KEY ("scenario_id", "workspace_id") REFERENCES "seating_scenarios"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_scenario_assignments" ADD CONSTRAINT "seating_scenario_assignments_table_id_scenario_id_fkey" FOREIGN KEY ("table_id", "scenario_id") REFERENCES "seating_scenario_tables"("id", "scenario_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_scenario_assignments" ADD CONSTRAINT "seating_scenario_assignments_guest_id_workspace_id_fkey" FOREIGN KEY ("guest_id", "workspace_id") REFERENCES "guests"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
