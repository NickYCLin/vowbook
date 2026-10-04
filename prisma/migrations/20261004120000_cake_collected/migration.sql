-- 發餅名單：網頁上可勾選已領取；只新增欄位，既有資料維持未領取。
ALTER TABLE "guests" ADD COLUMN "cake_collected_at" TIMESTAMP(3);
