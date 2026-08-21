import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const expectedLineinFailClosedMigrationBody = `
UPDATE "guest_rsvps" AS "guest_rsvps"
SET
  "source_party_size" = COALESCE(
    "guest_rsvps"."source_party_size",
    "guests"."party_size"
  ),
  "managed_fields" = array_remove(
    "guest_rsvps"."managed_fields",
    'PARTY_SIZE'::"GuestManagedField"
  ),
  "source_managed" = cardinality(
    array_remove(
      "guest_rsvps"."managed_fields",
      'PARTY_SIZE'::"GuestManagedField"
    )
  ) > 0,
  "updated_at" = CURRENT_TIMESTAMP
FROM "guests" AS "guests"
WHERE "guest_rsvps"."guest_id" = "guests"."id"
  AND "guest_rsvps"."workspace_id" = "guests"."workspace_id"
  AND "guest_rsvps"."source" = 'LINEIN'
  AND "guest_rsvps"."source_instance" = 'default'
  AND "guest_rsvps"."source_managed" = TRUE
  AND 'PARTY_SIZE'::"GuestManagedField" = ANY(
    "guest_rsvps"."managed_fields"
  );

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guest_rsvps_linein_default_no_party_size_check'
      AND conrelid = '"guest_rsvps"'::regclass
  ) THEN
    ALTER TABLE "guest_rsvps"
      ADD CONSTRAINT "guest_rsvps_linein_default_no_party_size_check"
      CHECK (
        "source" <> 'LINEIN'
        OR "source_instance" <> 'default'
        OR NOT (
          'PARTY_SIZE'::"GuestManagedField" = ANY("managed_fields")
        )
      ) NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE "guest_rsvps"
  VALIDATE CONSTRAINT "guest_rsvps_linein_default_no_party_size_check";
`;

function normalizeMigrationExecutableBody(migration: string) {
  return migration
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .filter((line) => !/^\s*--/u.test(line))
    .join("\n")
    .replace(/\s+/gu, " ")
    .trim();
}

function assertCompleteFailClosedMigrationContract(migration: string) {
  const normalizedMigration = normalizeMigrationExecutableBody(migration);
  const normalizedExpected = normalizeMigrationExecutableBody(
    expectedLineinFailClosedMigrationBody,
  );
  if (normalizedMigration !== normalizedExpected) {
    throw new Error(
      "Migration 17 executable SQL must exactly match the reviewed allowlist.",
    );
  }
}

describe("Guest RSVP schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const initialMigrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260722210000_linein_rsvp_import",
    "migration.sql",
  );
  const genericSourceMigrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260729222233_generic_guest_import_sources",
    "migration.sql",
  );
  const sourcePartySizeMigrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260802150000_guest_import_source_party_size",
    "migration.sql",
  );
  const lineinOwnershipMigrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260802151000_linein_party_size_ownership",
    "migration.sql",
  );
  const lineinFailClosedMigrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260802152000_linein_party_size_fail_closed",
    "migration.sql",
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  it("defines source-independent, workspace-scoped import provenance without raw JSON", () => {
    const guestModel = schema.match(/model Guest\s*{[\s\S]*?\n}/)?.[0] ?? "";
    const importModel =
      schema.match(/model GuestImportRecord\s*{[\s\S]*?\n}/)?.[0] ?? "";

    expect(schema).not.toMatch(/enum GuestRsvpSource/);
    expect(schema).toMatch(
      /enum InvitationDelivery\s*{[\s\S]*PAPER[\s\S]*DIGITAL[\s\S]*NONE[\s\S]*UNKNOWN/,
    );
    expect(guestModel).toMatch(/importRecords\s+GuestImportRecord\[\]/);
    expect(importModel).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
    expect(importModel).toMatch(/guestId\s+String\s+@map\("guest_id"\)/);
    expect(importModel).toMatch(/workspaceId\s+String\s+@map\("workspace_id"\)/);
    expect(importModel).toMatch(/source\s+String\s+@db\.VarChar\(64\)/);
    expect(importModel).toMatch(
      /sourceInstance\s+String[\s\S]*@map\("source_instance"\)/,
    );
    expect(importModel).toMatch(
      /sourceLabel\s+String\s+@db\.VarChar\(120\)\s+@map\("source_label"\)/,
    );
    expect(importModel).toMatch(
      /sourceManaged\s+Boolean\s+@default\(false\)\s+@map\("source_managed"\)/,
    );
    expect(importModel).toMatch(
      /managedFields\s+GuestManagedField\[\][\s\S]*@map\("managed_fields"\)/,
    );
    expect(importModel).toMatch(
      /sourcePartySize\s+Int\?\s+@map\("source_party_size"\)/,
    );
    expect(importModel).toMatch(
      /guest\s+Guest\s+@relation\([\s\S]*fields:\s*\[guestId, workspaceId\][\s\S]*references:\s*\[id, workspaceId\][\s\S]*onDelete:\s*Cascade/,
    );
    expect(importModel).toMatch(
      /@@unique\(\[workspaceId, source, sourceInstance, externalId\]/,
    );
    expect(importModel).not.toMatch(
      /@@unique\(\[guestId, workspaceId, source(?:, sourceInstance)?\]\)/,
    );
    expect(importModel).toMatch(
      /@@index\(\[workspaceId, sourceSubmittedAt, guestId\],\s*map:\s*"guest_rsvps_ws_submitted_guest_idx"\)/,
    );
    expect(importModel).not.toMatch(/Json|rawPayload|rawJson/u);
    expect(schema).toMatch(/model GuestImportBatch\s*{/);
    expect(schema).toMatch(/model GuestImportBatchRow\s*{/);
    expect(schema).toMatch(/mappingVersion\s+String/);
    expect(schema).toMatch(/retryOfBatchId\s+String\?/);
    expect(schema).toMatch(/errorCode\s+String\?/);
    expect(schema).toMatch(/attemptCount\s+Int/);
    expect(schema).toMatch(/externalId\s+String\s+@db\.VarChar\(191\)/);
    expect(schema).toMatch(/relationshipLabel\s+String\?\s+@db\.VarChar\(100\)/);
    expect(schema).toMatch(/contactPhone\s+String\?\s+@db\.VarChar\(40\)/);
    expect(schema).toMatch(/contactEmail\s+String\?\s+@db\.VarChar\(254\)/);
    expect(schema).toMatch(/childSeatCount\s+Int\?\s+@map\("child_seat_count"\)/);
    expect(schema).toMatch(/invitationDelivery\s+InvitationDelivery\?/);
    expect(schema).toMatch(/attendanceReply\s+String\?/);
    expect(schema).toMatch(/mailingAddress\s+String\?\s+@db\.VarChar\(500\)/);
    expect(schema).toMatch(/guestMessage\s+String\?\s+@db\.VarChar\(1000\)/);
    expect(schema).toMatch(/invitationReply\s+String\?\s+@db\.VarChar\(120\)/);
    expect(schema).toMatch(
      /sourceSubmittedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)\s+@map\("source_submitted_at"\)/,
    );
  });

  it("stores source party size as provenance and narrows only LINEIN/default ownership", () => {
    expect(fs.existsSync(sourcePartySizeMigrationPath)).toBe(true);
    expect(fs.existsSync(lineinOwnershipMigrationPath)).toBe(true);

    const sourcePartySizeMigration = fs.readFileSync(
      sourcePartySizeMigrationPath,
      "utf8",
    );
    const lineinOwnershipMigration = fs.readFileSync(
      lineinOwnershipMigrationPath,
      "utf8",
    );

    expect(sourcePartySizeMigration).toContain('ADD COLUMN "source_party_size" INTEGER');
    expect(sourcePartySizeMigration).toContain(
      'CONSTRAINT "guest_rsvps_source_party_size_check"',
    );
    expect(sourcePartySizeMigration).not.toMatch(/UPDATE "guest_rsvps"/u);

    expect(lineinOwnershipMigration).toMatch(
      /UPDATE "guest_rsvps"[\s\S]*array_remove\([\s\S]*'PARTY_SIZE'::"GuestManagedField"[\s\S]*"source" = 'LINEIN'[\s\S]*"source_instance" = 'default'[\s\S]*"source_managed" = TRUE/u,
    );
    expect(lineinOwnershipMigration).toMatch(
      /"source_party_size" = COALESCE\([\s\S]*"guest_rsvps"\."source_party_size"[\s\S]*"guests"\."party_size"/u,
    );
    expect(lineinOwnershipMigration).not.toMatch(
      /ALTER\s+(?:TABLE|TYPE)|DROP\s+(?:TABLE|TYPE)|CREATE\s+(?:TABLE|TYPE)/u,
    );
  });

  it("fails closed against stale LINEIN/default PARTY_SIZE writers with one narrow idempotent migration", () => {
    expect(fs.existsSync(lineinFailClosedMigrationPath)).toBe(true);
    const migration = fs.readFileSync(lineinFailClosedMigrationPath, "utf8");
    assertCompleteFailClosedMigrationContract(migration);
    const updateStatements = migration.match(/\bUPDATE\s+"[^"]+"/gu) ?? [];
    const updateStatement =
      migration.match(/UPDATE\s+"guest_rsvps"[\s\S]*?;/u)?.[0] ?? "";
    const setClause = updateStatement.match(/\bSET([\s\S]*?)\nFROM/u)?.[1] ?? "";
    const assignmentNames = Array.from(
      setClause.matchAll(/^\s*"([a-z_]+)"\s*=/gmu),
      (match) => match[1],
    );

    expect(updateStatements).toEqual(['UPDATE "guest_rsvps"']);
    expect(assignmentNames).toEqual([
      "source_party_size",
      "managed_fields",
      "source_managed",
      "updated_at",
    ]);
    expect(updateStatement).toMatch(
      /"source_party_size"\s*=\s*COALESCE\([\s\S]*"guest_rsvps"\."source_party_size"[\s\S]*"guests"\."party_size"/u,
    );
    expect(updateStatement).toMatch(
      /"managed_fields"\s*=\s*array_remove\([\s\S]*'PARTY_SIZE'::"GuestManagedField"/u,
    );
    expect(updateStatement).toMatch(
      /"source_managed"\s*=\s*cardinality\([\s\S]*array_remove\([\s\S]*'PARTY_SIZE'::"GuestManagedField"[\s\S]*\)\s*>\s*0/u,
    );
    expect(updateStatement).toMatch(/"updated_at"\s*=\s*CURRENT_TIMESTAMP/u);
    expect(updateStatement).toMatch(
      /WHERE[\s\S]*"guest_rsvps"\."source" = 'LINEIN'[\s\S]*"guest_rsvps"\."source_instance" = 'default'[\s\S]*"guest_rsvps"\."source_managed" = TRUE[\s\S]*'PARTY_SIZE'::"GuestManagedField" = ANY\([\s\S]*"guest_rsvps"\."managed_fields"[\s\S]*\)/u,
    );
    expect(migration).not.toMatch(
      /\b(?:DELETE|INSERT|TRUNCATE|MERGE)\b|UPDATE\s+"guests"|SET\s+"party_size"/iu,
    );
    expect(migration).toContain(
      'CONSTRAINT "guest_rsvps_linein_default_no_party_size_check"',
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "guest_rsvps_linein_default_no_party_size_check"[\s\S]*CHECK\s*\([\s\S]*"source" <> 'LINEIN'[\s\S]*"source_instance" <> 'default'[\s\S]*NOT\s*\(\s*'PARTY_SIZE'::"GuestManagedField" = ANY\("managed_fields"\)\s*\)[\s\S]*\)\s*NOT VALID/u,
    );
    expect(migration).toMatch(
      /IF NOT EXISTS[\s\S]*pg_constraint[\s\S]*guest_rsvps_linein_default_no_party_size_check/u,
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "guest_rsvps_linein_default_no_party_size_check"',
    );
  });

  it.each([
    [
      "quoted DML",
      'UPDATE "guests" SET "party_size" = 99 WHERE "id" = \'malicious\';',
    ],
    [
      "unquoted DML",
      'UPDATE guests SET party_size = 99 WHERE id = \'malicious\';',
    ],
    [
      "dynamic DML",
      "DO $$ BEGIN EXECUTE 'UPDATE guests SET party_size = 99'; END $$;",
    ],
    ["an arbitrary appended statement", "SELECT 1;"],
  ])("rejects appended %s outside the migration 17 allowlist", (_label, sql) => {
    const migration = fs.readFileSync(lineinFailClosedMigrationPath, "utf8");

    expect(() =>
      assertCompleteFailClosedMigrationContract(`${migration}\n${sql}\n`),
    ).toThrow();
  });

  it("allows comments and whitespace without weakening the executable SQL allowlist", () => {
    const migration = fs.readFileSync(lineinFailClosedMigrationPath, "utf8");

    expect(() =>
      assertCompleteFailClosedMigrationContract(
        `-- reviewed comment\n\n${migration}\n-- trailing comment\n`,
      ),
    ).not.toThrow();
  });

  it("keeps the original tenant identity and ships a lossless generic-source migration", () => {
    expect(fs.existsSync(initialMigrationPath)).toBe(true);
    expect(fs.existsSync(genericSourceMigrationPath)).toBe(true);
    const initialMigration = fs.readFileSync(initialMigrationPath, "utf8");
    const genericMigration = fs.readFileSync(genericSourceMigrationPath, "utf8");

    expect(initialMigration).toContain('CREATE TYPE "GuestRsvpSource"');
    expect(initialMigration).toContain('CREATE TYPE "InvitationDelivery"');
    expect(initialMigration).toContain('CREATE TABLE "guest_rsvps"');
    expect(initialMigration).toContain(
      'CREATE UNIQUE INDEX "guest_rsvps_guest_id_workspace_id_key"',
    );
    expect(initialMigration).toContain(
      'CREATE UNIQUE INDEX "guest_rsvps_workspace_id_source_external_id_key"',
    );
    expect(initialMigration).toContain(
      'CREATE INDEX "guest_rsvps_ws_submitted_guest_idx"',
    );
    expect(initialMigration).toMatch(
      /FOREIGN KEY \("guest_id", "workspace_id"\)[\s\S]*REFERENCES "guests"\("id", "workspace_id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(genericMigration).toMatch(/SET\s+"id" = "guest_id"/);
    expect(genericMigration).toMatch(
      /WHEN "source"::text = 'LINEIN' THEN '拍拍印'/,
    );
    expect(genericMigration).toMatch(/"source_managed" = TRUE/);
    expect(genericMigration).toMatch(
      /ALTER COLUMN "source" TYPE VARCHAR\(64\) USING "source"::text/,
    );
    expect(genericMigration).toContain('DROP TYPE "GuestRsvpSource"');
    expect(genericMigration).toContain('CONSTRAINT "guest_rsvps_source_check"');
    expect(genericMigration).toContain(
      'CONSTRAINT "guest_rsvps_source_label_check"',
    );
    expect(genericMigration).toContain(
      'CREATE UNIQUE INDEX "guest_rsvps_workspace_source_instance_external_id_key"',
    );
    expect(genericMigration).toContain(
      'CREATE UNIQUE INDEX "guest_rsvps_one_managed_owner_per_guest_key"',
    );
    expect(genericMigration).toContain('CREATE TABLE "guest_import_batches"');
    expect(genericMigration).toContain('CREATE TABLE "guest_import_batch_rows"');
    expect(genericMigration).toMatch(
      /ALTER COLUMN "relationship_label" DROP NOT NULL/,
    );
    expect(genericMigration).toMatch(
      /ALTER COLUMN "contact_phone" DROP NOT NULL/,
    );
    expect(genericMigration).toMatch(
      /ALTER COLUMN "child_seat_count" DROP NOT NULL/,
    );
    expect(genericMigration).toMatch(
      /ALTER COLUMN "vegetarian_count" DROP NOT NULL/,
    );
    expect(genericMigration).toMatch(
      /ALTER COLUMN "invitation_delivery" DROP NOT NULL/,
    );
    expect(genericMigration).toMatch(
      /ALTER COLUMN "attendance_reply" DROP NOT NULL/,
    );
    expect(genericMigration).toMatch(
      /ALTER COLUMN "source_submitted_at" DROP NOT NULL/,
    );
    expect(genericMigration).toMatch(
      /"invitation_delivery" IS NULL[\s\S]*"invitation_reply" IS NULL/,
    );
    expect(genericMigration).toContain(
      'DROP INDEX "guest_rsvps_workspace_id_source_external_id_key"',
    );
  });

  it("does not expose an npm alias that would echo privileged importer arguments", () => {
    expect(packageJson.scripts?.["import:linein-rsvp"]).toBeUndefined();
  });
});
