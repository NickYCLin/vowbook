import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("budget related taxonomy purpose contract", () => {
  const migrationName = "20260803170000_budget_related_taxonomy_item";
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

  it("models one nullable public Drive item purpose without changing ownership", () => {
    expect(schema).toMatch(
      /relatedTaxonomyItemKey\s+String\?\s+@db\.VarChar\(80\)\s+@map\("related_taxonomy_item_key"\)/,
    );
    expect(schema).toMatch(/workspaceId\s+String\s+@map\("workspace_id"\)/);
    expect(schema).toMatch(/parentId\s+String\?\s+@map\("parent_id"\)/);
    expect(schema).not.toContain("relatedBudgetItemId");
  });

  it("adds only the nullable purpose column and constrains it to the 20 public item keys", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain(
      'ADD COLUMN "related_taxonomy_item_key" VARCHAR(80)',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_items_related_taxonomy_item_key_check"',
    );
    const relatedConstraint = migration.match(
      /CONSTRAINT "budget_items_related_taxonomy_item_key_check"[\s\S]*?\);/u,
    )?.[0] ?? "";
    expect(relatedConstraint).not.toBe("");
    const publicKeys = new Set(
      relatedConstraint
        .match(/'ITEM_[A-Z0-9_]+'/gu)
        ?.map((key) => key.slice(1, -1)) ?? [],
    );
    expect(publicKeys).toHaveLength(20);
    expect(publicKeys).toContain("ITEM_PRE_WEDDING_PHOTOGRAPHY");
    expect(publicKeys).toContain("ITEM_ATTIRE_RENTAL");
    expect(relatedConstraint).not.toContain("STAGE_");
    expect(relatedConstraint).not.toContain("INTERNAL_UNCLASSIFIED_ITEM");
    expect(migration).not.toMatch(/\bUPDATE\s+"budget_items"/iu);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+"budget_items"/iu);
  });
});
