import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schema = fs.readFileSync(
  path.join(process.cwd(), "prisma", "schema.prisma"),
  "utf8",
);
const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260824004000_user_access_admin",
  "migration.sql",
);

describe("system user access schema", () => {
  it("keeps new accounts active while preserving reversible suspended and removed states", () => {
    const userModel = schema.match(/model User\s*{[\s\S]*?\n}/)?.[0] ?? "";

    expect(schema).toMatch(
      /enum UserAccessStatus\s*{[\s\S]*ACTIVE[\s\S]*SUSPENDED[\s\S]*REMOVED/,
    );
    expect(userModel).toMatch(
      /accessStatus\s+UserAccessStatus\s+@default\(ACTIVE\)\s+@map\("access_status"\)/,
    );
    expect(userModel).toMatch(
      /accessStatusChangedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)\s+@map\("access_status_changed_at"\)/,
    );
    expect(userModel).toMatch(
      /lastLoginAt\s+DateTime\?\s+@db\.Timestamptz\(3\)\s+@map\("last_login_at"\)/,
    );
    expect(userModel).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(userModel).toMatch(
      /@@index\(\[accessStatus, createdAt\],\s*map:\s*"users_access_status_created_at_idx"\)/,
    );
  });

  it("adds only fail-safe defaults and audit metadata without deleting users or memberships", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain('CREATE TYPE "UserAccessStatus"');
    expect(migration).toContain(
      'ADD COLUMN "access_status" "UserAccessStatus" NOT NULL DEFAULT \'ACTIVE\'',
    );
    expect(migration).toContain('ADD COLUMN "access_status_changed_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('ADD COLUMN "last_login_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('CREATE INDEX "users_access_status_created_at_idx"');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"users"/iu);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"memberships"/iu);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)/iu);
  });
});
