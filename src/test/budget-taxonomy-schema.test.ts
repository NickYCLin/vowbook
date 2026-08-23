import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("budget taxonomy forward migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migrationName = "20260727180000_budget_taxonomy_hierarchy";
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    migrationName,
    "migration.sql",
  );

  it("defines typed kind and nullable fee category fields with a taxonomy index", () => {
    expect(schema).toMatch(
      /enum BudgetItemKind\s*{[\s\S]*?GROUP\s+EXPENSE\s*}/,
    );
    expect(schema).toMatch(
      /enum BudgetCostCategory\s*{[\s\S]*?RINGS_KEEPSAKES\s+PHOTOGRAPHY_VIDEO\s+ATTIRE_STYLING\s+VENUE_CATERING\s+TRANSPORT_LODGING\s+DECOR_GIFTS\s+PEOPLE_SERVICES\s+OTHER_PENDING\s*}/,
    );
    expect(schema).toMatch(/kind\s+BudgetItemKind\s+@default\(EXPENSE\)/);
    expect(schema).toMatch(/category\s+BudgetCostCategory\?/);
    expect(schema).toMatch(
      /legacyCategory\s+String\?\s+@db\.VarChar\(60\)\s+@map\("legacy_category"\)/,
    );
    expect(schema).toMatch(
      /@@index\(\[workspaceId, kind, category, createdAt, id\],\s*map:\s*"budget_items_ws_kind_category_created_id_idx"\)/,
    );
  });

  it("keeps its data-safe add/backfill/drop/rename migration before later features", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migrationNames = fs
      .readdirSync(path.join(process.cwd(), "prisma", "migrations"), {
        withFileTypes: true,
      })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(migrationNames.slice(-22)).toEqual([
      migrationName,
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
    ]);
    const migration = fs.readFileSync(migrationPath, "utf8");
    expect(migration).toContain('CREATE TYPE "BudgetItemKind"');
    expect(migration).toContain('CREATE TYPE "BudgetCostCategory"');
    expect(migration).toMatch(
      /ADD COLUMN "kind" "BudgetItemKind" NOT NULL DEFAULT 'EXPENSE'/,
    );
    expect(migration).toMatch(
      /ADD COLUMN "cost_category" "BudgetCostCategory"/,
    );
    expect(migration).toMatch(/ADD COLUMN "legacy_category" VARCHAR\(60\)/);
    expect(migration).toMatch(
      /UPDATE "budget_items"[\s\S]*SET "legacy_category" = "category"[\s\S]*DROP COLUMN "category"/,
    );
    expect(migration).toMatch(
      /EXISTS\s*\([\s\S]*FROM "budget_items" AS child[\s\S]*child\."parent_id" = item\."id"[\s\S]*child\."workspace_id" = item\."workspace_id"/,
    );
    expect(migration).toMatch(
      /"planned_amount" = 0[\s\S]*"actual_amount" IS NULL[\s\S]*"deposit_amount" IS NULL[\s\S]*"balance_amount" IS NULL[\s\S]*"additional_amount" IS NULL[\s\S]*"paid_at" IS NULL[\s\S]*"due_date" IS NULL[\s\S]*"booking_status" = 'PLANNING'[\s\S]*"paid" = FALSE[\s\S]*"estimated_range" IS NULL[\s\S]*"candidate_vendors" IS NULL[\s\S]*"confirmed_vendor" IS NULL[\s\S]*"vendor_contact" IS NULL[\s\S]*"primary_contact" IS NULL[\s\S]*"notes" IS NULL/,
    );
    expect(migration).toMatch(
      /ELSE 'OTHER_PENDING'::"BudgetCostCategory"/,
    );
    expect(migration).toMatch(/DROP COLUMN "category"/);
    expect(migration).toMatch(
      /RENAME COLUMN "cost_category" TO "category"/,
    );
  });

  it("enforces exact kind/category and group-neutral invariants at the database", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    expect(migration).toContain(
      'CONSTRAINT "budget_items_kind_category_check"',
    );
    expect(migration).toMatch(
      /"kind" = 'GROUP'[\s\S]*"category" IS NULL[\s\S]*"kind" = 'EXPENSE'[\s\S]*"category" IS NOT NULL/,
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_items_group_neutral_fields_check"',
    );
    expect(migration).toMatch(
      /"kind" <> 'GROUP'[\s\S]*"planned_amount" = 0[\s\S]*"actual_amount" IS NULL[\s\S]*"deposit_amount" IS NULL[\s\S]*"balance_amount" IS NULL[\s\S]*"additional_amount" IS NULL[\s\S]*"paid_at" IS NULL[\s\S]*"due_date" IS NULL[\s\S]*"booking_status" = 'PLANNING'[\s\S]*"paid" = FALSE[\s\S]*"estimated_range" IS NULL[\s\S]*"candidate_vendors" IS NULL[\s\S]*"confirmed_vendor" IS NULL[\s\S]*"vendor_contact" IS NULL[\s\S]*"primary_contact" IS NULL[\s\S]*"notes" IS NULL/,
    );
    expect(migration).toContain(
      'CREATE INDEX "budget_items_ws_kind_category_created_id_idx"',
    );
  });
});
