import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("wedding operations schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260727120000_wedding_operations",
    "migration.sql",
  );

  it("defines workspace-scoped staff, timeline, and assignment models", () => {
    expect(schema).toMatch(/model WeddingStaffAssignment\s*{/);
    expect(schema).toMatch(/model WeddingTimelineItem\s*{/);
    expect(schema).toMatch(/model WeddingTimelineStaffAssignment\s*{/);
    expect(schema).toMatch(/weddingStaffAssignments\s+WeddingStaffAssignment\[\]/);
    expect(schema).toMatch(/weddingTimelineItems\s+WeddingTimelineItem\[\]/);
    expect(schema).toMatch(
      /mediaCue\s+String\?\s+@db\.VarChar\(500\)\s+@map\("media_cue"\)/,
    );
    expect(schema).toMatch(/@@unique\(\[id, workspaceId\]\)/);
    expect(schema).toMatch(
      /timelineItem\s+WeddingTimelineItem\s+@relation\([^\n]*fields:\s*\[timelineItemId, workspaceId\][^\n]*onDelete:\s*Cascade[^\n]*map:\s*"timeline_staff_timeline_ws_fkey"/,
    );
    expect(schema).toMatch(
      /staffAssignment\s+WeddingStaffAssignment\s+@relation\([^\n]*fields:\s*\[staffAssignmentId, workspaceId\][^\n]*onDelete:\s*Cascade[^\n]*map:\s*"timeline_staff_staff_ws_fkey"/,
    );
  });

  it("creates bounded checks, composite tenant foreign keys, cascades, and deterministic indexes", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain('CREATE TABLE "wedding_staff_assignments"');
    expect(migration).toContain('CREATE TABLE "wedding_timeline_items"');
    expect(migration).toContain('"media_cue" VARCHAR(500)');
    expect(migration).toContain(
      'CREATE TABLE "wedding_timeline_staff_assignments"',
    );
    expect(migration).toMatch(
      /"start_minute" BETWEEN 0 AND 1439[\s\S]*"end_minute" IS NULL[\s\S]*"end_minute" BETWEEN 0 AND 1439[\s\S]*"end_minute" > "start_minute"/,
    );
    expect(migration).toMatch(/char_length\("role_name"\) BETWEEN 1 AND 60/);
    expect(migration).toMatch(/char_length\("person_name"\) BETWEEN 1 AND 120/);
    expect(migration).toContain('"role_name" ~ \'[^[:space:]]\'');
    expect(migration).toContain(
      'left("phase", 1) !~ \'[[:space:]]\'',
    );
    expect(migration).toContain(
      'right("title", 1) !~ \'[[:space:]]\'',
    );
    expect(migration).toMatch(
      /CONSTRAINT "wedding_timeline_items_media_cue_check"[\s\S]*"media_cue" IS NULL OR \([\s\S]*char_length\("media_cue"\) BETWEEN 1 AND 500[\s\S]*"media_cue" ~ '\[\^\[:space:\]\]'[\s\S]*left\("media_cue", 1\) !~ '\[\[:space:\]\]'[\s\S]*right\("media_cue", 1\) !~ '\[\[:space:\]\]'/,
    );
    expect(migration).toMatch(/CHECK \("version" >= 0\)/);
    expect(migration).toMatch(
      /FOREIGN KEY \("timeline_item_id", "workspace_id"\)[\s\S]*REFERENCES "wedding_timeline_items"\("id", "workspace_id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("staff_assignment_id", "workspace_id"\)[\s\S]*REFERENCES "wedding_staff_assignments"\("id", "workspace_id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toContain('"timeline_staff_timeline_ws_fkey"');
    expect(migration).toContain('"timeline_staff_staff_ws_fkey"');
    expect(migration).not.toContain(
      '"wedding_timeline_staff_assignments_timeline_item_id_workspace_id_fkey"',
    );
    expect(migration).toContain(
      '"wedding_staff_assignments_ws_role_person_created_id_idx"',
    );
    expect(migration).toContain(
      '"wedding_timeline_items_ws_start_end_created_id_idx"',
    );
  });
});
