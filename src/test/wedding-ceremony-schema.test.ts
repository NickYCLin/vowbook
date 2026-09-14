import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("wedding ceremony schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260830000000_wedding_ceremonies",
      "migration.sql",
    ),
    "utf8",
  );

  it("defines optional workspace-owned ceremonies without seed or backfill", () => {
    expect(schema).toMatch(
      /enum WeddingCeremonyType\s*{[\s\S]*WESTERN_CEREMONY[\s\S]*ENGAGEMENT[\s\S]*PROCESSION[\s\S]*RECEPTION[\s\S]*CUSTOM/,
    );
    expect(schema).toMatch(/ceremonies\s+WeddingCeremony\[\]/);
    expect(schema).toMatch(/model WeddingCeremony\s*{/);
    expect(schema).toMatch(/@@unique\(\[id, workspaceId\]\)/);
    expect(schema).toMatch(
      /@@index\(\[workspaceId, eventDate, startMinute, createdAt, id\],\s*map:\s*"wedding_ceremonies_ws_date_start_created_id_idx"\)/,
    );
    expect(schema).toMatch(/@@map\("wedding_ceremonies"\)/);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"wedding_ceremonies"/iu);
    expect(migration).not.toMatch(/UPDATE\s+"(?:guests|budget_items|wedding_timeline_items)"/iu);
  });

  it("enforces bounded fields, tenant ownership, time range, and one standard type", () => {
    expect(migration).toContain('CREATE TYPE "WeddingCeremonyType"');
    expect(migration).toContain('CREATE TABLE "wedding_ceremonies"');
    expect(migration).toMatch(
      /"name" = btrim\("name"\)[\s\S]*char_length\("name"\) BETWEEN 1 AND 120/,
    );
    expect(migration).toContain(
      'CHECK ("start_minute" IS NULL OR "start_minute" BETWEEN 0 AND 1439)',
    );
    expect(migration).toContain('CHECK ("version" >= 0)');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "wedding_ceremonies_standard_type_unique"',
    );
    expect(migration).toContain("WHERE \"type\" <> 'CUSTOM'");
    expect(migration).toMatch(
      /CONSTRAINT "wedding_ceremonies_workspace_id_fkey"[\s\S]*FOREIGN KEY \("workspace_id"\)[\s\S]*REFERENCES "wedding_workspaces"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
  });
});
