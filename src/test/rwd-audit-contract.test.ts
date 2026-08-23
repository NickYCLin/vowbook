import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const audit = fs.readFileSync(
  path.join(process.cwd(), "scripts", "rwd-audit.mjs"),
  "utf8",
);

describe("RWD audit target contract", () => {
  it("does not mistake intentionally screen-reader-only form controls for visible touch targets", () => {
    expect(audit).toContain('element.classList.contains("sr-only")');
    expect(audit).toContain('element.type === "hidden"');
  });
});
