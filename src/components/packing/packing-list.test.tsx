import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/packing-items", () => ({
  createPackingItemAction: vi.fn(),
  setPackingItemPackedAction: vi.fn(),
  deletePackingItemAction: vi.fn(),
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

  it("hides editing controls for read-only members", () => {
    render(<PackingList workspaceId="ws" items={items} canEdit={false} />);
    expect(screen.queryByRole("textbox", { name: "物品名稱" })).toBeNull();
    expect(screen.queryByRole("button", { name: /移除：/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /已打包：/ })).toBeNull();
  });

  it("shows a friendly empty state", () => {
    render(<PackingList workspaceId="ws" items={[]} canEdit />);
    expect(screen.getByText(/還沒有要帶的物品/)).toBeInTheDocument();
  });
});
