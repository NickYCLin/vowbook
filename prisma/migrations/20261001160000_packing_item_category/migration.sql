-- 入住打包清單：新增宴客用品分類與備註；既有物品維持個人物品，不改其他資料。
CREATE TYPE "PackingCategory" AS ENUM ('PERSONAL', 'WEDDING_SUPPLY');

ALTER TABLE "packing_items"
    ADD COLUMN "category" "PackingCategory" NOT NULL DEFAULT 'PERSONAL',
    ADD COLUMN "note" VARCHAR(120);
