-- 捧花／花椰菜遊戲的上台名單。新表，不回填既有婚宴。
CREATE TYPE "WeddingGame" AS ENUM ('BOUQUET', 'BROCCOLI');

CREATE TABLE "wedding_game_participants" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "game" "WeddingGame" NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "note" VARCHAR(200),
    "sort_order" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wedding_game_participants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wedding_game_participants_name_check" CHECK (btrim("name") <> ''),
    CONSTRAINT "wedding_game_participants_sort_order_check" CHECK ("sort_order" >= 0)
);

CREATE INDEX "wedding_game_participants_workspace_id_game_sort_order_idx" ON "wedding_game_participants"("workspace_id", "game", "sort_order");

CREATE UNIQUE INDEX "wedding_game_participants_id_workspace_id_key" ON "wedding_game_participants"("id", "workspace_id");

ALTER TABLE "wedding_game_participants" ADD CONSTRAINT "wedding_game_participants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
