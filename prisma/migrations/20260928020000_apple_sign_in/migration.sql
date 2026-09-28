-- Sign in with Apple：Apple 登入是另一個帳號，不和 Google 帳號依 Email 合併。
-- 只新增欄位並放寬 google_subject，既有資料不變。
ALTER TABLE "users" ALTER COLUMN "google_subject" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "apple_subject" TEXT;
CREATE UNIQUE INDEX "users_apple_subject_key" ON "users"("apple_subject");
ALTER TABLE "users" ADD CONSTRAINT "users_identity_check"
  CHECK ("google_subject" IS NOT NULL OR "apple_subject" IS NOT NULL);
