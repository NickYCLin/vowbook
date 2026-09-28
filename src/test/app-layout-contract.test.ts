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

  it("keeps the form-control reset inside the base layer so utilities can override it", () => {
    const css = source("src/app/globals.css");
    const reset = css.indexOf("color: inherit;");
    expect(reset).toBeGreaterThan(-1);
    const before = css.slice(0, reset);
    const openedLayer = before.lastIndexOf("@layer base {");
    expect(openedLayer).toBeGreaterThan(-1);
    // 同一個 layer 區塊還沒關閉：中間的大括號要保持未平衡。
    const between = before.slice(openedLayer);
    const opens = between.split("{").length - 1;
    const closes = between.split("}").length - 1;
    expect(opens).toBeGreaterThan(closes + 1);
  });

  it("applies a saved appearance before hydration and keeps theme control global", () => {
    expect(source("src/app/layout.tsx")).toContain("THEME_BOOTSTRAP_SCRIPT");
    expect(source("src/app/layout.tsx")).toContain("ThemeController");
    expect(source("src/app/(app)/layout.tsx")).toContain("ThemeMenu");
  });

  it("keeps the viewport stable and separates the workspace layout from page content", () => {
    expect(source("src/app/globals.css")).toMatch(
      /html\s*\{[^}]*scrollbar-gutter:\s*stable;/u,
    );
    expect(source("src/app/(app)/workspaces/[workspaceId]/layout.tsx")).toContain("WorkspaceLayoutClient");
    expect(source("src/components/workspaces/workspace-frame.tsx")).toContain("WorkspaceViewStateProvider");
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
