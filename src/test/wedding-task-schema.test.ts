import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("wedding task schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const taskMigrationPath = path.join(
    migrationsPath,
    "20260722184500_wedding_tasks_mvp",
    "migration.sql",
  );
  const taskSidesMigrationPath = path.join(
    migrationsPath,
    "20260822130000_wedding_task_sides",
    "migration.sql",
  );

  it("defines the enum, workspace relation, tenant selector, and list index", () => {
    expect(schema).toMatch(
      /enum WeddingTaskStatus\s*{[\s\S]*TODO[\s\S]*IN_PROGRESS[\s\S]*DONE/,
    );
    expect(schema).toMatch(
      /enum WeddingTaskSide\s*{[\s\S]*SHARED[\s\S]*PARTNER_A[\s\S]*PARTNER_B/,
    );
    expect(schema).toMatch(/tasks\s+WeddingTask\[\]/);
    expect(schema).toMatch(/model WeddingTask\s*{/);
    expect(schema).toMatch(/dueDate\s+DateTime\?\s+@db\.Date/);
    expect(schema).toMatch(/status\s+WeddingTaskStatus\s+@default\(TODO\)/);
    expect(schema).toMatch(/side\s+WeddingTaskSide\s+@default\(SHARED\)/);
    expect(schema).toMatch(/completedAt\s+DateTime\?/);
    expect(schema).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(
      /workspace\s+WeddingWorkspace\s+@relation\([^\n]*onDelete:\s*Cascade/,
    );
    expect(schema).toMatch(/@@unique\(\[id, workspaceId\]\)/);
    expect(schema).toMatch(
      /@@index\(\[workspaceId, status, dueDate, createdAt, id\],\s*map:\s*"wedding_tasks_ws_status_due_created_id_idx"\)/,
    );
    expect(schema).toMatch(/@@map\("wedding_tasks"\)/);

    const taskModel = schema.match(/model WeddingTask\s*{[\s\S]*?\n}/)?.[0] ?? "";
    expect(taskModel).not.toMatch(/@@index\(\[workspaceId\]\)/);
  });

  it("keeps the task migration as the fourth migration before later features", () => {
    const migrationNames = fs
      .readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(migrationNames).toEqual([
      "20260722000000_init",
      "20260722164000_guest_list_mvp",
      "20260722175000_table_seating_mvp",
      "20260722184500_wedding_tasks_mvp",
      "20260722210000_linein_rsvp_import",
      "20260722224000_budget_mvp",
      "20260723120000_notion_budget_import",
      "20260726233000_budget_actual_amount_consistency",
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
    ]);
    expect(fs.existsSync(taskMigrationPath)).toBe(true);
  });

  it("adds a non-null task side and defaults every existing task to shared", () => {
    const migration = fs.readFileSync(taskSidesMigrationPath, "utf8");

    expect(migration).toContain('CREATE TYPE "WeddingTaskSide"');
    expect(migration).toMatch(
      /ADD COLUMN "side" "WeddingTaskSide" NOT NULL DEFAULT 'SHARED'/,
    );
  });

  it("creates PostgreSQL constraints, cascade FK, composite key, and list index", () => {
    const migration = fs.readFileSync(taskMigrationPath, "utf8");

    expect(migration).toContain('CREATE TYPE "WeddingTaskStatus"');
    expect(migration).toContain('CREATE TABLE "wedding_tasks"');
    expect(migration).toMatch(/"due_date" DATE/);
    expect(migration).toMatch(
      /"status" "WeddingTaskStatus" NOT NULL DEFAULT 'TODO'/,
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "wedding_tasks_id_workspace_id_key"',
    );
    expect(migration).toContain(
      'CREATE INDEX "wedding_tasks_ws_status_due_created_id_idx"',
    );
    expect(migration).not.toMatch(
      /CREATE INDEX "[^"]+" ON "wedding_tasks"\("workspace_id"\);/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("workspace_id"\)[\s\S]*REFERENCES "wedding_workspaces"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /"title" = btrim\("title"\)[\s\S]*char_length\("title"\) BETWEEN 1 AND 120/,
    );
    expect(migration).toMatch(
      /"description" IS NULL[\s\S]*"description" = btrim\("description"\)[\s\S]*char_length\("description"\) <= 1000/,
    );
    expect(migration).toMatch(
      /"status" = 'DONE'[\s\S]*"completed_at" IS NOT NULL[\s\S]*"status" <> 'DONE'[\s\S]*"completed_at" IS NULL/,
    );
    expect(migration).toMatch(/CHECK \("version" >= 0\)/);
  });
});
