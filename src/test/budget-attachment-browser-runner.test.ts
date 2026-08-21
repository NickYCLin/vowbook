import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const runner = readFileSync(
  path.join(
    process.cwd(),
    "scripts",
    "budget-attachment-browser-command.mjs",
  ),
  "utf8",
);

describe("Budget attachment browser runner", () => {
  it("requires a disposable localhost test database and never falls back", () => {
    expect(runner).toContain("const rawTestDatabaseUrl = process.env.TEST_DATABASE_URL");
    expect(runner).toContain("if (!rawTestDatabaseUrl)");
    expect(runner).toContain('"localhost", "127.0.0.1", "[::1]", "::1"');
    expect(runner).toContain("!/test/iu.test(databaseName)");
    expect(runner).not.toContain("process.env.DATABASE_URL;");
  });

  it("uses a random schema, targeted attachment spec, and unconditional cleanup", () => {
    expect(runner).toContain("vowbook_attachment_e2e_${runId}");
    expect(runner).toContain('"e2e/budget-attachments.spec.ts"');
    expect(runner).toContain('"--workers=1"');
    expect(runner).toContain('VOWBOOK_ATTACHMENT_E2E: "1"');
    expect(runner).toContain('VOWBOOK_E2E_HEADED: "1"');
    expect(runner).toContain('"xvfb-run"');
    expect(runner).toMatch(/finally \{\n  await dropSchema\(\);\n\}/u);
    expect(runner).toContain('DROP SCHEMA IF EXISTS "${schemaName}" CASCADE');
  });

  it("seeds the full taxonomy and attaches the custom group below a fixed item", () => {
    expect(runner).toContain(
      'import { createBudgetTaxonomyFixture } from "./budget-taxonomy-fixture.mjs"',
    );
    expect(runner).toContain("await createBudgetTaxonomyFixture(");
    expect(runner).toContain(
      'taxonomyNodeIds.get("ITEM_WEDDING_VENUE")',
    );
    expect(runner).toContain("parentId: venueItemId");
  });
});
