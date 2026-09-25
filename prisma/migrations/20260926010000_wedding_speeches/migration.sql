-- 謝親恩致詞稿。新表，不回填既有婚宴。
CREATE TYPE "WeddingSpeechKind" AS ENUM ('GROOM_PARENTS', 'BRIDE_PARENTS');

CREATE TABLE "wedding_speeches" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" "WeddingSpeechKind" NOT NULL,
    "content" VARCHAR(3000) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wedding_speeches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wedding_speeches_content_check" CHECK (btrim("content") <> ''),
    CONSTRAINT "wedding_speeches_version_check" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "wedding_speeches_workspace_id_kind_key" ON "wedding_speeches"("workspace_id", "kind");

CREATE UNIQUE INDEX "wedding_speeches_id_workspace_id_key" ON "wedding_speeches"("id", "workspace_id");

ALTER TABLE "wedding_speeches" ADD CONSTRAINT "wedding_speeches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
