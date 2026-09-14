import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("wedding ceremony guest attendance schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260830010000_wedding_ceremony_guest_attendance",
      "migration.sql",
    ),
    "utf8",
  );

  it("defines an event-scoped attendance row with an independent CAS token", () => {
    expect(schema).toMatch(
      /enum WeddingCeremonyAttendanceStatus\s*{[\s\S]*NOT_INCLUDED[\s\S]*UNDECIDED[\s\S]*ATTENDING[\s\S]*DECLINED[\s\S]*}/,
    );
    expect(schema).toMatch(/model WeddingCeremonyGuestAttendance\s*{/);
    expect(schema).toMatch(
      /status\s+WeddingCeremonyAttendanceStatus\s+@default\(UNDECIDED\)/,
    );
    expect(schema).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/@@id\(\[ceremonyId, guestId, workspaceId\]\)/);
    expect(schema).toMatch(
      /@@index\(\[workspaceId, ceremonyId, status, guestId\],\s*map:\s*"ceremony_guest_attendance_ws_ceremony_status_guest_idx"\)/,
    );
    expect(schema).toMatch(
      /@@index\(\[workspaceId, guestId, ceremonyId\],\s*map:\s*"ceremony_guest_attendance_ws_guest_ceremony_idx"\)/,
    );
    expect(schema).toMatch(
      /@@map\("wedding_ceremony_guest_attendances"\)/,
    );
    expect(migration).toContain('CHECK ("version" >= 0)');
    expect(migration).toMatch(
      /CREATE TYPE "WeddingCeremonyAttendanceStatus" AS ENUM \([\s\S]*'NOT_INCLUDED'[\s\S]*'UNDECIDED'[\s\S]*'ATTENDING'[\s\S]*'DECLINED'[\s\S]*\)/,
    );
    expect(migration).toContain(
      '"status" "WeddingCeremonyAttendanceStatus" NOT NULL DEFAULT \'UNDECIDED\'',
    );
  });

  it("owns every row through workspace plus composite ceremony and guest foreign keys", () => {
    expect(schema).toMatch(
      /ceremony\s+WeddingCeremony\s+@relation\([^\n]*fields:\s*\[ceremonyId, workspaceId\][^\n]*references:\s*\[id, workspaceId\][^\n]*onDelete:\s*Cascade[^\n]*map:\s*"ceremony_guest_attendance_ceremony_ws_fkey"/,
    );
    expect(schema).toMatch(
      /guest\s+Guest\s+@relation\([^\n]*fields:\s*\[guestId, workspaceId\][^\n]*references:\s*\[id, workspaceId\][^\n]*onDelete:\s*Cascade[^\n]*map:\s*"ceremony_guest_attendance_guest_ws_fkey"/,
    );
    expect(schema).toMatch(
      /workspace\s+WeddingWorkspace\s+@relation\([^\n]*fields:\s*\[workspaceId\][^\n]*references:\s*\[id\][^\n]*onDelete:\s*Cascade/,
    );
    expect(schema).toMatch(/ceremonyGuestAttendances\s+WeddingCeremonyGuestAttendance\[\]/);
    expect(schema).toMatch(/ceremonyAttendances\s+WeddingCeremonyGuestAttendance\[\]/);
    expect(schema).toMatch(/guestAttendances\s+WeddingCeremonyGuestAttendance\[\]/);

    expect(migration).toMatch(
      /CONSTRAINT "ceremony_guest_attendance_ceremony_ws_fkey"[\s\S]*FOREIGN KEY \("ceremony_id", "workspace_id"\)[\s\S]*REFERENCES "wedding_ceremonies"\("id", "workspace_id"\)[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "ceremony_guest_attendance_guest_ws_fkey"[\s\S]*FOREIGN KEY \("guest_id", "workspace_id"\)[\s\S]*REFERENCES "guests"\("id", "workspace_id"\)[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "wedding_ceremony_guest_attendances_workspace_id_fkey"[\s\S]*FOREIGN KEY \("workspace_id"\)[\s\S]*REFERENCES "wedding_workspaces"\("id"\)[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
  });

  it("creates an empty compatibility layer without changing the legacy RSVP column", () => {
    expect(migration).toContain(
      'CREATE TABLE "wedding_ceremony_guest_attendances"',
    );
    expect(migration).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(?:wedding_ceremony_guest_attendances|guest_rsvps|guests|wedding_ceremonies)"/iu,
    );
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+"guest_rsvps"/iu);
    expect(schema).toMatch(
      /ceremonyAttendance\s+Boolean\?\s+@map\("ceremony_attendance"\)/,
    );
  });
});
