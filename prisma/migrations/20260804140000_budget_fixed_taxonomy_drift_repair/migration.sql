BEGIN;

-- Forward-only repair for the single known production drift. The complete
-- checked-in shape is accepted as a data no-op; every other shape fails closed.
LOCK TABLE "wedding_workspaces", "budget_items", "budget_attachments"
  IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE "_budget_taxonomy_repair_state" (
  "mode" TEXT PRIMARY KEY
) ON COMMIT DROP;

DO $preflight$
DECLARE
  "has_system_taxonomy" BOOLEAN;
  "system_taxonomy_is_expected" BOOLEAN;
  "has_system_category" BOOLEAN;
  "system_category_is_expected" BOOLEAN;
  "has_related_taxonomy" BOOLEAN;
  "related_taxonomy_is_expected" BOOLEAN;
  "has_source_path" BOOLEAN;
  "source_path_is_expected" BOOLEAN;
  "related_constraint_valid" BOOLEAN;
  "related_constraint_is_exact" BOOLEAN;
  "source_path_constraint_valid" BOOLEAN;
  "source_path_constraint_is_exact" BOOLEAN;
  "source_identity_is_old_exact" BOOLEAN;
  "source_identity_is_final_exact" BOOLEAN;
  "has_final_index" BOOLEAN;
  "final_index_is_exact" BOOLEAN;
  "has_experimental_index" BOOLEAN;
  "experimental_index_is_exact" BOOLEAN;
  "final_constraint_count" INTEGER;
  "final_constraints_are_exact" BOOLEAN;
  "experimental_constraint_count" INTEGER;
  "experimental_constraints_are_exact" BOOLEAN;
  "fresh_taxonomy_complete" BOOLEAN;
  "experimental_roots_complete" BOOLEAN;
  "source_identity_data_valid" BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'system_taxonomy_key'
  ) INTO "has_system_taxonomy";

  SELECT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'system_taxonomy_key'
      AND "data_type" = 'character varying'
      AND "udt_name" = 'varchar'
      AND "character_maximum_length" = 80
      AND "is_nullable" = 'YES'
      AND "column_default" IS NULL
  ) INTO "system_taxonomy_is_expected";

  SELECT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'system_category'
  ) INTO "has_system_category";

  SELECT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'system_category'
      AND "is_nullable" = 'YES'
      AND "udt_name" = 'BudgetCostCategory'
      AND "column_default" IS NULL
  ) INTO "system_category_is_expected";

  SELECT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'related_taxonomy_item_key'
  ) INTO "has_related_taxonomy";

  SELECT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'related_taxonomy_item_key'
      AND "data_type" = 'character varying'
      AND "udt_name" = 'varchar'
      AND "character_maximum_length" = 80
      AND "is_nullable" = 'YES'
      AND "column_default" IS NULL
  ) INTO "related_taxonomy_is_expected";

  SELECT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'source_hierarchy_path'
  ) INTO "has_source_path";

  SELECT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'source_hierarchy_path'
      AND "data_type" = 'ARRAY'
      AND "udt_name" = '_text'
      AND "is_nullable" = 'NO'
      AND "column_default" = 'ARRAY[]::text[]'
  ) INTO "source_path_is_expected";

  SELECT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"budget_items"'::regclass
      AND "conname" = 'budget_items_related_taxonomy_item_key_check'
      AND "convalidated"
  ) INTO "related_constraint_valid";

  SELECT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"budget_items"'::regclass
      AND "conname" = 'budget_items_related_taxonomy_item_key_check'
      AND "contype" = 'c'
      AND "convalidated"
      AND md5(regexp_replace(
        btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
      )) = 'fd8fb57404fcf1a94224e0f70cc4d8aa'
  ) INTO "related_constraint_is_exact";

  SELECT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"budget_items"'::regclass
      AND "conname" = 'budget_items_source_hierarchy_path_check'
      AND "convalidated"
  ) INTO "source_path_constraint_valid";

  SELECT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"budget_items"'::regclass
      AND "conname" = 'budget_items_source_hierarchy_path_check'
      AND "contype" = 'c'
      AND "convalidated"
      AND md5(regexp_replace(
        btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
      )) = 'd7b85d163746fd2fa3593690cad2cddb'
  ) INTO "source_path_constraint_is_exact";

  SELECT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"budget_items"'::regclass
      AND "conname" = 'budget_items_source_identity_check'
      AND "contype" = 'c'
      AND "convalidated"
      AND md5(regexp_replace(
        btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
      )) = '09e596be74dde6669381bbfa389ff76a'
  ) INTO "source_identity_is_old_exact";

  SELECT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"budget_items"'::regclass
      AND "conname" = 'budget_items_source_identity_check'
      AND "contype" = 'c'
      AND "convalidated"
      AND md5(regexp_replace(
        btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
      )) = '409dab701d53483841d4aba370c2117d'
  ) INTO "source_identity_is_final_exact";

  SELECT to_regclass(
    current_schema() || '.budget_items_workspace_system_taxonomy_key'
  ) IS NOT NULL INTO "has_final_index";
  SELECT to_regclass(
    current_schema() || '.budget_items_workspace_system_category_key'
  ) IS NOT NULL INTO "has_experimental_index";

  SELECT EXISTS (
    SELECT 1
    FROM "pg_class" AS "index_class"
    INNER JOIN "pg_index" AS "index_meta"
      ON "index_meta"."indexrelid" = "index_class"."oid"
    WHERE "index_class"."relname" = 'budget_items_workspace_system_taxonomy_key'
      AND "index_meta"."indrelid" = '"budget_items"'::regclass
      AND "index_meta"."indisunique"
      AND "index_meta"."indisvalid"
      AND "index_meta"."indisready"
      AND "index_meta"."indpred" IS NULL
      AND "index_meta"."indexprs" IS NULL
      AND "index_meta"."indnkeyatts" = 2
      AND "index_meta"."indnatts" = 2
      AND (
        SELECT array_agg("attribute"."attname" ORDER BY "key"."ordinality")
        FROM unnest("index_meta"."indkey") WITH ORDINALITY
          AS "key"("attnum", "ordinality")
        INNER JOIN "pg_attribute" AS "attribute"
          ON "attribute"."attrelid" = "index_meta"."indrelid"
         AND "attribute"."attnum" = "key"."attnum"
      ) = ARRAY['workspace_id', 'system_taxonomy_key']::name[]
  ) INTO "final_index_is_exact";

  SELECT EXISTS (
    SELECT 1
    FROM "pg_class" AS "index_class"
    INNER JOIN "pg_index" AS "index_meta"
      ON "index_meta"."indexrelid" = "index_class"."oid"
    WHERE "index_class"."relname" = 'budget_items_workspace_system_category_key'
      AND "index_meta"."indrelid" = '"budget_items"'::regclass
      AND "index_meta"."indisunique"
      AND "index_meta"."indisvalid"
      AND "index_meta"."indisready"
      AND "index_meta"."indpred" IS NULL
      AND "index_meta"."indexprs" IS NULL
      AND "index_meta"."indnkeyatts" = 2
      AND "index_meta"."indnatts" = 2
      AND (
        SELECT array_agg("attribute"."attname" ORDER BY "key"."ordinality")
        FROM unnest("index_meta"."indkey") WITH ORDINALITY
          AS "key"("attnum", "ordinality")
        INNER JOIN "pg_attribute" AS "attribute"
          ON "attribute"."attrelid" = "index_meta"."indrelid"
         AND "attribute"."attnum" = "key"."attnum"
      ) = ARRAY['workspace_id', 'system_category']::name[]
  ) INTO "experimental_index_is_exact";

  SELECT count(*)::INTEGER
  FROM "pg_constraint"
  WHERE "conrelid" = '"budget_items"'::regclass
    AND "conname" IN (
      'budget_items_system_taxonomy_group_check',
      'budget_items_root_taxonomy_stage_check',
      'budget_items_system_taxonomy_hierarchy_check',
      'budget_items_system_taxonomy_name_check'
    )
    AND "convalidated"
  INTO "final_constraint_count";

  SELECT count(*) = 4
  FROM "pg_constraint"
  WHERE "conrelid" = '"budget_items"'::regclass
    AND "contype" = 'c'
    AND "convalidated"
    AND (
      (
        "conname" = 'budget_items_system_taxonomy_group_check'
        AND md5(regexp_replace(
          btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
        )) = 'ff3e4d9551e8ed6acee54e6c6174d2e2'
      )
      OR (
        "conname" = 'budget_items_root_taxonomy_stage_check'
        AND md5(regexp_replace(
          btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
        )) = 'dcf6ba77502e7a894372f12a48dbaa6f'
      )
      OR (
        "conname" = 'budget_items_system_taxonomy_hierarchy_check'
        AND md5(regexp_replace(
          btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
        )) = '5791ef2fbd045f1c31898f95a14c3e2e'
      )
      OR (
        "conname" = 'budget_items_system_taxonomy_name_check'
        AND md5(regexp_replace(
          btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
        )) = '6fefafc42a54965ce8767d3ce83fc666'
      )
    )
  INTO "final_constraints_are_exact";

  SELECT count(*)::INTEGER
  FROM "pg_constraint"
  WHERE "conrelid" = '"budget_items"'::regclass
    AND "conname" IN (
      'budget_items_root_category_group_check',
      'budget_items_system_category_group_check',
      'budget_items_system_category_name_check'
    )
    AND "convalidated"
    AND pg_get_constraintdef("oid") LIKE '%system_category%'
  INTO "experimental_constraint_count";

  SELECT count(*) = 3
  FROM "pg_constraint"
  WHERE "conrelid" = '"budget_items"'::regclass
    AND "convalidated"
    AND (
      (
        "conname" = 'budget_items_root_category_group_check'
        AND regexp_replace(
          btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
        ) =
          'CHECK (((parent_id IS NOT NULL) OR (system_category IS NOT NULL)))'
      )
      OR (
        "conname" = 'budget_items_system_category_group_check'
        AND regexp_replace(
          btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
        ) =
          'CHECK (((system_category IS NULL) OR ((kind = ''GROUP''::"BudgetItemKind") AND (category IS NULL) AND (parent_id IS NULL))))'
      )
      OR (
        "conname" = 'budget_items_system_category_name_check'
        AND regexp_replace(
          btrim(pg_get_constraintdef("oid")), '[[:space:]]+', ' ', 'g'
        ) =
          'CHECK (((system_category IS NULL) OR (name = CASE system_category WHEN ''RINGS_KEEPSAKES''::"BudgetCostCategory" THEN ''戒指與信物''::text WHEN ''PHOTOGRAPHY_VIDEO''::"BudgetCostCategory" THEN ''攝影與影像''::text WHEN ''ATTIRE_STYLING''::"BudgetCostCategory" THEN ''服裝與造型''::text WHEN ''VENUE_CATERING''::"BudgetCostCategory" THEN ''場地與餐飲''::text WHEN ''TRANSPORT_LODGING''::"BudgetCostCategory" THEN ''交通與住宿''::text WHEN ''DECOR_GIFTS''::"BudgetCostCategory" THEN ''佈置與禮品''::text WHEN ''PEOPLE_SERVICES''::"BudgetCostCategory" THEN ''人員與服務''::text WHEN ''OTHER_PENDING''::"BudgetCostCategory" THEN ''其他／待整理''::text ELSE NULL::text END)))'
      )
    )
  INTO "experimental_constraints_are_exact";

  SELECT NOT EXISTS (
    SELECT 1 FROM "budget_items"
    WHERE (
      "source" = 'MANUAL'
      AND ("external_id" IS NOT NULL OR "source_hash" IS NOT NULL)
    ) OR (
      "source" = 'NOTION'
      AND (
        "external_id" IS NULL
        OR "source_hash" IS NULL
        OR "source_order" IS NULL
      )
    )
  ) INTO "source_identity_data_valid";

  "fresh_taxonomy_complete" := FALSE;
  IF "has_system_taxonomy" THEN
    EXECUTE $query$
      SELECT NOT EXISTS (
        SELECT 1
        FROM "wedding_workspaces" AS "workspace"
        LEFT JOIN LATERAL (
          SELECT count(*)::INTEGER AS "node_count"
          FROM "budget_items" AS "node"
          WHERE "node"."workspace_id" = "workspace"."id"
            AND "node"."system_taxonomy_key" IS NOT NULL
        ) AS "taxonomy" ON TRUE
        WHERE "taxonomy"."node_count" <> 28
      )
      AND NOT EXISTS (
        SELECT 1 FROM "budget_items"
        WHERE "parent_id" IS NULL
          AND "system_taxonomy_key" IS NULL
      )
    $query$ INTO "fresh_taxonomy_complete";
  END IF;

  "experimental_roots_complete" := FALSE;
  IF "has_system_category" THEN
    EXECUTE $query$
      SELECT NOT EXISTS (
        SELECT 1
        FROM "wedding_workspaces" AS "workspace"
        LEFT JOIN LATERAL (
          SELECT
            count(*)::INTEGER AS "root_count",
            count(DISTINCT "root"."system_category")::INTEGER
              AS "distinct_category_count"
          FROM "budget_items" AS "root"
          WHERE "root"."workspace_id" = "workspace"."id"
            AND "root"."parent_id" IS NULL
            AND "root"."system_category" IS NOT NULL
        ) AS "categories" ON TRUE
        WHERE "categories"."root_count" <> 8
           OR "categories"."distinct_category_count" <> 8
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "budget_items" AS "ordinary_root"
        WHERE "ordinary_root"."parent_id" IS NULL
          AND "ordinary_root"."system_category" IS NULL
      )
    $query$ INTO "experimental_roots_complete";
  END IF;

  IF
    "has_system_taxonomy"
    AND "system_taxonomy_is_expected"
    AND NOT "has_system_category"
    AND "has_related_taxonomy"
    AND "related_taxonomy_is_expected"
    AND "has_source_path"
    AND "source_path_is_expected"
    AND "related_constraint_valid"
    AND "related_constraint_is_exact"
    AND "source_path_constraint_valid"
    AND "source_path_constraint_is_exact"
    AND "has_final_index"
    AND "final_index_is_exact"
    AND NOT "has_experimental_index"
    AND "source_identity_data_valid"
    AND "source_identity_is_final_exact"
    AND "final_constraint_count" = 4
    AND "final_constraints_are_exact"
    AND "experimental_constraint_count" = 0
    AND "fresh_taxonomy_complete"
  THEN
    INSERT INTO "_budget_taxonomy_repair_state" ("mode") VALUES ('FRESH');
  ELSIF
    NOT "has_system_taxonomy"
    AND "has_system_category"
    AND "system_category_is_expected"
    AND "has_related_taxonomy"
    AND "related_taxonomy_is_expected"
    AND "has_source_path"
    AND "source_path_is_expected"
    AND "related_constraint_valid"
    AND "related_constraint_is_exact"
    AND "source_path_constraint_valid"
    AND "source_path_constraint_is_exact"
    AND "source_identity_is_old_exact"
    AND NOT "has_final_index"
    AND "has_experimental_index"
    AND "experimental_index_is_exact"
    AND "final_constraint_count" = 0
    AND "experimental_constraint_count" = 3
    AND "experimental_constraints_are_exact"
    AND "experimental_roots_complete"
    AND "source_identity_data_valid"
  THEN
    INSERT INTO "_budget_taxonomy_repair_state" ("mode") VALUES ('DRIFT');
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'budget fixed taxonomy repair preflight rejected an unknown schema shape';
  END IF;
END
$preflight$;

CREATE TEMP TABLE "_budget_taxonomy_before_items" ON COMMIT DROP AS
SELECT
  "id", "workspace_id", "parent_id", "source", "external_id",
  "source_hash", "source_order", "source_hierarchy_path", "name", "kind",
  "category", "legacy_category", "planned_amount",
  "related_taxonomy_item_key", "actual_amount", "due_date", "notes",
  "paid", "paid_at", "booking_status", "deposit_amount", "balance_amount",
  "additional_amount", "estimated_range", "candidate_vendors",
  "confirmed_vendor", "vendor_contact", "primary_contact", "version",
  "created_at", "updated_at"
FROM "budget_items";

CREATE UNIQUE INDEX "_budget_taxonomy_before_items_id"
  ON "_budget_taxonomy_before_items"("id");

CREATE TEMP TABLE "_budget_taxonomy_before_attachments" ON COMMIT DROP AS
TABLE "budget_attachments";

CREATE TEMP TABLE "_budget_taxonomy_before_workspaces" ON COMMIT DROP AS
SELECT "id" FROM "wedding_workspaces";

UPDATE "budget_items"
SET "source_order" = NULL
WHERE "source" = 'MANUAL'::"BudgetItemSource"
  AND "source_order" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "_budget_taxonomy_repair_state" WHERE "mode" = 'DRIFT'
  );

DO $drop_experimental$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "_budget_taxonomy_repair_state" WHERE "mode" = 'DRIFT'
  ) THEN
    ALTER TABLE "budget_items"
      DROP CONSTRAINT "budget_items_root_category_group_check",
      DROP CONSTRAINT "budget_items_system_category_group_check",
      DROP CONSTRAINT "budget_items_system_category_name_check";
    DROP INDEX "budget_items_workspace_system_category_key";
    ALTER TABLE "budget_items" DROP COLUMN "system_category";
  END IF;
END
$drop_experimental$;

ALTER TABLE "budget_items"
  ADD COLUMN IF NOT EXISTS "system_taxonomy_key" VARCHAR(80);

DO $identity$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "_budget_taxonomy_repair_state" WHERE "mode" = 'DRIFT'
  ) THEN
    ALTER TABLE "budget_items"
      DROP CONSTRAINT IF EXISTS "budget_items_source_identity_check";
    ALTER TABLE "budget_items"
      ADD CONSTRAINT "budget_items_source_identity_check"
      CHECK (
        (
          "source" = 'MANUAL'
          AND "external_id" IS NULL
          AND "source_hash" IS NULL
          AND (
            ("system_taxonomy_key" IS NULL AND "source_order" IS NULL)
            OR
            ("system_taxonomy_key" IS NOT NULL AND "source_order" IS NOT NULL)
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
  END IF;
END
$identity$;

CREATE UNIQUE INDEX IF NOT EXISTS "budget_items_workspace_system_taxonomy_key"
  ON "budget_items"("workspace_id", "system_taxonomy_key");

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
CROSS JOIN "stages"
WHERE EXISTS (
  SELECT 1 FROM "_budget_taxonomy_repair_state" WHERE "mode" = 'DRIFT'
)
;

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
 AND "stage"."system_taxonomy_key" = "items"."parent_key"
WHERE EXISTS (
  SELECT 1 FROM "_budget_taxonomy_repair_state" WHERE "mode" = 'DRIFT'
)
;

WITH RECURSIVE "route_labels"("name", "item_key", "item_category") AS (
  VALUES
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
    ('迎娶儀式（男方準備）', 'ITEM_PROCESSION_GROOM', 'DECOR_GIFTS'),
    ('迎娶儀式（女方準備）', 'ITEM_PROCESSION_BRIDE', 'DECOR_GIFTS'),
    ('文定儀式用品與工作人員紅包', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    ('迎娶儀式用品與工作人員紅包', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    ('文定儀式用品、工作人員紅包', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    ('迎娶儀式用品、工作人員紅包', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
    ('既有項目／待分類', 'INTERNAL_UNCLASSIFIED_ITEM', 'OTHER_PENDING'),
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
  LEFT JOIN "route_labels" AS "route" ON "route"."name" = "existing"."name"
  WHERE "existing"."parent_id" IS NULL
    AND "existing"."system_taxonomy_key" IS NULL
    AND EXISTS (
      SELECT 1 FROM "_budget_taxonomy_repair_state" WHERE "mode" = 'DRIFT'
    )
),
"subtree"("root_id", "workspace_id", "item_id") AS (
  SELECT "root_id", "workspace_id", "root_id" FROM "root_candidates"
  UNION ALL
  SELECT "subtree"."root_id", "subtree"."workspace_id", "child"."id"
  FROM "subtree"
  INNER JOIN "budget_items" AS "child"
    ON "child"."workspace_id" = "subtree"."workspace_id"
   AND "child"."parent_id" = "subtree"."item_id"
),
"root_routes" AS (
  SELECT
    "candidate"."root_id",
    "candidate"."workspace_id",
    CASE
      WHEN "candidate"."candidate_item_key" = 'INTERNAL_UNCLASSIFIED_ITEM'
        THEN 'INTERNAL_UNCLASSIFIED_ITEM'
      WHEN NOT EXISTS (
        SELECT 1
        FROM "subtree"
        INNER JOIN "budget_items" AS "descendant"
          ON "descendant"."workspace_id" = "subtree"."workspace_id"
         AND "descendant"."id" = "subtree"."item_id"
        WHERE "subtree"."root_id" = "candidate"."root_id"
          AND "descendant"."kind" = 'EXPENSE'
          AND "descendant"."category" IS DISTINCT FROM
            "candidate"."candidate_category"
      ) THEN "candidate"."candidate_item_key"
      ELSE 'INTERNAL_UNCLASSIFIED_ITEM'
    END AS "item_key"
  FROM "root_candidates" AS "candidate"
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

DO $taxonomy_constraints$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "_budget_taxonomy_repair_state" WHERE "mode" = 'DRIFT'
  ) THEN
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
  END IF;
END
$taxonomy_constraints$;

DO $assertions$
DECLARE
  "repair_mode" TEXT;
  "before_item_count" BIGINT;
  "workspace_count" BIGINT;
  "current_item_count" BIGINT;
BEGIN
  SELECT "mode" INTO STRICT "repair_mode"
  FROM "_budget_taxonomy_repair_state";
  SELECT count(*) INTO "before_item_count"
  FROM "_budget_taxonomy_before_items";
  SELECT count(*) INTO "workspace_count"
  FROM "_budget_taxonomy_before_workspaces";
  SELECT count(*) INTO "current_item_count" FROM "budget_items";

  IF EXISTS (
    SELECT 1
    FROM "_budget_taxonomy_before_items" AS "before"
    LEFT JOIN "budget_items" AS "current" ON "current"."id" = "before"."id"
    WHERE "current"."id" IS NULL
      OR ROW(
        "current"."workspace_id", "current"."source", "current"."external_id",
        "current"."source_hash", "current"."source_hierarchy_path",
        "current"."name", "current"."kind", "current"."category",
        "current"."legacy_category", "current"."planned_amount",
        "current"."related_taxonomy_item_key", "current"."actual_amount",
        "current"."due_date", "current"."notes", "current"."paid",
        "current"."paid_at", "current"."booking_status",
        "current"."deposit_amount", "current"."balance_amount",
        "current"."additional_amount", "current"."estimated_range",
        "current"."candidate_vendors", "current"."confirmed_vendor",
        "current"."vendor_contact", "current"."primary_contact",
        "current"."created_at"
      ) IS DISTINCT FROM ROW(
        "before"."workspace_id", "before"."source", "before"."external_id",
        "before"."source_hash", "before"."source_hierarchy_path",
        "before"."name", "before"."kind", "before"."category",
        "before"."legacy_category", "before"."planned_amount",
        "before"."related_taxonomy_item_key", "before"."actual_amount",
        "before"."due_date", "before"."notes", "before"."paid",
        "before"."paid_at", "before"."booking_status",
        "before"."deposit_amount", "before"."balance_amount",
        "before"."additional_amount", "before"."estimated_range",
        "before"."candidate_vendors", "before"."confirmed_vendor",
        "before"."vendor_contact", "before"."primary_contact",
        "before"."created_at"
      )
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair changed a protected existing field';
  END IF;

  IF "repair_mode" = 'FRESH' AND EXISTS (
    SELECT 1
    FROM "_budget_taxonomy_before_items" AS "before"
    INNER JOIN "budget_items" AS "current" ON "current"."id" = "before"."id"
    WHERE ROW(
      "current"."parent_id", "current"."source_order",
      "current"."version", "current"."updated_at"
    ) IS DISTINCT FROM ROW(
      "before"."parent_id", "before"."source_order",
      "before"."version", "before"."updated_at"
    )
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair was not a fresh-shape data no-op';
  END IF;

  IF "repair_mode" = 'DRIFT' AND EXISTS (
    SELECT 1
    FROM "_budget_taxonomy_before_items" AS "before"
    INNER JOIN "budget_items" AS "current" ON "current"."id" = "before"."id"
    LEFT JOIN "budget_items" AS "parent" ON "parent"."id" = "current"."parent_id"
    WHERE
      ("current"."source" = 'MANUAL' AND "current"."source_order" IS NOT NULL)
      OR (
        "current"."source" <> 'MANUAL'
        AND "current"."source_order" IS DISTINCT FROM "before"."source_order"
      )
      OR (
        "before"."parent_id" IS NOT NULL
        AND "current"."parent_id" IS DISTINCT FROM "before"."parent_id"
      )
      OR (
        "before"."parent_id" IS NULL
        AND (
          "current"."parent_id" IS NULL
          OR "parent"."system_taxonomy_key" IS NULL
          OR NOT (
            "parent"."system_taxonomy_key" LIKE 'ITEM\_%' ESCAPE '\'
            OR "parent"."system_taxonomy_key" = 'INTERNAL_UNCLASSIFIED_ITEM'
          )
        )
      )
      OR "current"."version" <> "before"."version" +
        CASE WHEN "before"."parent_id" IS NULL THEN 1 ELSE 0 END
      OR (
        "before"."parent_id" IS NOT NULL
        AND "current"."updated_at" IS DISTINCT FROM "before"."updated_at"
      )
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair changed a row outside the allowed drift repair';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      (SELECT * FROM "_budget_taxonomy_before_attachments"
       EXCEPT SELECT * FROM "budget_attachments")
      UNION ALL
      (SELECT * FROM "budget_attachments"
       EXCEPT SELECT * FROM "_budget_taxonomy_before_attachments")
    ) AS "attachment_difference"
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair changed an attachment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "budget_items"
    WHERE "parent_id" IS NULL
      AND "system_taxonomy_key" IS NULL
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair left an ordinary root';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "wedding_workspaces" AS "workspace"
    LEFT JOIN LATERAL (
      SELECT count(*)::INTEGER AS "node_count"
      FROM "budget_items" AS "node"
      WHERE "node"."workspace_id" = "workspace"."id"
        AND "node"."system_taxonomy_key" IS NOT NULL
    ) AS "taxonomy" ON TRUE
    WHERE "taxonomy"."node_count" <> 28
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair did not create exactly 28 nodes per workspace';
  END IF;

  IF EXISTS (
    WITH "expected"("key", "parent_key", "source_order") AS (
      VALUES
        ('STAGE_PREPARATION_1_2_MONTHS', NULL, 1),
        ('STAGE_PREPARATION_3_MONTH', NULL, 2),
        ('STAGE_PREPARATION_4_MONTH', NULL, 3),
        ('STAGE_COUNTDOWN_2_MONTHS', NULL, 4),
        ('STAGE_ENGAGEMENT_CEREMONY', NULL, 5),
        ('STAGE_WEDDING_PROCESSION', NULL, 6),
        ('INTERNAL_UNCLASSIFIED_STAGE', NULL, 7),
        ('ITEM_PROPOSAL', 'STAGE_PREPARATION_1_2_MONTHS', 1),
        ('ITEM_WEDDING_VENUE', 'STAGE_PREPARATION_1_2_MONTHS', 2),
        ('ITEM_PRE_WEDDING_PHOTOGRAPHY', 'STAGE_PREPARATION_1_2_MONTHS', 3),
        ('ITEM_WEDDING_CAKES', 'STAGE_PREPARATION_3_MONTH', 1),
        ('ITEM_BRIDAL_STYLIST', 'STAGE_PREPARATION_3_MONTH', 2),
        ('ITEM_WEDDING_PHOTOGRAPHY', 'STAGE_PREPARATION_3_MONTH', 3),
        ('ITEM_WEDDING_VIDEOGRAPHY', 'STAGE_PREPARATION_3_MONTH', 4),
        ('ITEM_WEDDING_HOST', 'STAGE_PREPARATION_3_MONTH', 5),
        ('ITEM_WEDDING_BAND', 'STAGE_PREPARATION_3_MONTH', 6),
        ('ITEM_WEDDING_INTERACTION', 'STAGE_PREPARATION_3_MONTH', 7),
        ('ITEM_ATTIRE_RENTAL', 'STAGE_PREPARATION_4_MONTH', 1),
        ('ITEM_WEDDING_SHOES', 'STAGE_PREPARATION_4_MONTH', 2),
        ('ITEM_WEDDING_DECOR', 'STAGE_PREPARATION_4_MONTH', 3),
        ('ITEM_INVITATIONS_POSTAGE', 'STAGE_COUNTDOWN_2_MONTHS', 1),
        ('ITEM_BEAUTY_TREATMENTS', 'STAGE_COUNTDOWN_2_MONTHS', 2),
        ('ITEM_WEDDING_FAVORS', 'STAGE_COUNTDOWN_2_MONTHS', 3),
        ('ITEM_ENGAGEMENT_GROOM', 'STAGE_ENGAGEMENT_CEREMONY', 1),
        ('ITEM_ENGAGEMENT_BRIDE', 'STAGE_ENGAGEMENT_CEREMONY', 2),
        ('ITEM_PROCESSION_GROOM', 'STAGE_WEDDING_PROCESSION', 1),
        ('ITEM_PROCESSION_BRIDE', 'STAGE_WEDDING_PROCESSION', 2),
        ('INTERNAL_UNCLASSIFIED_ITEM', 'INTERNAL_UNCLASSIFIED_STAGE', 1)
    )
    SELECT 1
    FROM "wedding_workspaces" AS "workspace"
    CROSS JOIN "expected"
    LEFT JOIN "budget_items" AS "node"
      ON "node"."workspace_id" = "workspace"."id"
     AND "node"."system_taxonomy_key" = "expected"."key"
    LEFT JOIN "budget_items" AS "parent" ON "parent"."id" = "node"."parent_id"
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
          OR "parent"."system_taxonomy_key" IS DISTINCT FROM
            "expected"."parent_key"
        )
      )
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair created an invalid final topology';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "budget_items"
    WHERE NOT (
      (
        "source" = 'MANUAL'
        AND "external_id" IS NULL
        AND "source_hash" IS NULL
        AND (
          ("system_taxonomy_key" IS NULL AND "source_order" IS NULL)
          OR ("system_taxonomy_key" IS NOT NULL AND "source_order" IS NOT NULL)
        )
      )
      OR (
        "source" = 'NOTION'
        AND "system_taxonomy_key" IS NULL
        AND "external_id" IS NOT NULL
        AND "source_hash" IS NOT NULL
        AND "source_order" IS NOT NULL
      )
    )
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair left an invalid source identity';
  END IF;

  IF "repair_mode" = 'FRESH' AND "current_item_count" <> "before_item_count" THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair inserted rows into a complete shape';
  END IF;
  IF "repair_mode" = 'DRIFT'
    AND "current_item_count" <> "before_item_count" + (28 * "workspace_count")
  THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair inserted an unexpected row count';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'budget_items'
      AND "column_name" = 'system_category'
  ) OR to_regclass(
    current_schema() || '.budget_items_workspace_system_category_key'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair left experimental schema objects';
  END IF;

  IF (
    SELECT count(*)
    FROM "pg_constraint"
    WHERE "conrelid" = '"budget_items"'::regclass
      AND "conname" IN (
        'budget_items_source_identity_check',
        'budget_items_system_taxonomy_group_check',
        'budget_items_root_taxonomy_stage_check',
        'budget_items_system_taxonomy_hierarchy_check',
        'budget_items_system_taxonomy_name_check'
      )
      AND "convalidated"
  ) <> 5 THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair did not validate final constraints';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "pg_class" AS "index_class"
    INNER JOIN "pg_index" AS "index_meta"
      ON "index_meta"."indexrelid" = "index_class"."oid"
    WHERE "index_class"."relname" = 'budget_items_workspace_system_taxonomy_key'
      AND "index_meta"."indrelid" = '"budget_items"'::regclass
      AND "index_meta"."indisunique"
      AND "index_meta"."indisvalid"
      AND "index_meta"."indisready"
      AND "index_meta"."indpred" IS NULL
      AND "index_meta"."indexprs" IS NULL
      AND "index_meta"."indnkeyatts" = 2
      AND "index_meta"."indnatts" = 2
      AND (
        SELECT array_agg("attribute"."attname" ORDER BY "key"."ordinality")
        FROM unnest("index_meta"."indkey") WITH ORDINALITY
          AS "key"("attnum", "ordinality")
        INNER JOIN "pg_attribute" AS "attribute"
          ON "attribute"."attrelid" = "index_meta"."indrelid"
         AND "attribute"."attnum" = "key"."attnum"
      ) = ARRAY['workspace_id', 'system_taxonomy_key']::name[]
  ) THEN
    RAISE EXCEPTION 'budget fixed taxonomy repair did not create the exact final unique index';
  END IF;
END
$assertions$;

COMMIT;
