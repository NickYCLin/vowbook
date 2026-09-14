import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    root,
    "prisma/migrations/20260830040000_wedding_planning_preferences/migration.sql",
  ),
  "utf8",
);

describe("wedding planning preference schema", () => {
  it("keeps Chinese ceremony suggestions opt-in and workspace-owned", () => {
    expect(schema).toMatch(
      /hasEngagementCeremony\s+Boolean\s+@default\(false\)\s+@map\("has_engagement_ceremony"\)/,
    );
    expect(schema).toMatch(
      /hasProcessionCeremony\s+Boolean\s+@default\(false\)\s+@map\("has_procession_ceremony"\)/,
    );
    expect(schema).toMatch(
      /ceremonyPreferencesVersion\s+Int\s+@default\(0\)\s+@map\("ceremony_preferences_version"\)/,
    );
    expect(migration).toContain(
      'ADD COLUMN "has_engagement_ceremony" BOOLEAN NOT NULL DEFAULT false',
    );
    expect(migration).toContain(
      'ADD COLUMN "has_procession_ceremony" BOOLEAN NOT NULL DEFAULT false',
    );
    expect(migration).toContain(
      'ADD COLUMN "ceremony_preferences_version" INTEGER NOT NULL DEFAULT 0',
    );
    expect(migration).toContain('wc."type" = \'ENGAGEMENT\'');
    expect(migration).toContain('wc."type" = \'PROCESSION\'');
  });

  it("preserves every ceremony and attendance row", () => {
    expect(migration).not.toMatch(
      /(?:DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)[\s\S]*?(?:wedding_ceremonies|wedding_ceremony_guest_attendances)/iu,
    );
    expect(migration).toContain(
      'CHECK ("ceremony_preferences_version" >= 0)',
    );
  });
});
