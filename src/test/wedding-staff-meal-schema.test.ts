import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("wedding staff meal schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260831010000_wedding_staff_meals",
      "migration.sql",
    ),
    "utf8",
  );

  it("stores an optional meal head count with its vegetarian share", () => {
    expect(schema).toMatch(/mealCount\s+Int\?\s+@map\("meal_count"\)/);
    expect(schema).toMatch(
      /vegetarianMealCount\s+Int\?\s+@map\("vegetarian_meal_count"\)/,
    );
    expect(migration).toContain('ADD COLUMN "meal_count" INTEGER');
    expect(migration).toContain('ADD COLUMN "vegetarian_meal_count" INTEGER');
  });

  it("keeps the two columns paired and the vegetarian share inside the head count", () => {
    expect(migration).toMatch(
      /"wedding_staff_assignments_meal_pairing_check" CHECK \(\s*\("meal_count" IS NULL\) = \("vegetarian_meal_count" IS NULL\)\s*\)/,
    );
    expect(migration).toMatch(
      /"wedding_staff_assignments_meal_count_check" CHECK \([\s\S]*"meal_count" BETWEEN 1 AND 99[\s\S]*\)/,
    );
    expect(migration).toMatch(
      /"wedding_staff_assignments_vegetarian_meal_count_check" CHECK \([\s\S]*"vegetarian_meal_count" >= 0[\s\S]*"vegetarian_meal_count" <= "meal_count"[\s\S]*\)/,
    );
  });

  it("tracks the red envelope handed out at the end of the wedding", () => {
    const returnMigration = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        "20260901000000_wedding_staff_red_envelopes",
        "migration.sql",
      ),
      "utf8",
    );

    expect(schema).toMatch(
      /redEnvelopeAmount\s+Int\?\s+@map\("red_envelope_amount"\)/,
    );
    expect(schema).toMatch(
      /redEnvelopeSentAt\s+DateTime\?\s+@map\("red_envelope_sent_at"\)/,
    );
    expect(returnMigration).toContain(
      'ADD COLUMN "red_envelope_amount" INTEGER',
    );
    expect(returnMigration).toContain(
      'ADD COLUMN "red_envelope_sent_at" TIMESTAMP(3)',
    );
    expect(returnMigration).toMatch(
      /"wedding_staff_assignments_red_envelope_amount_check" CHECK \([\s\S]*"red_envelope_amount" > 0[\s\S]*\)/,
    );
    // 沒有金額就沒有紅包可發。
    expect(returnMigration).toMatch(
      /"wedding_staff_assignments_red_envelope_sent_check" CHECK \([\s\S]*"red_envelope_sent_at" IS NULL OR "red_envelope_amount" IS NOT NULL[\s\S]*\)/,
    );
    expect(returnMigration).not.toMatch(
      /UPDATE\s+"wedding_staff_assignments"/iu,
    );
    expect(returnMigration).not.toMatch(/DEFAULT/iu);
  });

  it("adds the ceremony-neutral staff red envelope taxonomy item for every workspace", () => {
    const taxonomyMigration = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        "20260901010000_budget_staff_red_envelopes",
        "migration.sql",
      ),
      "utf8",
    );

    expect(taxonomyMigration).toContain("'ITEM_STAFF_RED_ENVELOPES'");
    expect(taxonomyMigration).toContain("'STAGE_COUNTDOWN_2_MONTHS'");
    // 每個既有 workspace 都要補上，缺一個花費頁就整頁讀不到資料。
    expect(taxonomyMigration).toMatch(
      /FROM "budget_items" AS stage[\s\S]*WHERE stage\."system_taxonomy_key" = 'STAGE_COUNTDOWN_2_MONTHS'/,
    );
    // 重跑不得重複插入。
    expect(taxonomyMigration).toMatch(
      /NOT EXISTS \([\s\S]*existing\."system_taxonomy_key" = 'ITEM_STAFF_RED_ENVELOPES'[\s\S]*\)/,
    );
    expect(taxonomyMigration).not.toMatch(/DELETE\s+FROM/iu);
    expect(taxonomyMigration).not.toMatch(/UPDATE\s+"budget_items"/iu);
  });

  it("adds no meal requirement to anyone who already exists", () => {
    expect(migration).not.toMatch(/UPDATE\s+"wedding_staff_assignments"/iu);
    expect(migration).not.toMatch(/DEFAULT\s+\d/u);
    expect(migration).not.toMatch(/NOT\s+NULL/iu);
  });
});
