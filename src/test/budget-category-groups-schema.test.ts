import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("budget fixed category groups contract", () => {
  const migrationName = "20260803120000_budget_fixed_category_groups";
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    migrationName,
    "migration.sql",
  );
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );

  it("models one optional fixed taxonomy identity without replacing cost category", () => {
    expect(schema).toMatch(
      /systemTaxonomyKey\s+String\?\s+@db\.VarChar\(80\)\s+@map\("system_taxonomy_key"\)/,
    );
    expect(schema).toMatch(
      /@@unique\(\[workspaceId, systemTaxonomyKey\],\s*map:\s*"budget_items_workspace_system_taxonomy_key"\)/,
    );
    expect(schema).toMatch(/category\s+BudgetCostCategory\?/);
    expect(schema).not.toContain("systemCategory");
  });

  it("creates 6/20 public Drive nodes plus two hidden internal preservation nodes", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration.match(/\bBEGIN;/gu)).toHaveLength(1);
    expect(migration.match(/\bCOMMIT;/gu)).toHaveLength(1);
    expect(migration).toContain(
      'ADD COLUMN "system_taxonomy_key" VARCHAR(80)',
    );
    const taxonomyKeys = new Set(
      migration
        .match(/'(?:STAGE|ITEM)_[A-Z0-9_]+'/gu)
        ?.map((key) => key.slice(1, -1)),
    );
    expect([...taxonomyKeys].filter((key) => key.startsWith("STAGE_"))).toHaveLength(
      6,
    );
    expect([...taxonomyKeys].filter((key) => key.startsWith("ITEM_"))).toHaveLength(
      20,
    );
    expect(migration).toContain("'ITEM_WEDDING_VENUE'");
    expect(migration).toContain("'INTERNAL_UNCLASSIFIED_STAGE'");
    expect(migration).toContain("'INTERNAL_UNCLASSIFIED_ITEM'");
    expect(migration).not.toContain("'STAGE_OTHER'");
    expect(migration).not.toContain("'ITEM_PENDING'");
    expect(migration).toContain("'籌備婚禮第4個月'");
    expect(migration).toContain("'文定儀式用品、工作人員紅包'");
    expect(migration).toContain("'迎娶儀式男方準備'");
    expect(migration).toMatch(
      /"root_candidates"[\s\S]*"existing"\."parent_id" IS NULL[\s\S]*"existing"\."system_taxonomy_key" IS NULL[\s\S]*UPDATE "budget_items" AS "existing"/u,
    );
    expect(migration).toMatch(
      /\('喜餅',\s*'ITEM_WEDDING_CAKES',\s*'DECOR_GIFTS'\)/u,
    );
    expect(migration).toMatch(
      /\('場地與餐飲',\s*'ITEM_WEDDING_VENUE',\s*'VENUE_CATERING'\)/u,
    );
    expect(migration).toMatch(
      /\('錄影',\s*'ITEM_WEDDING_PHOTOGRAPHY',\s*'PHOTOGRAPHY_VIDEO'\)/u,
    );
    expect(migration).toMatch(
      /COALESCE\("route"\."item_key", 'INTERNAL_UNCLASSIFIED_ITEM'\)/u,
    );
    expect(migration).toMatch(
      /WITH RECURSIVE[\s\S]*"subtree"[\s\S]*"descendant"\."kind" = 'EXPENSE'[\s\S]*"descendant"\."category" IS DISTINCT FROM[\s\S]*ELSE 'INTERNAL_UNCLASSIFIED_ITEM'/u,
    );
    expect(migration).toContain(
      "('迎娶儀式（男方準備）', 'ITEM_PROCESSION_GROOM'",
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "budget_items_workspace_system_taxonomy_key"',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_items_system_taxonomy_group_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_items_system_taxonomy_name_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_items_system_taxonomy_hierarchy_check"',
    );
    expect(migration).toMatch(
      /DROP CONSTRAINT "budget_items_source_identity_check"[\s\S]*"source" = 'MANUAL'[\s\S]*"system_taxonomy_key" IS NOT NULL[\s\S]*"source_order" IS NOT NULL[\s\S]*"source" = 'NOTION'[\s\S]*"system_taxonomy_key" IS NULL/u,
    );
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"budget_items"/iu);
    expect(migration).not.toMatch(
      /SET[\s\S]*"(?:name|category|planned_amount|actual_amount|notes)"\s*=/iu,
    );
    expect(migration).not.toContain("system_category");
  });
});
