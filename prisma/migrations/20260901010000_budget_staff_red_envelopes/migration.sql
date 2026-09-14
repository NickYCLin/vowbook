BEGIN;

-- 工作人員紅包原本只掛在文定與迎娶兩個中式階段底下；沒有這些儀式的婚禮
-- 一樣要在婚宴結束時發紅包，因此在「婚禮前倒數2個月」補一個不分中西式的
-- 固定品項分類。budget 讀取端要求每個 workspace 的固定分類完整存在，
-- 所以必須為既有 workspace 一併補上，缺一個就會讓花費頁整頁讀不到資料。

-- 固定分類名稱由一條 validated CHECK 綁死，新 key 必須先納入才能寫入。
ALTER TABLE "budget_items"
  DROP CONSTRAINT "budget_items_system_taxonomy_name_check";

ALTER TABLE "budget_items"
  ADD CONSTRAINT "budget_items_system_taxonomy_name_check"
  CHECK (
    "system_taxonomy_key" IS NULL
    OR "name" IS NOT DISTINCT FROM CASE "system_taxonomy_key"
      WHEN 'STAGE_PREPARATION_1_2_MONTHS' THEN '籌備第1-2月'
      WHEN 'STAGE_PREPARATION_3_MONTH' THEN '籌備第3個月'
      WHEN 'STAGE_PREPARATION_4_MONTH' THEN '籌備婚禮第4個月'
      WHEN 'STAGE_COUNTDOWN_2_MONTHS' THEN '婚禮前倒數2個月'
      WHEN 'STAGE_ENGAGEMENT_CEREMONY' THEN '文定儀式用品、工作人員紅包'
      WHEN 'STAGE_WEDDING_PROCESSION' THEN '迎娶儀式用品、工作人員紅包'
      WHEN 'INTERNAL_UNCLASSIFIED_STAGE' THEN '系統保留'
      WHEN 'ITEM_PROPOSAL' THEN '求婚'
      WHEN 'ITEM_WEDDING_VENUE' THEN '婚宴場地'
      WHEN 'ITEM_PRE_WEDDING_PHOTOGRAPHY' THEN '婚紗照拍攝'
      WHEN 'ITEM_WEDDING_CAKES' THEN '喜餅'
      WHEN 'ITEM_BRIDAL_STYLIST' THEN '新娘秘書'
      WHEN 'ITEM_WEDDING_PHOTOGRAPHY' THEN '婚禮攝影'
      WHEN 'ITEM_WEDDING_VIDEOGRAPHY' THEN '婚禮錄影'
      WHEN 'ITEM_WEDDING_HOST' THEN '婚禮主持'
      WHEN 'ITEM_WEDDING_BAND' THEN '婚禮樂團'
      WHEN 'ITEM_WEDDING_INTERACTION' THEN '婚禮互動'
      WHEN 'ITEM_ATTIRE_RENTAL' THEN '禮服租借'
      WHEN 'ITEM_WEDDING_SHOES' THEN '婚鞋'
      WHEN 'ITEM_WEDDING_DECOR' THEN '婚禮佈置'
      WHEN 'ITEM_INVITATIONS_POSTAGE' THEN '印喜帖及寄送'
      WHEN 'ITEM_BEAUTY_TREATMENTS' THEN '保養療程'
      WHEN 'ITEM_WEDDING_FAVORS' THEN '婚禮小物'
      WHEN 'ITEM_STAFF_RED_ENVELOPES' THEN '工作人員紅包'
      WHEN 'ITEM_ENGAGEMENT_GROOM' THEN '文定儀式（男方準備）'
      WHEN 'ITEM_ENGAGEMENT_BRIDE' THEN '文定儀式（女方準備）'
      WHEN 'ITEM_PROCESSION_GROOM' THEN '迎娶儀式男方準備'
      WHEN 'ITEM_PROCESSION_BRIDE' THEN '迎娶儀式女方準備'
      WHEN 'INTERNAL_UNCLASSIFIED_ITEM' THEN '未分類既有項目'
      ELSE NULL
    END
  );

INSERT INTO "budget_items" (
  "id",
  "workspace_id",
  "parent_id",
  "source",
  "external_id",
  "source_hash",
  "source_order",
  "name",
  "kind",
  "category",
  "system_taxonomy_key",
  "legacy_category",
  "planned_amount",
  "actual_amount",
  "due_date",
  "notes",
  "paid",
  "paid_at",
  "booking_status",
  "deposit_amount",
  "balance_amount",
  "additional_amount",
  "estimated_range",
  "candidate_vendors",
  "confirmed_vendor",
  "vendor_contact",
  "primary_contact",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  stage."workspace_id",
  stage."id",
  'MANUAL',
  NULL,
  NULL,
  4,
  '工作人員紅包',
  'GROUP',
  NULL,
  'ITEM_STAFF_RED_ENVELOPES',
  NULL,
  0,
  NULL,
  NULL,
  NULL,
  false,
  NULL,
  'PLANNING',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "budget_items" AS stage
WHERE stage."system_taxonomy_key" = 'STAGE_COUNTDOWN_2_MONTHS'
  AND NOT EXISTS (
    SELECT 1
    FROM "budget_items" AS existing
    WHERE existing."workspace_id" = stage."workspace_id"
      AND existing."system_taxonomy_key" = 'ITEM_STAFF_RED_ENVELOPES'
  );

-- 每個 workspace 都必須剛好有一筆，否則花費頁會整頁讀不到資料。
DO $postflight$
DECLARE
  "workspace_count" BIGINT;
  "item_count" BIGINT;
BEGIN
  SELECT count(*) INTO "workspace_count"
  FROM "budget_items"
  WHERE "system_taxonomy_key" = 'STAGE_COUNTDOWN_2_MONTHS';

  SELECT count(*) INTO "item_count"
  FROM "budget_items"
  WHERE "system_taxonomy_key" = 'ITEM_STAFF_RED_ENVELOPES';

  IF "workspace_count" <> "item_count" THEN
    RAISE EXCEPTION
      'staff red envelope taxonomy backfill incomplete: % stages vs % items',
      "workspace_count", "item_count";
  END IF;
END;
$postflight$;

COMMIT;
