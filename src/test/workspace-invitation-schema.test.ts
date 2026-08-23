import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20260729083324_workspace_invitations";
const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  migrationName,
  "migration.sql",
);

describe("WorkspaceInvitation Prisma and migration contract", () => {
  it("adds the tenant-owned invitation model and audit relations", () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf8",
    );

    expect(schema).toMatch(
      /enum WorkspaceInvitationStatus\s*{[\s\S]*PENDING[\s\S]*ACCEPTED[\s\S]*REVOKED[\s\S]*EXPIRED/,
    );
    expect(schema).toMatch(
      /model User\s*{[\s\S]*email\s+String(?!\s+@unique)[\s\S]*@@index\(\[email\],\s*map:\s*"users_email_idx"\)/,
    );
    expect(schema).toMatch(/model WorkspaceInvitation\s*{/);
    expect(schema).toMatch(/email\s+String\s+@db\.VarChar\(254\)/);
    expect(schema).toMatch(/role\s+MembershipRole/);
    expect(schema).toMatch(/invitedByUserId\s+String/);
    expect(schema).toMatch(/acceptedByUserId\s+String\?/);
    expect(schema).toMatch(
      /expiresAt\s+DateTime\s+@map\("expires_at"\)/,
    );
    expect(schema).toMatch(/version\s+Int\s+@default\(1\)/);
    expect(schema).toMatch(
      /operationKey\s+String\s+@unique[^\n]*@db\.Uuid\s+@map\("operation_key"\)/,
    );
    expect(schema).toMatch(
      /supersededByInvitationId\s+String\?\s+@unique[^\n]*@map\("superseded_by_invitation_id"\)/,
    );
    expect(schema).toMatch(
      /supersededAt\s+DateTime\?\s+@map\("superseded_at"\)/,
    );
    expect(schema).not.toMatch(/@@unique\(\[workspaceId, email\]/);
    expect(schema).toMatch(
      /@@index\(\[workspaceId, email, status, expiresAt, createdAt, id\]/,
    );
    expect(schema).toMatch(
      /@@index\(\[email, status, expiresAt, createdAt, id\]/,
    );
    expect(schema).toMatch(
      /@@index\(\[workspaceId, status, expiresAt, createdAt, id\]/,
    );
    expect(schema).toMatch(
      /workspace\s+WeddingWorkspace\s+@relation\([^\n]*onDelete:\s*Cascade/,
    );
  });

  it("keeps the invitation migration twelfth before later features", () => {
    const migrations = fs
      .readdirSync(path.join(process.cwd(), "prisma", "migrations"), {
        withFileTypes: true,
      })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(migrations).toEqual([
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
      migrationName,
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
  });

  it("migrates reusable User emails before canonicalization and enforces immutable invitation generations", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    const dropEmailUnique = migration.indexOf('DROP INDEX "users_email_key"');
    const canonicalBackfill = migration.indexOf(
      'UPDATE "users"\nSET "email" = lower(btrim("email"))',
    );
    expect(dropEmailUnique).toBeGreaterThanOrEqual(0);
    expect(dropEmailUnique).toBeLessThan(canonicalBackfill);
    expect(migration).toMatch(
      /UPDATE "users"\s+SET "email" = lower\(btrim\("email"\)\)/,
    );
    expect(migration).toContain('CONSTRAINT "users_email_check"');
    expect(migration).toContain('CREATE INDEX "users_email_idx"');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"users"/iu);
    expect(migration).toContain('CREATE TYPE "WorkspaceInvitationStatus"');
    expect(migration).toContain("'EXPIRED'");
    expect(migration).toContain('CREATE TABLE "workspace_invitations"');
    expect(migration).toMatch(
      /"expires_at" TIMESTAMP\(3\) NOT NULL/,
    );
    expect(migration).toMatch(
      /"version" INTEGER NOT NULL DEFAULT 1/,
    );
    expect(migration).toMatch(/"operation_key" UUID NOT NULL/);
    expect(migration).toMatch(/"superseded_by_invitation_id" TEXT/);
    expect(migration).toMatch(/"superseded_at" TIMESTAMP\(3\)/);
    expect(migration).toContain(
      'CONSTRAINT "workspace_invitations_email_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "workspace_invitations_role_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "workspace_invitations_state_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "workspace_invitations_expiry_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "workspace_invitations_version_check"',
    );
    expect(migration).toMatch(/"expires_at" > "created_at"/);
    expect(migration).toMatch(/"version" >= 1/);
    expect(migration).toMatch(/lower\(btrim\("email"\)\)/);
    expect(migration).toMatch(/"role" <> 'OWNER'::"MembershipRole"/);
    expect(migration).not.toContain(
      '"workspace_invitations_workspace_id_email_key"',
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "workspace_invitations_one_pending_per_email_idx"[\s\S]*WHERE "status" = 'PENDING'::"WorkspaceInvitationStatus"/,
    );
    expect(migration).toContain(
      '"workspace_invitations_operation_key_key"',
    );
    expect(migration).toContain(
      '"workspace_invitations_superseded_by_invitation_id_key"',
    );
    expect(migration).toContain(
      '"workspace_invitations_superseded_by_invitation_id_fkey"',
    );
    expect(migration).toContain(
      'CONSTRAINT "workspace_invitations_lineage_check"',
    );
    expect(migration).toMatch(
      /"status" = 'ACCEPTED'::"WorkspaceInvitationStatus"[\s\S]*"accepted_at" < "expires_at"/,
    );
    expect(migration).toContain(
      '"enforce_workspace_invitation_immutability"',
    );
    expect(migration).toContain(
      '"workspace_invitations_email_status_expires_created_id_idx"',
    );
    expect(migration).toContain(
      '"workspace_invitations_ws_status_expires_created_id_idx"',
    );
    expect(migration).toMatch(
      /"workspace_invitations_workspace_id_fkey"[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toContain(
      '"workspace_invitations_invited_by_user_id_fkey"',
    );
    expect(migration).toContain(
      '"workspace_invitations_accepted_by_user_id_fkey"',
    );
  });
});
