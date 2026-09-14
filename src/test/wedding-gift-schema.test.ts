import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("wedding gift schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260830030000_wedding_gifts",
      "migration.sql",
    ),
    "utf8",
  );

  it("stores one independent gift record per invitation group with a CAS token", () => {
    expect(schema).toMatch(/model WeddingGift\s*{/);
    expect(schema).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
    expect(schema).toMatch(/amount\s+Int/);
    expect(schema).toMatch(/notes\s+String\?\s+@db\.VarChar\(500\)/);
    expect(schema).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/@@unique\(\[id, workspaceId\]\)/);
    expect(schema).toMatch(/@@unique\(\[guestId, workspaceId\]\)/);
    expect(schema).toMatch(/@@map\("wedding_gifts"\)/);
    expect(schema).toMatch(/weddingGift\s+WeddingGift\?/);
    expect(schema).toMatch(/weddingGifts\s+WeddingGift\[\]/);

    expect(migration).toContain('CREATE TABLE "wedding_gifts"');
    expect(migration).toContain('CHECK ("amount" > 0)');
    expect(migration).toContain('CHECK ("version" >= 0)');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "wedding_gifts_id_workspace_id_key"',
    );
    expect(migration).toMatch(
      /CONSTRAINT "wedding_gifts_notes_check" CHECK \([\s\S]*"notes" IS NULL[\s\S]*"notes" = btrim\("notes"\)[\s\S]*char_length\("notes"\) BETWEEN 1 AND 500[\s\S]*"notes" ~ '\[\^\[:space:\]\]'[\s\S]*\)/,
    );
  });

  it("owns each record directly and rejects a guest from another workspace at the database boundary", () => {
    expect(schema).toMatch(
      /workspace\s+WeddingWorkspace\s+@relation\([^\n]*fields:\s*\[workspaceId\][^\n]*references:\s*\[id\][^\n]*onDelete:\s*Cascade[^\n]*onUpdate:\s*Cascade/,
    );
    expect(schema).toMatch(
      /guest\s+Guest\s+@relation\([^\n]*fields:\s*\[guestId, workspaceId\][^\n]*references:\s*\[id, workspaceId\][^\n]*onDelete:\s*Cascade[^\n]*onUpdate:\s*Cascade[^\n]*map:\s*"wedding_gifts_guest_ws_fkey"/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "wedding_gifts_workspace_id_fkey"[\s\S]*FOREIGN KEY \("workspace_id"\)[\s\S]*REFERENCES "wedding_workspaces"\("id"\)[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT "wedding_gifts_guest_ws_fkey"[\s\S]*FOREIGN KEY \("guest_id", "workspace_id"\)[\s\S]*REFERENCES "guests"\("id", "workspace_id"\)[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
  });

  it("tracks the return gift for guests who never showed up", () => {
    const returnMigration = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        "20260831020000_wedding_gift_returns",
        "migration.sql",
      ),
      "utf8",
    );

    expect(schema).toMatch(
      /returnGiftSentAt\s+DateTime\?\s+@map\("return_gift_sent_at"\)/,
    );
    expect(schema).toMatch(
      /returnGiftNote\s+String\?\s+@db\.VarChar\(200\)\s+@map\("return_gift_note"\)/,
    );
    expect(returnMigration).toContain(
      'ADD COLUMN "return_gift_sent_at" TIMESTAMP(3)',
    );
    expect(returnMigration).toContain(
      'ADD COLUMN "return_gift_note" VARCHAR(200)',
    );
    expect(returnMigration).toMatch(
      /"wedding_gifts_return_gift_note_check" CHECK \([\s\S]*"return_gift_note" IS NULL[\s\S]*btrim\("return_gift_note"\)[\s\S]*char_length\("return_gift_note"\) BETWEEN 1 AND 200[\s\S]*\)/,
    );
    // 既有禮金不得被推定為已回禮。
    expect(returnMigration).not.toMatch(/UPDATE\s+"wedding_gifts"/iu);
    expect(returnMigration).not.toMatch(/DEFAULT/iu);
    expect(returnMigration).not.toMatch(/NOT\s+NULL/iu);
  });

  it("is separate from Budget and creates no inferred or migrated gift rows", () => {
    expect(migration).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(?:wedding_gifts|budget_items|guests)"/iu,
    );
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+"budget_items"/iu);

    const giftModel = schema.match(/model WeddingGift\s*{[\s\S]*?\n}/)?.[0] ?? "";
    const budgetModel = schema.match(/model BudgetItem\s*{[\s\S]*?\n}/)?.[0] ?? "";
    expect(giftModel).not.toMatch(/BudgetItem|plannedAmount|actualAmount/);
    expect(budgetModel).not.toMatch(/WeddingGift|weddingGift/);
  });
});
