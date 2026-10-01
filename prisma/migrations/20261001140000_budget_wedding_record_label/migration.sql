BEGIN;

-- 「婚禮攝影」固定品項改名為「婚禮紀錄」，底下分平面與錄影。
-- 只改每個 workspace 的這一筆固定分類名稱，不搬動、不改任何花費。
LOCK TABLE "wedding_workspaces" IN SHARE MODE;
LOCK TABLE "budget_items" IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE "_wedding_record_label_state" (
  "workspace_count" BIGINT NOT NULL,
  "fixed_count" BIGINT NOT NULL,
  "updated_count" BIGINT
) ON COMMIT DROP;

INSERT INTO "_wedding_record_label_state" ("workspace_count", "fixed_count")
SELECT
  (SELECT count(*) FROM "wedding_workspaces"),
  (SELECT count(*) FROM "budget_items"
   WHERE "system_taxonomy_key" = 'ITEM_WEDDING_PHOTOGRAPHY');

ALTER TABLE "budget_items"
  DROP CONSTRAINT "budget_items_system_taxonomy_name_check";

WITH "updated" AS (
  UPDATE "budget_items"
  SET "name" = '婚禮紀錄'
  WHERE "system_taxonomy_key" = 'ITEM_WEDDING_PHOTOGRAPHY'
  RETURNING 1
)
UPDATE "_wedding_record_label_state"
SET "updated_count" = (SELECT count(*) FROM "updated");

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
      WHEN 'ITEM_WEDDING_PHOTOGRAPHY' THEN '婚禮紀錄'
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

DO $postflight$
DECLARE
  "state" RECORD;
BEGIN
  SELECT * INTO STRICT "state" FROM "_wedding_record_label_state";
  IF "state"."updated_count" <> "state"."fixed_count" THEN
    RAISE EXCEPTION 'wedding record label updated an unexpected row count';
  END IF;
  IF "state"."fixed_count" <> "state"."workspace_count" THEN
    RAISE EXCEPTION 'wedding record label found a workspace without exactly one fixed item';
  END IF;
END
$postflight$;

COMMIT;
