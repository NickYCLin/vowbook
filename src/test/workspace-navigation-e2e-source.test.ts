import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "e2e", "authenticated-layout-static.spec.ts"),
  "utf8",
);

describe("authenticated navigation E2E production-helper contract", () => {
  it("transpiles and executes the production navigation helper without a fixture scroll implementation", () => {
    expect(source).toContain("src/lib/workspace-navigation.ts");
    expect(source).toContain("__revealActiveWorkspaceNavigationItem");
    expect(source).not.toContain("scrollIntoView");
  });

  it("measures a full 254-character renewable invitation label at 390px", () => {
    expect(source).toContain('"r".repeat(242)');
    expect(source).toContain('data-collaboration-overflow="renewable-label"');
    expect(source).toContain("scrollWidth");
    expect(source).toContain("clientWidth");
  });
});
