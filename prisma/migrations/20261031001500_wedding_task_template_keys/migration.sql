ALTER TABLE "wedding_tasks" ADD COLUMN "template_key" VARCHAR(100);
CREATE UNIQUE INDEX "wedding_tasks_workspace_id_template_key_key" ON "wedding_tasks"("workspace_id", "template_key");
