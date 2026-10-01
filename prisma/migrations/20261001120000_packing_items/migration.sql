-- 入住打包清單：新增資料表，不改動既有資料。
CREATE TABLE "packing_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "side" "WeddingTaskSide" NOT NULL DEFAULT 'SHARED',
    "packed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packing_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "packing_items_workspace_id_created_at_id_idx" ON "packing_items"("workspace_id", "created_at", "id");

CREATE UNIQUE INDEX "packing_items_id_workspace_id_key" ON "packing_items"("id", "workspace_id");

ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
