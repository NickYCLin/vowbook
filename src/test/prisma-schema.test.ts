import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Prisma schema contract", () => {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");

  it("defines the required tenant-owned models and role enum", () => {
    const schema = fs.readFileSync(schemaPath, "utf8");

    expect(schema).toMatch(/model User\s*{/);
    expect(schema).toMatch(/googleSubject\s+String\s+@unique/);
    expect(schema).toMatch(/model WeddingWorkspace\s*{/);
    expect(schema).toMatch(/model Membership\s*{/);
    expect(schema).toMatch(/@@unique\(\[workspaceId, userId\]\)/);
    expect(schema).toMatch(/enum MembershipRole\s*{/);
  });

  it("stores one private custom avatar per user with bounded binary data", () => {
    const schema = fs.readFileSync(schemaPath, "utf8");
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        "20260823153000_user_profile_avatar",
        "migration.sql",
      ),
      "utf8",
    );

    expect(schema).toMatch(/model UserAvatar\s*\{/u);
    expect(schema).toMatch(/userId\s+String\s+@id\s+@map\("user_id"\)/u);
    expect(schema).toMatch(/user\s+User\s+@relation\([^\n]*onDelete:\s*Cascade/u);
    expect(migration).toContain('CREATE TABLE "user_avatars"');
    expect(migration).toContain('PRIMARY KEY ("user_id")');
    expect(migration).toContain('CHECK ("media_type" = \'image/webp\')');
    expect(migration).toMatch(/"byte_size" BETWEEN 1 AND 1048576/u);
    expect(migration).toContain('octet_length("data") = "byte_size"');
    expect(migration).toContain(
      '"sha256" = encode(sha256("data"), \'hex\')',
    );
    expect(migration).toContain("convert_to('WEBP', 'UTF8')");
    expect(migration).toMatch(/FOREIGN KEY \("user_id"\)[\s\S]*ON DELETE CASCADE/u);
  });

  it("cascades workspace memberships without cascading workspace ownership", () => {
    const schema = fs.readFileSync(schemaPath, "utf8");

    expect(schema).toMatch(
      /workspace\s+WeddingWorkspace\s+@relation\([^\n]*onDelete:\s*Cascade/,
    );
    expect(schema).toMatch(
      /createdBy\s+User\s+@relation\([^\n]*onDelete:\s*Restrict/,
    );
  });

  it("defines workspace-owned guests with explicit side and attendance enums", () => {
    const schema = fs.readFileSync(schemaPath, "utf8");

    expect(schema).toMatch(/enum GuestSide\s*{[\s\S]*PARTNER_A[\s\S]*PARTNER_B[\s\S]*SHARED/);
    expect(schema).toMatch(/enum GuestAttendanceStatus\s*{[\s\S]*UNDECIDED[\s\S]*ATTENDING[\s\S]*DECLINED/);
    expect(schema).toMatch(/enum GuestCategory\s*{[\s\S]*GUEST[\s\S]*COUPLE[\s\S]*FAMILY/);
    expect(schema).toMatch(/model Guest\s*{/);
    expect(schema).toMatch(/workspaceId\s+String\s+@map\("workspace_id"\)/);
    expect(schema).toMatch(/partySize\s+Int\s+@default\(1\)/);
    expect(schema).toMatch(/category\s+GuestCategory\s+@default\(GUEST\)/);
    expect(schema).toMatch(/notes\s+String\?/);
    expect(schema).toMatch(/@@index\(\[workspaceId\]\)/);
    expect(schema).toMatch(
      /workspace\s+WeddingWorkspace\s+@relation\([^\n]*onDelete:\s*Cascade/,
    );
  });

  it("ships a backwards-compatible roster-category migration", () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        "20260822120000_guest_roster_categories",
        "migration.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      `CREATE TYPE "GuestCategory" AS ENUM ('GUEST', 'COUPLE', 'FAMILY')`,
    );
    expect(migration).toMatch(
      /ADD COLUMN "category" "GuestCategory" NOT NULL DEFAULT 'GUEST'/u,
    );
    expect(migration).toContain(`CONSTRAINT "guests_roster_category_check"`);
    expect(migration).toMatch(/"category" = 'GUEST'[\s\S]*"party_size" = 1/u);
    expect(migration).toContain(`"guests_workspace_couple_side_key"`);
    expect(migration).toMatch(/WHERE "category" = 'COUPLE'/u);
  });

  it("ships a production migration for the guest table without applying it", () => {
    const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
    const guestMigration = fs
      .readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.includes("guest"))
      .map((entry) =>
        fs.readFileSync(path.join(migrationsPath, entry.name, "migration.sql"), "utf8"),
      )
      .join("\n");

    expect(guestMigration).toContain('CREATE TYPE "GuestSide"');
    expect(guestMigration).toContain('CREATE TYPE "GuestAttendanceStatus"');
    expect(guestMigration).toContain('CREATE TABLE "guests"');
    expect(guestMigration).toMatch(
      /FOREIGN KEY \("workspace_id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(guestMigration).toContain(
      'CREATE INDEX "guests_workspace_id_idx" ON "guests"("workspace_id")',
    );
    expect(guestMigration).toContain('CONSTRAINT "guests_name_length_check"');
    expect(guestMigration).toContain('CONSTRAINT "guests_party_size_check"');
    expect(guestMigration).toContain('CONSTRAINT "guests_notes_length_check"');
    expect(guestMigration).toMatch(/btrim\("name"\)[\s\S]*BETWEEN 1 AND 80/);
    expect(guestMigration).toMatch(/"party_size" BETWEEN 1 AND 20/);
    expect(guestMigration).toMatch(/char_length\("notes"\) <= 500/);
  });
});
