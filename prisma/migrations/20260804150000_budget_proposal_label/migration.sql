BEGIN;

-- Keep workspace creation and every Budget mutation outside the validation and
-- rename window. The fixed-name CHECK is replaced in the same transaction.
LOCK TABLE "wedding_workspaces" IN SHARE MODE;
LOCK TABLE "budget_items" IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE "_budget_proposal_label_expected" (
  "key" VARCHAR(80) PRIMARY KEY,
  "label" TEXT NOT NULL,
  "parent_key" VARCHAR(80),
  "source_order" INTEGER NOT NULL,
  "public_item" BOOLEAN NOT NULL
) ON COMMIT DROP;

INSERT INTO "_budget_proposal_label_expected" (
  "key", "label", "parent_key", "source_order", "public_item"
) VALUES
  ('STAGE_PREPARATION_1_2_MONTHS', '籌備第1-2月', NULL, 1, FALSE),
  ('STAGE_PREPARATION_3_MONTH', '籌備第3個月', NULL, 2, FALSE),
  ('STAGE_PREPARATION_4_MONTH', '籌備婚禮第4個月', NULL, 3, FALSE),
  ('STAGE_COUNTDOWN_2_MONTHS', '婚禮前倒數2個月', NULL, 4, FALSE),
  ('STAGE_ENGAGEMENT_CEREMONY', '文定儀式用品、工作人員紅包', NULL, 5, FALSE),
  ('STAGE_WEDDING_PROCESSION', '迎娶儀式用品、工作人員紅包', NULL, 6, FALSE),
  ('INTERNAL_UNCLASSIFIED_STAGE', '系統保留', NULL, 7, FALSE),
  ('ITEM_PROPOSAL', '求婚', 'STAGE_PREPARATION_1_2_MONTHS', 1, TRUE),
  ('ITEM_WEDDING_VENUE', '婚宴場地', 'STAGE_PREPARATION_1_2_MONTHS', 2, TRUE),
  ('ITEM_PRE_WEDDING_PHOTOGRAPHY', '婚紗照拍攝', 'STAGE_PREPARATION_1_2_MONTHS', 3, TRUE),
  ('ITEM_WEDDING_CAKES', '喜餅', 'STAGE_PREPARATION_3_MONTH', 1, TRUE),
  ('ITEM_BRIDAL_STYLIST', '新娘秘書', 'STAGE_PREPARATION_3_MONTH', 2, TRUE),
  ('ITEM_WEDDING_PHOTOGRAPHY', '婚禮攝影', 'STAGE_PREPARATION_3_MONTH', 3, TRUE),
  ('ITEM_WEDDING_VIDEOGRAPHY', '婚禮錄影', 'STAGE_PREPARATION_3_MONTH', 4, TRUE),
  ('ITEM_WEDDING_HOST', '婚禮主持', 'STAGE_PREPARATION_3_MONTH', 5, TRUE),
  ('ITEM_WEDDING_BAND', '婚禮樂團', 'STAGE_PREPARATION_3_MONTH', 6, TRUE),
  ('ITEM_WEDDING_INTERACTION', '婚禮互動', 'STAGE_PREPARATION_3_MONTH', 7, TRUE),
  ('ITEM_ATTIRE_RENTAL', '禮服租借', 'STAGE_PREPARATION_4_MONTH', 1, TRUE),
  ('ITEM_WEDDING_SHOES', '婚鞋', 'STAGE_PREPARATION_4_MONTH', 2, TRUE),
  ('ITEM_WEDDING_DECOR', '婚禮佈置', 'STAGE_PREPARATION_4_MONTH', 3, TRUE),
  ('ITEM_INVITATIONS_POSTAGE', '印喜帖及寄送', 'STAGE_COUNTDOWN_2_MONTHS', 1, TRUE),
  ('ITEM_BEAUTY_TREATMENTS', '保養療程', 'STAGE_COUNTDOWN_2_MONTHS', 2, TRUE),
  ('ITEM_WEDDING_FAVORS', '婚禮小物', 'STAGE_COUNTDOWN_2_MONTHS', 3, TRUE),
  ('ITEM_ENGAGEMENT_GROOM', '文定儀式（男方準備）', 'STAGE_ENGAGEMENT_CEREMONY', 1, TRUE),
  ('ITEM_ENGAGEMENT_BRIDE', '文定儀式（女方準備）', 'STAGE_ENGAGEMENT_CEREMONY', 2, TRUE),
  ('ITEM_PROCESSION_GROOM', '迎娶儀式男方準備', 'STAGE_WEDDING_PROCESSION', 1, TRUE),
  ('ITEM_PROCESSION_BRIDE', '迎娶儀式女方準備', 'STAGE_WEDDING_PROCESSION', 2, TRUE),
  ('INTERNAL_UNCLASSIFIED_ITEM', '未分類既有項目', 'INTERNAL_UNCLASSIFIED_STAGE', 1, FALSE);

CREATE TEMP TABLE "_budget_proposal_label_before_ordinary" ON COMMIT DROP AS
SELECT "item"."id", to_jsonb("item") AS "payload"
FROM "budget_items" AS "item"
WHERE "item"."system_taxonomy_key" IS NULL;

ALTER TABLE "_budget_proposal_label_before_ordinary"
  ADD PRIMARY KEY ("id");

CREATE TEMP TABLE "_budget_proposal_label_before_system" ON COMMIT DROP AS
SELECT
  "item"."id",
  "item"."workspace_id",
  "item"."system_taxonomy_key",
  to_jsonb("item") AS "payload"
FROM "budget_items" AS "item"
WHERE "item"."system_taxonomy_key" IS NOT NULL;

ALTER TABLE "_budget_proposal_label_before_system"
  ADD PRIMARY KEY ("id");

CREATE TEMP TABLE "_budget_proposal_label_state" (
  "workspace_count" BIGINT NOT NULL,
  "old_name_count" BIGINT NOT NULL,
  "new_name_count" BIGINT NOT NULL,
  "updated_count" BIGINT NOT NULL DEFAULT 0
) ON COMMIT DROP;

INSERT INTO "_budget_proposal_label_state" (
  "workspace_count", "old_name_count", "new_name_count"
)
SELECT
  (SELECT count(*) FROM "wedding_workspaces"),
  count(*) FILTER (WHERE "name" = '提親'),
  count(*) FILTER (WHERE "name" = '求婚')
FROM "budget_items"
WHERE "system_taxonomy_key" = 'ITEM_PROPOSAL';

DO $preflight$
DECLARE
  "workspace_count" BIGINT;
  "fixed_node_count" BIGINT;
  "public_item_count" BIGINT;
  "name_constraint_count" BIGINT;
BEGIN
  SELECT "state"."workspace_count"
  INTO STRICT "workspace_count"
  FROM "_budget_proposal_label_state" AS "state";

  SELECT count(*) INTO "fixed_node_count"
  FROM "budget_items"
  WHERE "system_taxonomy_key" IS NOT NULL;

  SELECT count(*) INTO "public_item_count"
  FROM "budget_items"
  WHERE "system_taxonomy_key" LIKE 'ITEM\_%' ESCAPE '\';

  SELECT count(*) INTO "name_constraint_count"
  FROM "pg_constraint"
  WHERE "conrelid" = '"budget_items"'::regclass
    AND "conname" = 'budget_items_system_taxonomy_name_check'
    AND "contype" = 'c'
    AND "convalidated";

  IF (SELECT count(*) FROM "_budget_proposal_label_expected") <> 28
    OR (
      SELECT count(*) FROM "_budget_proposal_label_expected"
      WHERE "public_item"
    ) <> 20
  THEN
    RAISE EXCEPTION 'budget proposal label expected taxonomy is invalid';
  END IF;

  IF "name_constraint_count" <> 1 THEN
    RAISE EXCEPTION 'budget proposal label requires the validated taxonomy name check';
  END IF;

  IF "fixed_node_count" <> 28 * "workspace_count"
    OR "public_item_count" <> 20 * "workspace_count"
  THEN
    RAISE EXCEPTION 'budget proposal label requires exactly 28 system nodes and 20 public items per workspace';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "wedding_workspaces" AS "workspace"
    CROSS JOIN "_budget_proposal_label_expected" AS "expected"
    LEFT JOIN "budget_items" AS "node"
      ON "node"."workspace_id" = "workspace"."id"
     AND "node"."system_taxonomy_key" = "expected"."key"
    LEFT JOIN "budget_items" AS "parent"
      ON "parent"."id" = "node"."parent_id"
     AND "parent"."workspace_id" = "node"."workspace_id"
    WHERE "node"."id" IS NULL
      OR "node"."source" <> 'MANUAL'
      OR "node"."kind" <> 'GROUP'
      OR "node"."category" IS NOT NULL
      OR "node"."source_order" IS DISTINCT FROM "expected"."source_order"
      OR (
        "expected"."parent_key" IS NULL
        AND "node"."parent_id" IS NOT NULL
      )
      OR (
        "expected"."parent_key" IS NOT NULL
        AND (
          "node"."parent_id" IS NULL
          OR "parent"."system_taxonomy_key" IS DISTINCT FROM "expected"."parent_key"
        )
      )
      OR (
        "expected"."key" = 'ITEM_PROPOSAL'
        AND "node"."name" NOT IN ('提親', '求婚')
      )
      OR (
        "expected"."key" <> 'ITEM_PROPOSAL'
        AND "node"."name" IS DISTINCT FROM "expected"."label"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "budget_items" AS "node"
    WHERE "node"."system_taxonomy_key" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "_budget_proposal_label_expected" AS "expected"
        WHERE "expected"."key" = "node"."system_taxonomy_key"
      )
  ) THEN
    RAISE EXCEPTION 'budget proposal label preflight found taxonomy drift';
  END IF;

  IF (
    SELECT "old_name_count" + "new_name_count"
    FROM "_budget_proposal_label_state"
  ) <> "workspace_count" THEN
    RAISE EXCEPTION 'budget proposal label preflight found an invalid proposal name';
  END IF;
END
$preflight$;

ALTER TABLE "budget_items"
  DROP CONSTRAINT "budget_items_system_taxonomy_name_check";

WITH "updated" AS (
  UPDATE "budget_items"
  SET "name" = '求婚'
  WHERE "system_taxonomy_key" = 'ITEM_PROPOSAL'
    AND "name" = '提親'
  RETURNING 1
)
UPDATE "_budget_proposal_label_state"
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

DO $postflight$
DECLARE
  "workspace_count" BIGINT;
  "old_name_count" BIGINT;
  "updated_count" BIGINT;
  "constraint_definition" TEXT;
BEGIN
  SELECT "state"."workspace_count", "state"."old_name_count", "state"."updated_count"
  INTO STRICT "workspace_count", "old_name_count", "updated_count"
  FROM "_budget_proposal_label_state" AS "state";

  IF "updated_count" <> "old_name_count" THEN
    RAISE EXCEPTION 'budget proposal label updated an unexpected row count';
  END IF;

  IF EXISTS (
    WITH "current" AS (
      SELECT "item"."id", to_jsonb("item") AS "payload"
      FROM "budget_items" AS "item"
      WHERE "item"."system_taxonomy_key" IS NULL
    )
    SELECT 1
    FROM "_budget_proposal_label_before_ordinary" AS "before"
    FULL JOIN "current" USING ("id")
    WHERE "before"."id" IS NULL
      OR "current"."id" IS NULL
      OR "before"."payload" IS DISTINCT FROM "current"."payload"
  ) THEN
    RAISE EXCEPTION 'budget proposal label changed ordinary Budget data';
  END IF;

  IF EXISTS (
    WITH "current" AS (
      SELECT
        "item"."id",
        "item"."system_taxonomy_key",
        "item"."name",
        to_jsonb("item") AS "payload"
      FROM "budget_items" AS "item"
      WHERE "item"."system_taxonomy_key" IS NOT NULL
    )
    SELECT 1
    FROM "_budget_proposal_label_before_system" AS "before"
    FULL JOIN "current" USING ("id")
    WHERE "before"."id" IS NULL
      OR "current"."id" IS NULL
      OR "before"."system_taxonomy_key" IS DISTINCT FROM "current"."system_taxonomy_key"
      OR (
        "current"."system_taxonomy_key" = 'ITEM_PROPOSAL'
        AND (
          "current"."name" IS DISTINCT FROM '求婚'
          OR ("before"."payload" - 'name') IS DISTINCT FROM ("current"."payload" - 'name')
        )
      )
      OR (
        "current"."system_taxonomy_key" <> 'ITEM_PROPOSAL'
        AND "before"."payload" IS DISTINCT FROM "current"."payload"
      )
  ) THEN
    RAISE EXCEPTION 'budget proposal label changed data outside the fixed label';
  END IF;

  IF (
    SELECT count(*) FROM "budget_items"
    WHERE "system_taxonomy_key" IS NOT NULL
  ) <> 28 * "workspace_count" OR (
    SELECT count(*) FROM "budget_items"
    WHERE "system_taxonomy_key" LIKE 'ITEM\_%' ESCAPE '\'
  ) <> 20 * "workspace_count" THEN
    RAISE EXCEPTION 'budget proposal label changed the fixed taxonomy cardinality';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "wedding_workspaces" AS "workspace"
    CROSS JOIN "_budget_proposal_label_expected" AS "expected"
    LEFT JOIN "budget_items" AS "node"
      ON "node"."workspace_id" = "workspace"."id"
     AND "node"."system_taxonomy_key" = "expected"."key"
    LEFT JOIN "budget_items" AS "parent"
      ON "parent"."id" = "node"."parent_id"
     AND "parent"."workspace_id" = "node"."workspace_id"
    WHERE "node"."id" IS NULL
      OR "node"."name" IS DISTINCT FROM "expected"."label"
      OR "node"."source" <> 'MANUAL'
      OR "node"."kind" <> 'GROUP'
      OR "node"."category" IS NOT NULL
      OR "node"."source_order" IS DISTINCT FROM "expected"."source_order"
      OR (
        "expected"."parent_key" IS NULL
        AND "node"."parent_id" IS NOT NULL
      )
      OR (
        "expected"."parent_key" IS NOT NULL
        AND (
          "node"."parent_id" IS NULL
          OR "parent"."system_taxonomy_key" IS DISTINCT FROM "expected"."parent_key"
        )
      )
  ) THEN
    RAISE EXCEPTION 'budget proposal label produced an invalid final taxonomy';
  END IF;

  SELECT "pg_get_constraintdef"("oid")
  INTO STRICT "constraint_definition"
  FROM "pg_constraint"
  WHERE "conrelid" = '"budget_items"'::regclass
    AND "conname" = 'budget_items_system_taxonomy_name_check'
    AND "contype" = 'c'
    AND "convalidated";

  IF position('ITEM_PROPOSAL' IN "constraint_definition") = 0
    OR position('求婚' IN "constraint_definition") = 0
    OR position('提親' IN "constraint_definition") <> 0
  THEN
    RAISE EXCEPTION 'budget proposal label left an invalid taxonomy name check';
  END IF;
END
$postflight$;

COMMIT;
