import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Budget Notion source hierarchy path schema contract", () => {
  const migrationName =
    "20260804113000_budget_notion_source_hierarchy_path";
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma",
      "migrations",
      migrationName,
      "migration.sql",
    ),
    "utf8",
  );

  it("stores a read-only source path without changing the Drive parent tree", () => {
    expect(schema).toMatch(
      /sourceHierarchyPath\s+String\[\]\s+@default\(\[\]\)\s+@map\("source_hierarchy_path"\)/,
    );
    expect(migration).toContain(
      'ADD COLUMN "source_hierarchy_path" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_items_source_hierarchy_path_check"',
    );
    expect(migration).toMatch(
      /cardinality\("source_hierarchy_path"\) <= 4/,
    );
    expect(migration).toContain(
      'array_position("source_hierarchy_path", NULL) IS NULL',
    );
    expect(migration).toContain(
      `array_position("source_hierarchy_path", '') IS NULL`,
    );
    expect(migration).toMatch(
      /cardinality\("source_hierarchy_path"\) = 0[\s\S]*"source" = 'NOTION'::"BudgetItemSource"/,
    );
  });
});
