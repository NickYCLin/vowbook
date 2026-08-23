import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("budget schema, migration, and PostgreSQL runner contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const migrationPath = path.join(
    migrationsPath,
    "20260722224000_budget_mvp",
    "migration.sql",
  );
  const consistencyMigrationName =
    "20260726233000_budget_actual_amount_consistency";
  const consistencyMigrationPath = path.join(
    migrationsPath,
    consistencyMigrationName,
    "migration.sql",
  );

  it("defines the workspace-owned BudgetItem contract and deterministic index", () => {
    expect(schema).toMatch(/budgetItems\s+BudgetItem\[\]/);
    expect(schema).toMatch(/model BudgetItem\s*{/);
    expect(schema).toMatch(/workspaceId\s+String\s+@map\("workspace_id"\)/);
    expect(schema).toMatch(/plannedAmount\s+Int\s+@map\("planned_amount"\)/);
    expect(schema).toMatch(/actualAmount\s+Int\?\s+@map\("actual_amount"\)/);
    expect(schema).toMatch(/dueDate\s+DateTime\?\s+@db\.Date\s+@map\("due_date"\)/);
    expect(schema).toMatch(/paid\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/paidAt\s+DateTime\?\s+@map\("paid_at"\)/);
    expect(schema).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(
      /workspace\s+WeddingWorkspace\s+@relation\([^\n]*onDelete:\s*Cascade/,
    );
    expect(schema).toMatch(/@@unique\(\[id, workspaceId\]\)/);
    expect(schema).toMatch(
      /@@index\(\[workspaceId, paid, dueDate, category, createdAt, id\],\s*map:\s*"budget_items_ws_paid_due_category_created_id_idx"\)/,
    );
    expect(schema).toMatch(/@@map\("budget_items"\)/);
  });

  it("keeps Budget as migration six and protects the first seven migrations", () => {
    const migrationNames = fs
      .readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const firstSevenMigrations = [
      "20260722000000_init",
      "20260722164000_guest_list_mvp",
      "20260722175000_table_seating_mvp",
      "20260722184500_wedding_tasks_mvp",
      "20260722210000_linein_rsvp_import",
      "20260722224000_budget_mvp",
      "20260723120000_notion_budget_import",
    ];

    expect(migrationNames.slice(0, 7)).toEqual(firstSevenMigrations);
    expect(migrationNames).toEqual([
      ...firstSevenMigrations,
      consistencyMigrationName,
      "20260727120000_wedding_operations",
      "20260727180000_budget_taxonomy_hierarchy",
      "20260727220000_budget_attachments",
      "20260729083324_workspace_invitations",
      "20260729222233_generic_guest_import_sources",
      "20260731163000_seating_table_positions",
      "20260802150000_guest_import_source_party_size",
      "20260802151000_linein_party_size_ownership",
      "20260802152000_linein_party_size_fail_closed",
      "20260803120000_budget_fixed_category_groups",
      "20260803170000_budget_related_taxonomy_item",
      "20260804113000_budget_notion_source_hierarchy_path",
      "20260804140000_budget_fixed_taxonomy_drift_repair",
      "20260804150000_budget_proposal_label",
      "20260805120000_budget_engagement_suggestion_key",
      "20260805130000_budget_preparation_suggestion_key",
      "20260813160000_seating_table_floor_plan",
      "20260817120000_seating_table_duplicate_names",
      "20260822120000_guest_roster_categories",
      "20260822130000_wedding_task_sides",
      "20260823153000_user_profile_avatar",
    ]);
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(fs.existsSync(consistencyMigrationPath)).toBe(true);
  });

  it("creates all database checks, tenant FK, unique selector, and list index", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "budget_items"');
    expect(migration).toMatch(/"due_date" DATE/);
    expect(migration).toContain('CONSTRAINT "budget_items_name_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_category_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_planned_amount_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_actual_amount_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_notes_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_version_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_paid_at_check"');
    expect(migration).toMatch(
      /"name" = btrim\("name"\)[\s\S]*"name" ~ '\[\^\[:space:\]\]'[\s\S]*char_length\("name"\) BETWEEN 1 AND 120/,
    );
    expect(migration).toMatch(
      /"category" = btrim\("category"\)[\s\S]*"category" ~ '\[\^\[:space:\]\]'[\s\S]*char_length\("category"\) BETWEEN 1 AND 60/,
    );
    expect(migration).toMatch(/"planned_amount" BETWEEN 0 AND 2147483647/);
    expect(migration).toMatch(
      /"actual_amount" IS NULL[\s\S]*"actual_amount" BETWEEN 0 AND 2147483647/,
    );
    expect(migration).toMatch(/"notes" IS NULL[\s\S]*char_length\("notes"\) <= 1000/);
    expect(migration).toMatch(/CHECK \("version" >= 0\)/);
    expect(migration).toMatch(
      /"paid" = TRUE[\s\S]*"paid_at" IS NOT NULL[\s\S]*"paid" = FALSE[\s\S]*"paid_at" IS NULL/,
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "budget_items_id_workspace_id_key"',
    );
    expect(migration).toContain(
      'CREATE INDEX "budget_items_ws_paid_due_category_created_id_idx"',
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("workspace_id"\)[\s\S]*REFERENCES "wedding_workspaces"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
  });

  it("ships migration eight as one idempotent-effect data-only correction", () => {
    const migration = fs.readFileSync(consistencyMigrationPath, "utf8");
    const executableSql = migration
      .replace(/--.*$/gmu, "")
      .trim();
    const updateStatements =
      executableSql.match(/\bUPDATE\s+"budget_items"/giu) ?? [];

    expect(executableSql).not.toMatch(
      /\b(?:CREATE|ALTER|DROP|TRUNCATE|DELETE)\b/iu,
    );
    expect(updateStatements).toHaveLength(1);
    expect(executableSql.match(/;/gu)).toHaveLength(1);
    expect(executableSql).toMatch(
      /^UPDATE\s+"budget_items"\s+SET[\s\S]+WHERE[\s\S]+;$/iu,
    );
    expect(executableSql).toMatch(
      /"actual_amount"\s*=\s*CASE\s+"booking_status"[\s\S]*WHEN\s+'PLANNING'\s+THEN\s+NULL[\s\S]*WHEN\s+'BOOKED_BALANCE_DUE'\s+THEN\s+"deposit_amount"[\s\S]*WHEN\s+'PAID'\s+THEN\s+"planned_amount"[\s\S]*END/iu,
    );
    expect(executableSql).toMatch(
      /"updated_at"\s*=\s*CURRENT_TIMESTAMP/iu,
    );
    expect(executableSql).toMatch(
      /"version"\s*=\s*"version"\s*\+\s*1/iu,
    );
    expect(executableSql).toMatch(
      /WHERE\s+"actual_amount"\s+IS\s+DISTINCT\s+FROM\s+CASE\s+"booking_status"[\s\S]*WHEN\s+'PLANNING'\s+THEN\s+NULL[\s\S]*WHEN\s+'BOOKED_BALANCE_DUE'\s+THEN\s+"deposit_amount"[\s\S]*WHEN\s+'PAID'\s+THEN\s+"planned_amount"[\s\S]*END\s*;/iu,
    );

    const setClause = executableSql.match(
      /\bSET\b([\s\S]+?)\bWHERE\b/iu,
    )?.[1];
    expect(setClause).toBeDefined();
    const assignedColumns = Array.from(
      setClause?.matchAll(/"([a-z_]+)"\s*=/gu) ?? [],
      (match) => match[1],
    ).sort();
    expect(assignedColumns).toEqual([
      "actual_amount",
      "updated_at",
      "version",
    ]);
  });
});
