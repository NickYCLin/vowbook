-- 便當與素食套餐的單價、服務費率。數量取自既有名單，這裡只存單價。
-- 全部 additive：兩個單價可為 NULL 代表尚未設定，服務費率預設 0 不改變既有金額。
ALTER TABLE "wedding_workspaces"
  ADD COLUMN "staff_meal_unit_price" INTEGER,
  ADD COLUMN "vegetarian_meal_unit_price" INTEGER,
  ADD COLUMN "service_charge_percent" INTEGER NOT NULL DEFAULT 0;
