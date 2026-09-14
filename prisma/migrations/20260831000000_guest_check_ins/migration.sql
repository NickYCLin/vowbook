BEGIN;

CREATE TABLE "guest_check_ins" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "guest_id" TEXT NOT NULL,
  "headcount" INTEGER NOT NULL,
  "notes" VARCHAR(200),
  "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "guest_check_ins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guest_check_ins_headcount_check" CHECK ("headcount" BETWEEN 1 AND 20),
  CONSTRAINT "guest_check_ins_notes_check" CHECK (
    "notes" IS NULL OR (
      "notes" = btrim("notes")
      AND char_length("notes") BETWEEN 1 AND 200
      AND "notes" ~ '[^[:space:]]'
    )
  ),
  CONSTRAINT "guest_check_ins_version_check" CHECK ("version" >= 0)
);

-- 一位賓客只會有一筆報到紀錄：報到桌重複點選必須是更新同一列，
-- 而不是替同一組賓客再開一筆，否則實到人數會被重複累加。
CREATE UNIQUE INDEX "guest_check_ins_guest_id_workspace_id_key"
  ON "guest_check_ins"("guest_id", "workspace_id");

CREATE UNIQUE INDEX "guest_check_ins_id_workspace_id_key"
  ON "guest_check_ins"("id", "workspace_id");

CREATE INDEX "guest_check_ins_ws_checked_in_id_idx"
  ON "guest_check_ins"("workspace_id", "checked_in_at", "id");

ALTER TABLE "guest_check_ins"
  ADD CONSTRAINT "guest_check_ins_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 複合外鍵讓資料庫自己拒絕跨 workspace 的報到紀錄，
-- 不必仰賴應用層每次都記得帶上 workspace 條件。
ALTER TABLE "guest_check_ins"
  ADD CONSTRAINT "guest_check_ins_guest_ws_fkey"
  FOREIGN KEY ("guest_id", "workspace_id")
  REFERENCES "guests"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
