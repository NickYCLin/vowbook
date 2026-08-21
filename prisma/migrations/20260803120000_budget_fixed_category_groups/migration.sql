BEGIN;

ALTER TABLE "budget_items"
  ADD COLUMN "system_taxonomy_key" VARCHAR(80);

-- Fixed taxonomy rows are manual system-owned groups, but unlike ordinary
-- MANUAL rows they need a stable source_order for spreadsheet ordering.
-- Keep the existing MANUAL/NOTION identity boundary strict for every other row.
ALTER TABLE "budget_items"
  DROP CONSTRAINT "budget_items_source_identity_check",
  ADD CONSTRAINT "budget_items_source_identity_check"
  CHECK (
    (
      "source" = 'MANUAL'
      AND "external_id" IS NULL
      AND "source_hash" IS NULL
      AND (
        (
          "system_taxonomy_key" IS NULL
          AND "source_order" IS NULL
        )
        OR (
          "system_taxonomy_key" IS NOT NULL
          AND "source_order" IS NOT NULL
        )
      )
    )
    OR (
      "source" = 'NOTION'
      AND "system_taxonomy_key" IS NULL
      AND "external_id" IS NOT NULL
      AND "source_hash" IS NOT NULL
      AND "source_order" IS NOT NULL
    )
  );

-- Always create fresh fixed stages. A user-created group with the same name
-- remains a user row and is attached below the matching fixed item later.
WITH "stages"("key", "name", "position") AS (
  VALUES
    ('STAGE_PREPARATION_1_2_MONTHS', '籌備第1-2月', 1),
    ('STAGE_PREPARATION_3_MONTH', '籌備第3個月', 2),
    ('STAGE_PREPARATION_4_MONTH', '籌備婚禮第4個月', 3),
    ('STAGE_COUNTDOWN_2_MONTHS', '婚禮前倒數2個月', 4),
    ('STAGE_ENGAGEMENT_CEREMONY', '文定儀式用品、工作人員紅包', 5),
    ('STAGE_WEDDING_PROCESSION', '迎娶儀式用品、工作人員紅包', 6),
    ('INTERNAL_UNCLASSIFIED_STAGE', '系統保留', 7)
)
INSERT INTO "budget_items" (
  "id", "workspace_id", "parent_id", "source", "external_id",
  "source_hash", "source_order", "name", "kind", "category",
  "system_taxonomy_key", "legacy_category", "planned_amount", "actual_amount",
  "due_date", "notes", "paid", "paid_at", "booking_status",
  "deposit_amount", "balance_amount", "additional_amount",
  "estimated_range", "candidate_vendors", "confirmed_vendor",
  "vendor_contact", "primary_contact", "version", "created_at", "updated_at"
)
SELECT
  'budget_taxonomy_' || md5("workspace"."id" || ':' || "stages"."key"),
  "workspace"."id", NULL, 'MANUAL', NULL,
  NULL, "stages"."position", "stages"."name", 'GROUP', NULL,
  "stages"."key", NULL, 0, NULL,
  NULL, NULL, FALSE, NULL, 'PLANNING',
  NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "wedding_workspaces" AS "workspace"
CROSS JOIN "stages";

-- Create the 20 public fixed item groups plus one internal preservation group below their fixed stage.
WITH "items"("key", "name", "parent_key", "position") AS (
  VALUES
    ('ITEM_PROPOSAL', '提親', 'STAGE_PREPARATION_1_2_MONTHS', 1),
    ('ITEM_WEDDING_VENUE', '婚宴場地', 'STAGE_PREPARATION_1_2_MONTHS', 2),
    ('ITEM_PRE_WEDDING_PHOTOGRAPHY', '婚紗照拍攝', 'STAGE_PREPARATION_1_2_MONTHS', 3),
    ('ITEM_WEDDING_CAKES', '喜餅', 'STAGE_PREPARATION_3_MONTH', 1),
    ('ITEM_BRIDAL_STYLIST', '新娘秘書', 'STAGE_PREPARATION_3_MONTH', 2),
    ('ITEM_WEDDING_PHOTOGRAPHY', '婚禮攝影', 'STAGE_PREPARATION_3_MONTH', 3),
    ('ITEM_WEDDING_VIDEOGRAPHY', '婚禮錄影', 'STAGE_PREPARATION_3_MONTH', 4),
    ('ITEM_WEDDING_HOST', '婚禮主持', 'STAGE_PREPARATION_3_MONTH', 5),
    ('ITEM_WEDDING_BAND', '婚禮樂團', 'STAGE_PREPARATION_3_MONTH', 6),
    ('ITEM_WEDDING_INTERACTION', '婚禮互動', 'STAGE_PREPARATION_3_MONTH', 7),
    ('ITEM_ATTIRE_RENTAL', '禮服租借', 'STAGE_PREPARATION_4_MONTH', 1),
    ('ITEM_WEDDING_SHOES', '婚鞋', 'STAGE_PREPARATION_4_MONTH', 2),
    ('ITEM_WEDDING_DECOR', '婚禮佈置', 'STAGE_PREPARATION_4_MONTH', 3),
    ('ITEM_INVITATIONS_POSTAGE', '印喜帖及寄送', 'STAGE_COUNTDOWN_2_MONTHS', 1),
    ('ITEM_BEAUTY_TREATMENTS', '保養療程', 'STAGE_COUNTDOWN_2_MONTHS', 2),
    ('ITEM_WEDDING_FAVORS', '婚禮小物', 'STAGE_COUNTDOWN_2_MONTHS', 3),
    ('ITEM_ENGAGEMENT_GROOM', '文定儀式（男方準備）', 'STAGE_ENGAGEMENT_CEREMONY', 1),
    ('ITEM_ENGAGEMENT_BRIDE', '文定儀式（女方準備）', 'STAGE_ENGAGEMENT_CEREMONY', 2),
    ('ITEM_PROCESSION_GROOM', '迎娶儀式男方準備', 'STAGE_WEDDING_PROCESSION', 1),
    ('ITEM_PROCESSION_BRIDE', '迎娶儀式女方準備', 'STAGE_WEDDING_PROCESSION', 2),
    ('INTERNAL_UNCLASSIFIED_ITEM', '未分類既有項目', 'INTERNAL_UNCLASSIFIED_STAGE', 1)
)
INSERT INTO "budget_items" (
  "id", "workspace_id", "parent_id", "source", "external_id",
  "source_hash", "source_order", "name", "kind", "category",
  "system_taxonomy_key", "legacy_category", "planned_amount", "actual_amount",
  "due_date", "notes", "paid", "paid_at", "booking_status",
  "deposit_amount", "balance_amount", "additional_amount",
  "estimated_range", "candidate_vendors", "confirmed_vendor",
  "vendor_contact", "primary_contact", "version", "created_at", "updated_at"
)
SELECT
  'budget_taxonomy_' || md5("workspace"."id" || ':' || "items"."key"),
  "workspace"."id", "stage"."id", 'MANUAL', NULL,
  NULL, "items"."position", "items"."name", 'GROUP', NULL,
  "items"."key", NULL, 0, NULL,
  NULL, NULL, FALSE, NULL, 'PLANNING',
  NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "wedding_workspaces" AS "workspace"
CROSS JOIN "items"
INNER JOIN "budget_items" AS "stage"
  ON "stage"."workspace_id" = "workspace"."id"
 AND "stage"."system_taxonomy_key" = "items"."parent_key";

-- Preserve every existing row, scalar value, category, and subtree. Exact
-- Drive item names take priority; known legacy aliases are migration inputs only.
-- A candidate is used only when every expense in that root's subtree already
-- has the item's default category. Unknown or mixed trees go to the hidden
-- internal preservation item.
WITH RECURSIVE "route_labels"(
  "name", "item_key", "item_category"
) AS (
  VALUES
    -- Exact spreadsheet item names.
    ('提親', 'ITEM_PROPOSAL', 'RINGS_KEEPSAKES'::"BudgetCostCategory"),
    ('婚宴場地', 'ITEM_WEDDING_VENUE', 'VENUE_CATERING'),
    ('婚紗照拍攝', 'ITEM_PRE_WEDDING_PHOTOGRAPHY', 'PHOTOGRAPHY_VIDEO'),
    ('喜餅', 'ITEM_WEDDING_CAKES', 'DECOR_GIFTS'),
    ('新娘秘書', 'ITEM_BRIDAL_STYLIST', 'ATTIRE_STYLING'),
    ('婚禮攝影', 'ITEM_WEDDING_PHOTOGRAPHY', 'PHOTOGRAPHY_VIDEO'),
    ('婚禮錄影', 'ITEM_WEDDING_VIDEOGRAPHY', 'PHOTOGRAPHY_VIDEO'),
    ('婚禮主持', 'ITEM_WEDDING_HOST', 'PEOPLE_SERVICES'),
    ('婚禮樂團', 'ITEM_WEDDING_BAND', 'PEOPLE_SERVICES'),
    ('婚禮互動', 'ITEM_WEDDING_INTERACTION', 'PEOPLE_SERVICES'),
    ('禮服租借', 'ITEM_ATTIRE_RENTAL', 'ATTIRE_STYLING'),
    ('婚鞋', 'ITEM_WEDDING_SHOES', 'ATTIRE_STYLING'),
    ('婚禮佈置', 'ITEM_WEDDING_DECOR', 'DECOR_GIFTS'),
    ('印喜帖及寄送', 'ITEM_INVITATIONS_POSTAGE', 'DECOR_GIFTS'),
    ('保養療程', 'ITEM_BEAUTY_TREATMENTS', 'ATTIRE_STYLING'),
    ('婚禮小物', 'ITEM_WEDDING_FAVORS', 'DECOR_GIFTS'),
    ('文定儀式（男方準備）', 'ITEM_ENGAGEMENT_GROOM', 'DECOR_GIFTS'),
    ('文定儀式（女方準備）', 'ITEM_ENGAGEMENT_BRIDE', 'DECOR_GIFTS'),
    ('迎娶儀式男方準備', 'ITEM_PROCESSION_GROOM', 'DECOR_GIFTS'),
    ('迎娶儀式女方準備', 'ITEM_PROCESSION_BRIDE', 'DECOR_GIFTS'),
    -- Prior patch labels remain accepted only as migration inputs.
    ('迎娶儀式（男方準備）', 'ITEM_PROCESSION_GROOM', 'DECOR_GIFTS'),
    ('迎娶儀式（女方準備）', 'ITEM_PROCESSION_BRIDE', 'DECOR_GIFTS'),
    ('文定儀式用品與工作人員紅包', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    ('迎娶儀式用品與工作人員紅包', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    ('文定儀式用品、工作人員紅包', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    ('迎娶儀式用品、工作人員紅包', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    ('既有項目／待分類', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    -- Broad legacy categories and synonyms.
    ('戒指與信物', 'ITEM_PROPOSAL', 'RINGS_KEEPSAKES'),
    ('戒指', 'ITEM_PROPOSAL', 'RINGS_KEEPSAKES'),
    ('信物', 'ITEM_PROPOSAL', 'RINGS_KEEPSAKES'),
    ('攝影與影像', 'ITEM_WEDDING_PHOTOGRAPHY', 'PHOTOGRAPHY_VIDEO'),
    ('攝影', 'ITEM_WEDDING_PHOTOGRAPHY', 'PHOTOGRAPHY_VIDEO'),
    ('影像', 'ITEM_WEDDING_PHOTOGRAPHY', 'PHOTOGRAPHY_VIDEO'),
    ('錄影', 'ITEM_WEDDING_PHOTOGRAPHY', 'PHOTOGRAPHY_VIDEO'),
    ('服裝與造型', 'ITEM_ATTIRE_RENTAL', 'ATTIRE_STYLING'),
    ('服裝', 'ITEM_ATTIRE_RENTAL', 'ATTIRE_STYLING'),
    ('造型', 'ITEM_ATTIRE_RENTAL', 'ATTIRE_STYLING'),
    ('場地與餐飲', 'ITEM_WEDDING_VENUE', 'VENUE_CATERING'),
    ('場地', 'ITEM_WEDDING_VENUE', 'VENUE_CATERING'),
    ('餐飲', 'ITEM_WEDDING_VENUE', 'VENUE_CATERING'),
    ('交通與住宿', 'INTERNAL_UNCLASSIFIED_ITEM', 'TRANSPORT_LODGING'),
    ('交通', 'INTERNAL_UNCLASSIFIED_ITEM', 'TRANSPORT_LODGING'),
    ('住宿', 'INTERNAL_UNCLASSIFIED_ITEM', 'TRANSPORT_LODGING'),
    ('佈置與禮品', 'ITEM_WEDDING_DECOR', 'DECOR_GIFTS'),
    ('佈置', 'ITEM_WEDDING_DECOR', 'DECOR_GIFTS'),
    ('禮品', 'ITEM_WEDDING_DECOR', 'DECOR_GIFTS'),
    ('人員與服務', 'ITEM_WEDDING_HOST', 'PEOPLE_SERVICES'),
    ('人員', 'ITEM_WEDDING_HOST', 'PEOPLE_SERVICES'),
    ('服務', 'ITEM_WEDDING_HOST', 'PEOPLE_SERVICES')
),
"root_candidates" AS (
  SELECT
    "existing"."id" AS "root_id",
    "existing"."workspace_id",
    COALESCE("route"."item_key", 'INTERNAL_UNCLASSIFIED_ITEM') AS "candidate_item_key",
    COALESCE(
      "route"."item_category",
      'OTHER_PENDING'::"BudgetCostCategory"
    ) AS "candidate_category"
  FROM "budget_items" AS "existing"
  LEFT JOIN "route_labels" AS "route"
    ON "route"."name" = "existing"."name"
  WHERE "existing"."parent_id" IS NULL
    AND "existing"."system_taxonomy_key" IS NULL
),
"subtree"("root_id", "workspace_id", "item_id") AS (
  SELECT
    "root_candidates"."root_id",
    "root_candidates"."workspace_id",
    "root_candidates"."root_id"
  FROM "root_candidates"

  UNION ALL

  SELECT
    "subtree"."root_id",
    "subtree"."workspace_id",
    "child"."id"
  FROM "subtree"
  INNER JOIN "budget_items" AS "child"
    ON "child"."workspace_id" = "subtree"."workspace_id"
   AND "child"."parent_id" = "subtree"."item_id"
),
"root_routes" AS (
  SELECT
    "root_candidates"."root_id",
    "root_candidates"."workspace_id",
    CASE
      WHEN "root_candidates"."candidate_item_key" = 'INTERNAL_UNCLASSIFIED_ITEM'
        THEN 'INTERNAL_UNCLASSIFIED_ITEM'
      WHEN NOT EXISTS (
        SELECT 1
        FROM "subtree"
        INNER JOIN "budget_items" AS "descendant"
          ON "descendant"."workspace_id" = "subtree"."workspace_id"
         AND "descendant"."id" = "subtree"."item_id"
        WHERE "subtree"."root_id" = "root_candidates"."root_id"
          AND "descendant"."kind" = 'EXPENSE'
          AND "descendant"."category" IS DISTINCT FROM
            "root_candidates"."candidate_category"
      ) THEN "root_candidates"."candidate_item_key"
      ELSE 'INTERNAL_UNCLASSIFIED_ITEM'
    END AS "item_key"
  FROM "root_candidates"
)
UPDATE "budget_items" AS "existing"
SET
  "parent_id" = "fixed_item"."id",
  "version" = "existing"."version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM "root_routes"
INNER JOIN "budget_items" AS "fixed_item"
  ON "fixed_item"."workspace_id" = "root_routes"."workspace_id"
 AND "fixed_item"."system_taxonomy_key" = "root_routes"."item_key"
WHERE "existing"."id" = "root_routes"."root_id"
  AND "existing"."workspace_id" = "root_routes"."workspace_id";

CREATE UNIQUE INDEX "budget_items_workspace_system_taxonomy_key"
  ON "budget_items"("workspace_id", "system_taxonomy_key");

ALTER TABLE "budget_items"
  ADD CONSTRAINT "budget_items_system_taxonomy_group_check"
  CHECK (
    "system_taxonomy_key" IS NULL
    OR ("kind" = 'GROUP' AND "category" IS NULL)
  ),
  ADD CONSTRAINT "budget_items_root_taxonomy_stage_check"
  CHECK (
    "parent_id" IS NOT NULL
    OR (
      "system_taxonomy_key" IS NOT NULL
      AND (
        "system_taxonomy_key" LIKE 'STAGE\_%' ESCAPE '\'
        OR "system_taxonomy_key" = 'INTERNAL_UNCLASSIFIED_STAGE'
      )
    )
  ),
  ADD CONSTRAINT "budget_items_system_taxonomy_hierarchy_check"
  CHECK (
    "system_taxonomy_key" IS NULL
    OR (
      (
        "system_taxonomy_key" LIKE 'STAGE\_%' ESCAPE '\'
        OR "system_taxonomy_key" = 'INTERNAL_UNCLASSIFIED_STAGE'
      )
      AND "parent_id" IS NULL
    )
    OR (
      (
        "system_taxonomy_key" LIKE 'ITEM\_%' ESCAPE '\'
        OR "system_taxonomy_key" = 'INTERNAL_UNCLASSIFIED_ITEM'
      )
      AND "parent_id" IS NOT NULL
    )
  ),
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
      WHEN 'ITEM_PROPOSAL' THEN '提親'
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
      WHEN 'ITEM_ENGAGEMENT_GROOM' THEN '文定儀式（男方準備）'
      WHEN 'ITEM_ENGAGEMENT_BRIDE' THEN '文定儀式（女方準備）'
      WHEN 'ITEM_PROCESSION_GROOM' THEN '迎娶儀式男方準備'
      WHEN 'ITEM_PROCESSION_BRIDE' THEN '迎娶儀式女方準備'
      WHEN 'INTERNAL_UNCLASSIFIED_ITEM' THEN '未分類既有項目'
      ELSE NULL
    END
  );

COMMIT;
