import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260804140000_budget_fixed_taxonomy_drift_repair",
    "migration.sql",
  ),
  "utf8",
);

describe("Budget fixed-taxonomy production-drift repair migration", () => {
  it("is one forward-only locked transaction with no migration-history rewrite", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toMatch(
      /LOCK TABLE "wedding_workspaces", "budget_items", "budget_attachments"\s+IN ACCESS EXCLUSIVE MODE/u,
    );
    expect(migration).not.toMatch(/\bDELETE\b/u);
    expect(migration).not.toContain("_prisma_migrations");
    expect(migration).not.toContain("ON CONFLICT");
  });

  it("accepts only exact FRESH or known DRIFT schema shapes", () => {
    expect(migration).toContain('VALUES (\'FRESH\')');
    expect(migration).toContain('VALUES (\'DRIFT\')');
    expect(migration).toContain(
      "budget fixed taxonomy repair preflight rejected an unknown schema shape",
    );
    expect(migration).toContain('"system_taxonomy_is_expected"');
    expect(migration).toContain('"system_category_is_expected"');
    expect(migration).toContain('"related_taxonomy_is_expected"');
    expect(migration).toContain('"source_path_is_expected"');
    expect(migration).toContain('"related_constraint_is_exact"');
    expect(migration).toContain('"source_path_constraint_is_exact"');
    expect(migration).toContain('"source_identity_is_old_exact"');
    expect(migration).toContain('"source_identity_is_final_exact"');
    expect(migration).toContain('"final_constraints_are_exact"');
    expect(migration).toContain("character_maximum_length\" = 80");
    expect(migration).toContain("'ARRAY[]::text[]'");
    expect(migration).toContain("fd8fb57404fcf1a94224e0f70cc4d8aa");
    expect(migration).toContain("d7b85d163746fd2fa3593690cad2cddb");
    expect(migration).toContain("09e596be74dde6669381bbfa389ff76a");
    expect(migration).toContain("409dab701d53483841d4aba370c2117d");
  });

  it("requires exact non-partial non-expression unique indexes", () => {
    expect(migration.match(/"index_meta"\."indpred" IS NULL/gu)?.length).toBe(3);
    expect(migration.match(/"index_meta"\."indexprs" IS NULL/gu)?.length).toBe(3);
    expect(migration).toContain(
      "ARRAY['workspace_id', 'system_category']::name[]",
    );
    expect(migration).toContain(
      "ARRAY['workspace_id', 'system_taxonomy_key']::name[]",
    );
  });

  it("snapshots protected rows and attachments before repairing only known drift", () => {
    expect(migration).toContain('CREATE TEMP TABLE "_budget_taxonomy_before_items"');
    expect(migration).toContain(
      'CREATE TEMP TABLE "_budget_taxonomy_before_attachments"',
    );
    expect(migration).toContain(
      'CREATE TEMP TABLE "_budget_taxonomy_before_workspaces"',
    );
    expect(migration).toMatch(
      /UPDATE "budget_items"\s+SET "source_order" = NULL[\s\S]*"mode" = 'DRIFT'/u,
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "budget_items_root_category_group_check"',
    );
    expect(migration).toContain(
      'DROP INDEX "budget_items_workspace_system_category_key"',
    );
    expect(migration).toContain('DROP COLUMN "system_category"');
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "system_taxonomy_key" VARCHAR(80)',
    );
  });

  it("creates seven stages and twenty-one item groups without hiding parent errors", () => {
    expect(migration).toContain("'INTERNAL_UNCLASSIFIED_STAGE', '系統保留', 7");
    expect(migration).toContain(
      "'INTERNAL_UNCLASSIFIED_ITEM', '未分類既有項目', 'INTERNAL_UNCLASSIFIED_STAGE', 1",
    );
    expect(migration).toContain("'ITEM_PRE_WEDDING_PHOTOGRAPHY', '婚紗照拍攝'");
    expect(migration).toContain("'ITEM_WEDDING_SHOES', '婚鞋'");
    expect(migration).toMatch(
      /"expected"\."parent_key" IS NULL\s+AND "node"\."parent_id" IS NOT NULL/u,
    );
    expect(migration).toMatch(
      /"expected"\."parent_key" IS NOT NULL[\s\S]*"node"\."parent_id" IS NULL[\s\S]*"parent"\."system_taxonomy_key" IS DISTINCT FROM\s+"expected"\."parent_key"/u,
    );
    expect(migration).toContain(
      "budget fixed taxonomy repair did not create exactly 28 nodes per workspace",
    );
    expect(migration).toContain(
      "budget fixed taxonomy repair created an invalid final topology",
    );
  });

  it("fails the transaction if protected data, identity, row counts, or attachments drift", () => {
    expect(migration).toContain(
      "budget fixed taxonomy repair changed a protected existing field",
    );
    expect(migration).toContain(
      "budget fixed taxonomy repair changed a row outside the allowed drift repair",
    );
    expect(migration).toContain(
      "budget fixed taxonomy repair changed an attachment",
    );
    expect(migration).toContain(
      "budget fixed taxonomy repair left an ordinary root",
    );
    expect(migration).toContain(
      "budget fixed taxonomy repair left an invalid source identity",
    );
    expect(migration).toContain(
      '"current_item_count" <> "before_item_count" + (28 * "workspace_count")',
    );
    expect(migration).toContain(
      "budget fixed taxonomy repair left experimental schema objects",
    );
  });
});
