import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("budget preparation status schema contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260829210000_budget_preparation_status",
    "migration.sql",
  );

  it("keeps preparation decisions independent from booking and payment", () => {
    expect(schema).toMatch(
      /enum BudgetPreparationStatus\s*\{[\s\S]*?NEEDS_ACTION\s+ALREADY_OWNED\s+NOT_PLANNED\s*\}/u,
    );
    expect(schema).toMatch(
      /preparationStatus\s+BudgetPreparationStatus\s+@default\(NEEDS_ACTION\)\s+@map\("preparation_status"\)/u,
    );
    expect(schema).toMatch(
      /@@index\(\[workspaceId, preparationStatus, bookingStatus, dueDate, createdAt, id\],[\s\S]*budget_items_ws_preparation_booking_due_created_id_idx/u,
    );
  });

  it("adds a safe default, restricts groups, and indexes workspace decisions", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      'CREATE TYPE "BudgetPreparationStatus" AS ENUM (\'NEEDS_ACTION\', \'ALREADY_OWNED\', \'NOT_PLANNED\')',
    );
    expect(migration).toMatch(
      /ADD COLUMN "preparation_status" "BudgetPreparationStatus" NOT NULL DEFAULT 'NEEDS_ACTION'/u,
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_items_preparation_status_kind_check"',
    );
    expect(migration).toMatch(
      /"kind" = 'EXPENSE'::"BudgetItemKind"[\s\S]*"preparation_status" = 'NEEDS_ACTION'::"BudgetPreparationStatus"/u,
    );
    expect(migration).toContain(
      'CREATE INDEX "budget_items_ws_preparation_booking_due_created_id_idx"',
    );
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/iu);
  });
});
