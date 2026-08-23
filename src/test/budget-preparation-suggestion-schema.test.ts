import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("budget preparation suggestion identity migration", () => {
  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const priorMigrationPath = path.join(
    migrationsPath,
    "20260805120000_budget_engagement_suggestion_key",
    "migration.sql",
  );
  const migrationPath = path.join(
    migrationsPath,
    "20260805130000_budget_preparation_suggestion_key",
    "migration.sql",
  );

  it("extends the existing check in a new forward-only migration", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migrationDirectories = fs
      .readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(migrationDirectories).toHaveLength(31);
    expect(migrationDirectories.at(-9)).toBe(
      "20260805120000_budget_engagement_suggestion_key",
    );
    expect(migrationDirectories.at(-8)).toBe(
      "20260805130000_budget_preparation_suggestion_key",
    );
    expect(migrationDirectories.at(-7)).toBe(
      "20260813160000_seating_table_floor_plan",
    );
    expect(migrationDirectories.at(-6)).toBe(
      "20260817120000_seating_table_duplicate_names",
    );
    expect(migrationDirectories.at(-5)).toBe(
      "20260822120000_guest_roster_categories",
    );
    expect(migrationDirectories.at(-4)).toBe(
      "20260822130000_wedding_task_sides",
    );
    expect(migrationDirectories.at(-3)).toBe(
      "20260823153000_user_profile_avatar",
    );
    expect(migrationDirectories.at(-2)).toBe(
      "20260823155000_guest_details_invitation_reply_optional",
    );
    expect(migrationDirectories.at(-1)).toBe(
      "20260824004000_user_access_admin",
    );

    const priorMigration = fs.readFileSync(priorMigrationPath, "utf8");
    expect(priorMigration).toContain(
      '"suggestion_key" ~ \'^ENGAGEMENT_(GROOM|BRIDE)_[A-Z0-9_]+$\'',
    );
    expect(priorMigration).not.toContain("PREPARATION");
  });

  it("replaces and validates the same fail-closed shape check atomically", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toMatch(
      /ALTER TABLE "budget_items"\s+DROP CONSTRAINT "budget_items_suggestion_key_shape_check";/u,
    );
    expect(migration).toMatch(
      /ALTER TABLE "budget_items"\s+ADD CONSTRAINT "budget_items_suggestion_key_shape_check"\s+CHECK/u,
    );
    expect(migration).toContain(
      '"suggestion_key" ~ \'^(ENGAGEMENT_(GROOM|BRIDE)|PREPARATION)_[A-Z0-9_]+$\'',
    );
    expect(migration).toContain('"source" = \'MANUAL\'');
    expect(migration).toContain('"kind" = \'EXPENSE\'');
    expect(migration).toContain('"system_taxonomy_key" IS NULL');
    expect(migration).toContain('"external_id" IS NULL');
    expect(migration).toContain('"source_hash" IS NULL');
    expect(migration).toContain('"source_order" IS NULL');
    expect(migration).toContain('cardinality("source_hierarchy_path") = 0');
    expect(migration).toMatch(/\) NOT VALID;/u);
    expect(migration).toMatch(
      /VALIDATE CONSTRAINT "budget_items_suggestion_key_shape_check";/u,
    );
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/iu,
    );
  });
});
