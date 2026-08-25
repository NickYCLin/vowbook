-- 賓客輩份由使用者明確設定，不從自由文字的關係補充猜測。
CREATE TYPE "GuestSeniority" AS ENUM ('ELDER', 'PEER', 'JUNIOR', 'UNSPECIFIED');

ALTER TABLE "guests"
  ADD COLUMN "seniority" "GuestSeniority" NOT NULL DEFAULT 'UNSPECIFIED';

-- 新郎、新娘相對彼此固定是平輩；其他既有資料保留未設定，避免誤判。
UPDATE "guests"
  SET "seniority" = 'PEER'
  WHERE "category" = 'COUPLE';

CREATE INDEX "guests_workspace_seniority_idx"
  ON "guests"("workspace_id", "seniority");
