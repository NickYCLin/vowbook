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

  it("centers every edit dialog as a card over the shared frosted backdrop", () => {
    const css = source("src/app/globals.css");
    expect(css).not.toContain('data-dialog-presentation="panel"');
    expect(css).toMatch(/dialog::backdrop\s*\{[^}]*backdrop-filter:\s*blur\(/u);
    for (const file of [
      "src/components/ui/dialog.tsx",
      "src/components/budget/budget-forms.tsx",
      "src/components/budget/budget-list.tsx",
      "src/components/budget/budget-group-forms.tsx",
      "src/components/budget/budget-engagement-preset.tsx",
      "src/components/budget/budget-preparation-preset.tsx",
      "src/components/timeline/timeline-forms.tsx",
      "src/components/workspaces/workspace-owner-controls.tsx",
    ]) {
      const code = source(file);
      expect(code, file).not.toContain('"panel"');
      expect(code, file).not.toMatch(/backdrop:(?:bg|backdrop)-/u);
    }
  });

  it("drops the mobile bottom-nav reserve and screen min-height when printing", () => {
    const css = source("src/app/globals.css");
    const printBlocks = css.split("@media print").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("\n}\n")));
    const print = printBlocks.join("\n");
    // 列印寬度低於 48rem 時，手機底部功能列的預留空間必須以同等選擇器歸零，否則最後一頁會多出空白。
    expect(print).toMatch(
      /\[data-workspace-frame\]:not\(\[data-workspace-document\]\) \[data-workspace-content\] > main[^{]*\{[^}]*padding:\s*0/u,
    );
    expect(print).toMatch(/main:has\(\[data-workspace-nav\]\)[^{]*\{[^}]*padding:\s*0/u);
    expect(print).toMatch(/body[^{]*\{[^}]*min-height:\s*0/u);
  });

  it("lets the host game list flow across pages instead of jumping whole to a new page", () => {
    const page = source("src/app/(app)/workspaces/[workspaceId]/timeline/print/page.tsx");
    const section = page.match(/<section aria-label="遊戲名單" className="([^"]*)"/u);
    expect(section?.[1]).toBeDefined();
    // 整段不可切割時，名單放不下就整塊跳到下一頁，前一頁會留下一大片空白。
    expect(section?.[1]).not.toMatch(/break-inside-avoid/u);
    expect(page).toMatch(/<h2 className="[^"]*break-after-avoid/u);
    expect(page).toMatch(/<li key=\{participant\.id\} className="[^"]*break-inside-avoid/u);
  });
});
