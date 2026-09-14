import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("guest check-in schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260831000000_guest_check_ins",
      "migration.sql",
    ),
    "utf8",
  );

  it("stores at most one arrival record per invitation group with a CAS token", () => {
    expect(schema).toMatch(/model GuestCheckIn\s*{/);
    expect(schema).toMatch(/headcount\s+Int/);
    expect(schema).toMatch(/notes\s+String\?\s+@db\.VarChar\(200\)/);
    expect(schema).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/@@map\("guest_check_ins"\)/);
    expect(schema).toMatch(/checkIn\s+GuestCheckIn\?/);
    expect(schema).toMatch(/guestCheckIns\s+GuestCheckIn\[\]/);

    expect(migration).toContain('CREATE TABLE "guest_check_ins"');
    expect(migration).toContain('CHECK ("headcount" BETWEEN 1 AND 20)');
    expect(migration).toContain('CHECK ("version" >= 0)');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "guest_check_ins_guest_id_workspace_id_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "guest_check_ins_id_workspace_id_key"',
    );
    expect(migration).toMatch(
      /CONSTRAINT "guest_check_ins_notes_check" CHECK \([\s\S]*"notes" IS NULL[\s\S]*"notes" = btrim\("notes"\)[\s\S]*char_length\("notes"\) BETWEEN 1 AND 200[\s\S]*"notes" ~ '\[\^\[:space:\]\]'[\s\S]*\)/,
    );
  });

  it("rejects a guest from another workspace at the database boundary", () => {
    expect(schema).toMatch(
      /guest\s+Guest\s+@relation\([^\n]*fields:\s*\[guestId, workspaceId\][^\n]*references:\s*\[id, workspaceId\][^\n]*onDelete:\s*Cascade[^\n]*onUpdate:\s*Cascade[^\n]*map:\s*"guest_check_ins_guest_ws_fkey"/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "guest_check_ins_workspace_id_fkey"[\s\S]*FOREIGN KEY \("workspace_id"\)[\s\S]*REFERENCES "wedding_workspaces"\("id"\)[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "guest_check_ins_guest_ws_fkey"[\s\S]*FOREIGN KEY \("guest_id", "workspace_id"\)[\s\S]*REFERENCES "guests"\("id", "workspace_id"\)[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
  });

  it("never rewrites the RSVP answer it sits beside and backfills no arrivals", () => {
    expect(migration).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(?:guest_check_ins|guests)"/iu,
    );
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+"guests"/iu);

    const checkInModel =
      schema.match(/model GuestCheckIn\s*{[\s\S]*?\n}/)?.[0] ?? "";
    expect(checkInModel).not.toMatch(/attendanceStatus|partySize/);
  });
});
