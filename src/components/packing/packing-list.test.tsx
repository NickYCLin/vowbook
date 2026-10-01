import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/packing-items", () => ({
  createPackingItemAction: vi.fn(),
  setPackingItemPackedAction: vi.fn(),
  deletePackingItemAction: vi.fn(),
  updatePackingItemAction: vi.fn(),
}));

import { PackingList, type PackingListItem } from "./packing-list";

const items: PackingListItem[] = [
  { id: "p1", title: "西裝", side: "PARTNER_A", packed: true, version: 1 },
  { id: "p2", title: "隱形眼鏡", side: "PARTNER_A", packed: false, version: 0 },
  { id: "p3", title: "白紗內襯", side: "PARTNER_B", packed: false, version: 0 },
  { id: "p4", title: "手機充電器", side: "SHARED", packed: false, version: 0 },
];

describe("PackingList", () => {
  it("groups items by groom, bride and shared with packed progress", () => {
    render(<PackingList workspaceId="ws" items={items} canEdit />);
    const groom = screen.getByRole("region", { name: "新郎" });
    expect(groom).toHaveTextContent("1/2 已打包");
    expect(within(groom).getByText("西裝")).toBeInTheDocument();
    expect(
      within(groom).getByRole("button", { name: "改回未打包：西裝" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(groom).getByRole("button", { name: "標記已打包：隱形眼鏡" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("region", { name: "新娘" })).toHaveTextContent(
      "白紗內襯",
    );
    expect(screen.getByRole("region", { name: "共用" })).toHaveTextContent(
      "手機充電器",
    );
    expect(screen.getByRole("textbox", { name: "物品名稱" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "列印清單" })).toBeInTheDocument();
  });

  it("lets an added item be edited inline and cancelled", () => {
    render(<PackingList workspaceId="ws" items={items} canEdit />);
    const shared = screen.getByRole("region", { name: "共用" });
    fireEvent.click(within(shared).getByRole("button", { name: "編輯：手機充電器" }));
    const title = within(shared).getByRole("textbox", { name: "編輯物品名稱" });
    expect(title).toHaveValue("手機充電器");
    expect(within(shared).getByRole("combobox", { name: "誰要帶" })).toHaveValue("SHARED");
    expect(within(shared).getByRole("button", { name: "儲存" })).toBeInTheDocument();
    fireEvent.click(within(shared).getByRole("button", { name: "取消" }));
    expect(within(shared).queryByRole("textbox", { name: "編輯物品名稱" })).toBeNull();
    expect(within(shared).getByText("手機充電器")).toBeInTheDocument();
  });

  it("hides editing controls for read-only members", () => {
    render(<PackingList workspaceId="ws" items={items} canEdit={false} />);
    expect(screen.queryByRole("textbox", { name: "物品名稱" })).toBeNull();
    expect(screen.queryByRole("button", { name: /移除：/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /編輯：/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /已打包：/ })).toBeNull();
  });

  it("sorts items within each side by stroke count instead of input order", () => {
    render(
      <PackingList
        workspaceId="ws"
        canEdit={false}
        items={[
          { id: "a", title: "隱形眼鏡", side: "PARTNER_A", packed: false, version: 0 },
          { id: "b", title: "睡衣(前開式)", side: "PARTNER_A", packed: false, version: 0 },
          { id: "c", title: "西裝", side: "PARTNER_A", packed: false, version: 0 },
          { id: "d", title: "手機充電器", side: "PARTNER_A", packed: false, version: 0 },
        ]}
      />,
    );
    const groom = screen.getByRole("region", { name: "新郎" });
    expect(
      within(groom).getAllByRole("listitem").map((row) => row.textContent),
    ).toEqual(["手機充電器", "西裝", "睡衣(前開式)", "隱形眼鏡"]);
  });

  it("shows a friendly empty state", () => {
    render(<PackingList workspaceId="ws" items={[]} canEdit />);
    expect(screen.getByText(/還沒有要帶的物品/)).toBeInTheDocument();
  });
});
