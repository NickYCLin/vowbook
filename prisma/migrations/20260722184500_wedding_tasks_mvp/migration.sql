-- CreateEnum
CREATE TYPE "WeddingTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "wedding_tasks" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "status" "WeddingTaskStatus" NOT NULL DEFAULT 'TODO',
    "completed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wedding_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wedding_tasks_title_check" CHECK ("title" = btrim("title") AND char_length("title") BETWEEN 1 AND 120),
    CONSTRAINT "wedding_tasks_description_check" CHECK ("description" IS NULL OR ("description" = btrim("description") AND char_length("description") <= 1000)),
    CONSTRAINT "wedding_tasks_status_completed_at_check" CHECK (("status" = 'DONE' AND "completed_at" IS NOT NULL) OR ("status" <> 'DONE' AND "completed_at" IS NULL)),
    CONSTRAINT "wedding_tasks_version_check" CHECK ("version" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "wedding_tasks_id_workspace_id_key" ON "wedding_tasks"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "wedding_tasks_ws_status_due_created_id_idx" ON "wedding_tasks"("workspace_id", "status", "due_date", "created_at", "id");

-- AddForeignKey
ALTER TABLE "wedding_tasks" ADD CONSTRAINT "wedding_tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
