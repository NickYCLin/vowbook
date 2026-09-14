-- CreateTable
CREATE TABLE "coordinator_handoffs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "details" VARCHAR(2000) NOT NULL,
    "phase" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMPTZ(3),
    "staff_id" TEXT,
    "timeline_item_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coordinator_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coordinator_handoffs_workspace_id_due_at_created_at_id_idx" ON "coordinator_handoffs"("workspace_id", "due_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "coordinator_handoffs_staff_id_workspace_id_idx" ON "coordinator_handoffs"("staff_id", "workspace_id");

-- CreateIndex
CREATE INDEX "coordinator_handoffs_timeline_item_id_workspace_id_idx" ON "coordinator_handoffs"("timeline_item_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "coordinator_handoffs_id_workspace_id_key" ON "coordinator_handoffs"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "coordinator_handoffs" ADD CONSTRAINT "coordinator_handoffs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinator_handoffs" ADD CONSTRAINT "coordinator_handoffs_staff_id_workspace_id_fkey" FOREIGN KEY ("staff_id", "workspace_id") REFERENCES "wedding_staff_assignments"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinator_handoffs" ADD CONSTRAINT "coordinator_handoffs_timeline_item_id_workspace_id_fkey" FOREIGN KEY ("timeline_item_id", "workspace_id") REFERENCES "wedding_timeline_items"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "coordinator_handoffs"
  ADD CONSTRAINT "coordinator_handoffs_title_check" CHECK (length(btrim(title)) > 0 AND title = btrim(title)),
  ADD CONSTRAINT "coordinator_handoffs_details_check" CHECK (length(btrim(details)) > 0 AND details = btrim(details)),
  ADD CONSTRAINT "coordinator_handoffs_phase_check" CHECK (phase IN ('PREPARATION', 'EVENT_DAY')),
  ADD CONSTRAINT "coordinator_handoffs_status_check" CHECK (status IN ('PENDING', 'CONFIRMED', 'DONE')),
  ADD CONSTRAINT "coordinator_handoffs_version_check" CHECK (version >= 0);
