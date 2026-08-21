/**
 * 這些 class 是 scripts/rwd-audit.mjs 實際量出來的修正結果。
 * 稽核要跑 next build + Chromium，不會進 CI 的 vitest；
 * 這裡把結論釘住，避免有人順手改回去又沒人發現。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "./badge";
import { Dialog } from "./dialog";
import { FilterChips } from "./toolbar";

describe("responsive contract", () => {
  it("lets a badge wrap instead of being clipped by the global overflow-x hidden", () => {
    render(<Badge tone="brand">很長的流程階段名稱</Badge>);
    const badge = screen.getByText("很長的流程階段名稱");

    expect(badge).toHaveClass("min-w-0", "max-w-full", "break-words");
    // shrink-0 會讓徽章拒絕縮小，在 320px 直接被切掉右半邊。
    expect(badge).not.toHaveClass("shrink-0");
  });

  it("keeps filter chips at a 44px touch target on phones", () => {
    render(
      <FilterChips
        label="狀態"
        value="ALL"
        onChange={vi.fn()}
        options={[
          { value: "ALL", label: "全部" },
          { value: "TODO", label: "待辦" },
        ]}
      />,
    );

    expect(screen.getByRole("radio", { name: /全部/ })).toHaveClass(
      "min-h-11",
      "sm:min-h-9",
    );
  });

  it("keeps the dialog close button at a 44px touch target on phones", () => {
    const { container } = render(
      <Dialog
        dialogRef={{ current: null }}
        titleId="contract-dialog-title"
        title="測試對話框"
        closeLabel="關閉測試對話框"
        onClose={vi.fn()}
      >
        <p>內容</p>
      </Dialog>,
    );

    // 收合的 <dialog> 不在無障礙樹裡，只能直接抓節點。
    expect(
      container.querySelector('[aria-label="關閉測試對話框"]'),
    ).toHaveClass("size-11", "sm:size-9");
  });
});
