import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("budget engagement suggestion identity contract", () => {
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260805120000_budget_engagement_suggestion_key",
    "migration.sql",
  );
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );

  it("models a nullable workspace-scoped suggestion identity", () => {
    expect(schema).toMatch(
      /suggestionKey\s+String\?\s+@db\.VarChar\(100\)\s+@map\("suggestion_key"\)/u,
    );
    expect(schema).toContain(
      '@@unique([workspaceId, suggestionKey], map: "budget_items_workspace_suggestion_key_key")',
    );
  });

  it("adds a forward-only unique key constrained to manual expense rows", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);

    expect(migration).toContain(
      'ADD COLUMN "suggestion_key" VARCHAR(100)',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_items_suggestion_key_shape_check"',
    );
    expect(migration).toContain(
      '"suggestion_key" ~ \'^ENGAGEMENT_(GROOM|BRIDE)_[A-Z0-9_]+$\'',
    );
    expect(migration).toContain('"source" = \'MANUAL\'');
    expect(migration).toContain('"kind" = \'EXPENSE\'');
    expect(migration).toContain('"system_taxonomy_key" IS NULL');
    expect(migration).toContain('cardinality("source_hierarchy_path") = 0');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "budget_items_workspace_suggestion_key_key"',
    );
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\b/iu);
  });
});
