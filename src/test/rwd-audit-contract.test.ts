import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const audit = fs.readFileSync(
  path.join(process.cwd(), "scripts", "rwd-audit.mjs"),
  "utf8",
);

describe("RWD audit target contract", () => {
  it("renders the real landing without evaluating OAuth configuration", () => {
    const fixtures = fs.readFileSync(path.join(process.cwd(), "scripts/rwd-fixtures.tsx"), "utf8");
    expect(fixtures).toContain('import { HomeLanding } from "@/app/page"');
    expect(fixtures).toContain("element: <HomeLanding />");
    expect(audit).toContain('normalized.endsWith("/src/auth.ts")');
  });

  it("allows a bounded native parity reference audit without silently accepting unknown surfaces", () => {
    expect(audit).toContain('argument.startsWith("--surface=")');
    expect(audit).toContain('throw new Error("Unknown RWD audit surface")');
    expect(fs.readFileSync(path.join(process.cwd(), "scripts/rwd-ui-screenshots.mjs"), "utf8")).toContain('await page.route("**/*", (route) => route.abort())');
  });
  it("does not mistake intentionally screen-reader-only form controls for visible touch targets", () => {
    expect(audit).toContain('element.classList.contains("sr-only")');
    expect(audit).toContain('element.type === "hidden"');
  });
});
