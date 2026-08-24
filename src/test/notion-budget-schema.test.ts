import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Notion Budget schema and forward migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const migrationName = "20260723120000_notion_budget_import";
  const consistencyMigrationName =
    "20260726233000_budget_actual_amount_consistency";
  const migrationPath = path.join(
    migrationsPath,
    migrationName,
    "migration.sql",
  );

  it("adds the three enums and workspace-scoped hierarchy/source fields", () => {
    expect(schema).toMatch(
      /enum BudgetItemSource\s*{[\s\S]*?MANUAL\s+NOTION\s*}/,
    );
    expect(schema).toMatch(
      /enum BudgetBookingStatus\s*{[\s\S]*?PLANNING\s+BOOKED_BALANCE_DUE\s+PAID\s*}/,
    );
    expect(schema).toMatch(
      /enum BudgetPrimaryContact\s*{[\s\S]*?PARTNER_A\s+PARTNER_B\s*}/,
    );
    expect(schema).toMatch(/parentId\s+String\?\s+@map\("parent_id"\)/);
    expect(schema).toMatch(
      /source\s+BudgetItemSource\s+@default\(MANUAL\)/,
    );
    expect(schema).toMatch(/externalId\s+String\?[^\n]*@map\("external_id"\)/);
    expect(schema).toMatch(/sourceHash\s+String\?[^\n]*@map\("source_hash"\)/);
    expect(schema).toMatch(/sourceOrder\s+Int\?\s+@map\("source_order"\)/);
    expect(schema).toMatch(
      /bookingStatus\s+BudgetBookingStatus\s+@default\(PLANNING\)/,
    );
    expect(schema).toMatch(/depositAmount\s+Int\?\s+@map\("deposit_amount"\)/);
    expect(schema).toMatch(/balanceAmount\s+Int\?\s+@map\("balance_amount"\)/);
    expect(schema).toMatch(/additionalAmount\s+Int\?\s+@map\("additional_amount"\)/);
    expect(schema).toMatch(/primaryContact\s+BudgetPrimaryContact\?/);
    expect(schema).toMatch(
      /parent\s+BudgetItem\?\s+@relation\("BudgetItemHierarchy",[\s\S]*fields:\s*\[parentId, workspaceId\][\s\S]*references:\s*\[id, workspaceId\][\s\S]*onDelete:\s*NoAction[\s\S]*onUpdate:\s*Cascade/,
    );
    expect(schema).toMatch(
      /children\s+BudgetItem\[\]\s+@relation\("BudgetItemHierarchy"\)/,
    );
    expect(schema).toMatch(/@@unique\(\[workspaceId, source, externalId\]/);
    expect(schema).toMatch(/budget_items_ws_parent_source_order_tree_idx/);
  });

  it("ships migrations seven and eight without changing the first seven migrations", () => {
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
      migrationName,
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
      "20260823155000_guest_details_invitation_reply_optional",
      "20260824004000_user_access_admin",
      "20260824213500_allow_family_party_size",
    ]);
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it("backfills v6 rows and enforces identity, hierarchy, status, and rich-field checks", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain('CREATE TYPE "BudgetItemSource"');
    expect(migration).toContain('CREATE TYPE "BudgetBookingStatus"');
    expect(migration).toContain('CREATE TYPE "BudgetPrimaryContact"');
    expect(migration).toMatch(
      /UPDATE "budget_items"[\s\S]*"booking_status"\s*=\s*CASE[\s\S]*WHEN "paid" = TRUE THEN 'PAID'/,
    );
    expect(migration).toContain('CONSTRAINT "budget_items_parent_not_self_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_source_identity_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_external_id_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_source_hash_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_source_order_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_components_check"');
    expect(migration).toContain('CONSTRAINT "budget_items_booking_status_paid_check"');
    expect(migration).toMatch(
      /"source" = 'MANUAL'[\s\S]*"external_id" IS NULL[\s\S]*"source_hash" IS NULL[\s\S]*"source_order" IS NULL[\s\S]*"source" = 'NOTION'[\s\S]*"external_id" IS NOT NULL[\s\S]*"source_hash" IS NOT NULL[\s\S]*"source_order" IS NOT NULL/,
    );
    expect(migration).toContain(
      "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
    );
    expect(migration).toContain("'^[0-9a-f]{64}$'");
    expect(migration).toMatch(/"paid" = \("booking_status" = 'PAID'/);
    expect(migration).toMatch(
      /"booking_status" = 'PAID'[\s\S]*OR[\s\S]*"paid_at" IS NULL/,
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "budget_items_workspace_source_external_id_key"',
    );
    expect(migration).toContain(
      'CREATE INDEX "budget_items_ws_parent_source_order_tree_idx"',
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("parent_id", "workspace_id"\)[\s\S]*REFERENCES "budget_items"\("id", "workspace_id"\)[\s\S]*ON DELETE NO ACTION ON UPDATE CASCADE/,
    );
  });
});
