import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20260804150000_budget_proposal_label";
const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  migrationName,
  "migration.sql",
);

describe("Budget proposal fixed-label migration", () => {
  it("is the forward-only twenty-second migration", () => {
    const migrationNames = fs
      .readdirSync(path.join(process.cwd(), "prisma", "migrations"), {
        withFileTypes: true,
      })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(migrationNames).toHaveLength(33);
    expect(migrationNames.at(21)).toBe(migrationName);
    expect(migrationNames.at(-9)).toBe(
      "20260813160000_seating_table_floor_plan",
    );
    expect(migrationNames.at(-8)).toBe(
      "20260817120000_seating_table_duplicate_names",
    );
    expect(migrationNames.at(-7)).toBe(
      "20260822120000_guest_roster_categories",
    );
    expect(migrationNames.at(-6)).toBe(
      "20260822130000_wedding_task_sides",
    );
    expect(migrationNames.at(-5)).toBe("20260823153000_user_profile_avatar");
    expect(migrationNames.at(-4)).toBe(
      "20260823155000_guest_details_invitation_reply_optional",
    );
    expect(migrationNames.at(-3)).toBe("20260824004000_user_access_admin");
    expect(migrationNames.at(-2)).toBe(
      "20260824213500_allow_family_party_size",
    );
    expect(migrationNames.at(-1)).toBe("20260825120000_guest_seniority");
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it("locks and snapshots the exact 28-node taxonomy plus every ordinary row", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration).toContain('LOCK TABLE "wedding_workspaces" IN SHARE MODE');
    expect(migration).toContain(
      'LOCK TABLE "budget_items" IN ACCESS EXCLUSIVE MODE',
    );
    expect(migration).toContain('"_budget_proposal_label_before_ordinary"');
    expect(migration).toContain('"_budget_proposal_label_before_system"');
    expect(migration).toContain('to_jsonb("item") AS "payload"');
    expect(migration).toContain(
      "requires exactly 28 system nodes and 20 public items per workspace",
    );
    expect(migration).toContain(
      '(SELECT count(*) FROM "_budget_proposal_label_expected") <> 28',
    );
    expect(migration).toContain('WHERE "public_item"');
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
  });

  it("accepts only the old or completed label and updates only the old fixed key", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    const updateSection = migration.slice(
      migration.indexOf('WITH "updated" AS'),
      migration.indexOf(
        'ALTER TABLE "budget_items"\n  ADD CONSTRAINT "budget_items_system_taxonomy_name_check"',
      ),
    );

    expect(migration).toContain(
      '"expected"."key" = \'ITEM_PROPOSAL\'\n        AND "node"."name" NOT IN (\'提親\', \'求婚\')',
    );
    expect(updateSection).toMatch(
      /UPDATE "budget_items"\s+SET "name" = '求婚'\s+WHERE "system_taxonomy_key" = 'ITEM_PROPOSAL'\s+AND "name" = '提親'/u,
    );
    expect(updateSection).not.toMatch(/system_taxonomy_key" IS NULL/u);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"budget_items"/iu);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"budget_items"/iu);
  });

  it("replaces the validated name check and proves ordinary data is byte-for-byte unchanged", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    const finalConstraint = migration.slice(
      migration.indexOf(
        'ADD CONSTRAINT "budget_items_system_taxonomy_name_check"',
      ),
      migration.indexOf("DO $postflight$"),
    );

    expect(migration).toContain(
      'DROP CONSTRAINT "budget_items_system_taxonomy_name_check"',
    );
    expect(finalConstraint).toContain("WHEN 'ITEM_PROPOSAL' THEN '求婚'");
    expect(finalConstraint).not.toContain("WHEN 'ITEM_PROPOSAL' THEN '提親'");
    expect(migration).toContain(
      '"before"."payload" IS DISTINCT FROM "current"."payload"',
    );
    expect(migration).toContain(
      "budget proposal label changed ordinary Budget data",
    );
    expect(migration).toContain(
      "budget proposal label changed data outside the fixed label",
    );
    expect(migration).toContain(
      '("before"."payload" - \'name\') IS DISTINCT FROM ("current"."payload" - \'name\')',
    );
    expect(migration).toContain(
      "budget proposal label left an invalid taxonomy name check",
    );
  });
});
