import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("authenticated app layout contract", () => {
  it("normalizes the rem baseline across browser default-font preferences", () => {
    expect(source("src/app/globals.css")).toMatch(
      /html\s*\{[^}]*font-size:\s*16px;/u,
    );
  });

  it("applies a saved appearance before hydration and keeps theme control global", () => {
    expect(source("src/app/layout.tsx")).toContain("THEME_BOOTSTRAP_SCRIPT");
    expect(source("src/app/layout.tsx")).toContain("ThemeController");
    expect(source("src/app/(app)/layout.tsx")).toContain("ThemeMenu");
  });

  it("keeps the viewport stable and aligns dashboard/workspace content to max-w-6xl", () => {
    expect(source("src/app/globals.css")).toMatch(
      /html\s*\{[^}]*scrollbar-gutter:\s*stable;/u,
    );
    expect(source("src/app/(app)/layout.tsx")).toContain("max-w-6xl");
    expect(source("src/app/(app)/dashboard/page.tsx")).toContain("max-w-6xl");
    for (const section of [
      "guests",
      "tables",
      "tasks",
      "budget",
      "staff",
      "timeline",
    ]) {
      expect(
        source(`src/app/(app)/workspaces/[workspaceId]/${section}/page.tsx`),
      ).toContain("max-w-6xl");
    }
  });
});
