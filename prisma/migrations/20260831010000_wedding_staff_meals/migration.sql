BEGIN;

-- 便當份數與素食份數一起出現或一起缺席：NULL 代表這位工作人員不需要便當，
-- 只填其中一欄會讓「幾葷幾素」永遠算不出來。
ALTER TABLE "wedding_staff_assignments"
  ADD COLUMN "meal_count" INTEGER,
  ADD COLUMN "vegetarian_meal_count" INTEGER;

ALTER TABLE "wedding_staff_assignments"
  ADD CONSTRAINT "wedding_staff_assignments_meal_pairing_check" CHECK (
    ("meal_count" IS NULL) = ("vegetarian_meal_count" IS NULL)
  );

ALTER TABLE "wedding_staff_assignments"
  ADD CONSTRAINT "wedding_staff_assignments_meal_count_check" CHECK (
    "meal_count" IS NULL OR "meal_count" BETWEEN 1 AND 99
  );

-- 素食份數是便當份數的一部分，葷食由兩者相減得出，因此不能為負也不能超量。
ALTER TABLE "wedding_staff_assignments"
  ADD CONSTRAINT "wedding_staff_assignments_vegetarian_meal_count_check" CHECK (
    "vegetarian_meal_count" IS NULL
    OR ("vegetarian_meal_count" >= 0 AND "vegetarian_meal_count" <= "meal_count")
  );

COMMIT;
