import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20260727220000_budget_attachments";

describe("BudgetAttachment Prisma and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    migrationName,
    "migration.sql",
  );

  it("models workspace, EXPENSE item, uploader, metadata, and bytea data", () => {
    expect(schema).toMatch(/budgetAttachments\s+BudgetAttachment\[\]/);
    expect(schema).toMatch(/uploadedBudgetAttachments\s+BudgetAttachment\[\]/);
    expect(schema).toMatch(/attachments\s+BudgetAttachment\[\]/);
    expect(schema).toMatch(/model BudgetAttachment\s*{/);
    expect(schema).toMatch(/workspaceId\s+String\s+@map\("workspace_id"\)/);
    expect(schema).toMatch(/budgetItemId\s+String\s+@map\("budget_item_id"\)/);
    expect(schema).toMatch(
      /originalName\s+String\s+@db\.VarChar\(200\)\s+@map\("original_name"\)/,
    );
    expect(schema).toMatch(/mediaType\s+String\s+@db\.VarChar\(30\)/);
    expect(schema).toMatch(/byteSize\s+Int\s+@map\("byte_size"\)/);
    expect(schema).toMatch(/sha256\s+String\s+@db\.Char\(64\)/);
    expect(schema).toMatch(/data\s+Bytes\s+@db\.ByteA/);
    expect(schema).toMatch(/uploadedByUserId\s+String/);
  });

  it("creates composite tenant FKs, uploader FK, cascade, checks, and indexes", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "budget_attachments"');
    expect(migration).toMatch(/"data"\s+BYTEA\s+NOT NULL/);
    expect(migration).toContain(
      'CONSTRAINT "budget_attachments_byte_size_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_attachments_data_length_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_attachments_sha256_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "budget_attachments_media_type_check"',
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("budget_item_id", "workspace_id"\)[\s\S]*REFERENCES "budget_items"\("id", "workspace_id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("workspace_id"\)[\s\S]*REFERENCES "wedding_workspaces"\("id"\)[\s\S]*ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("uploaded_by_user_id"\)[\s\S]*REFERENCES "users"\("id"\)[\s\S]*ON DELETE RESTRICT/,
    );
    expect(migration).toContain(
      'CREATE INDEX "budget_attachments_ws_item_created_id_idx"',
    );
    expect(migration).toContain("budget_attachment_expense_only");
    expect(migration).toMatch(
      /CREATE FUNCTION "budget_attachment_expense_only"[\s\S]*FROM "budget_items"[\s\S]*FOR SHARE/,
    );
  });
});
