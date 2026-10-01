import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/packing-items", () => ({
  createPackingItemAction: vi.fn(async () => ({ status: "success", message: "已加入。" })),
  setPackingItemPackedAction: vi.fn(),
  deletePackingItemAction: vi.fn(),
  updatePackingItemAction: vi.fn(),
  movePackingItemAction: vi.fn(async () => ({ status: "success", message: "已移到宴客用品。" })),
}));

import { createPackingItemAction, movePackingItemAction } from "@/actions/packing-items";
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

  it("adds from one form into a side or the wedding-supply section", async () => {
    render(<PackingList workspaceId="ws" items={items} canEdit />);
    expect(screen.getByRole("heading", { name: "新增物品" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "個人物品" })).toBeNull();
    const where = screen.getByRole("combobox", { name: "放在哪一區" });
    expect(
      within(where).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["新郎", "新娘", "共用", "宴客用品"]);
    fireEvent.change(where, { target: { value: "WEDDING_SUPPLY" } });
    fireEvent.change(screen.getByRole("textbox", { name: "物品名稱" }), {
      target: { value: "喜糖" },
    });
    await act(async () => {
      fireEvent.submit(where.closest("form")!);
    });
    const formData = vi.mocked(createPackingItemAction).mock.calls[0][2] as FormData;
    expect(formData.get("title")).toBe("喜糖");
    expect(formData.get("category")).toBe("WEDDING_SUPPLY");
    expect(formData.get("side")).toBe("SHARED");
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

  it("lists wedding supplies separately with note, owner and budget shortcuts", () => {
    render(
      <PackingList
        workspaceId="ws"
        canEdit
        supplySuggestions={["花椰菜遊戲禮"]}
        items={[
          ...items,
          {
            id: "s1",
            title: "位上禮 堅果",
            side: "PARTNER_A",
            category: "WEDDING_SUPPLY",
            note: "120 份",
            packed: false,
            version: 0,
          },
        ]}
      />,
    );
    const supplies = screen.getByRole("region", { name: "宴客用品" });
    expect(supplies).toHaveTextContent("位上禮 堅果");
    expect(supplies).toHaveTextContent("120 份");
    expect(supplies).toHaveTextContent("新郎帶");
    expect(supplies).toHaveTextContent("0/1 已打包");
    expect(screen.getByRole("region", { name: "新郎" })).not.toHaveTextContent(
      "位上禮",
    );
    expect(
      within(supplies).getByRole("button", { name: "從花費帶入：花椰菜遊戲禮" }),
    ).toBeInTheDocument();
    expect(
      within(supplies).getByRole("textbox", { name: "數量／備註" }),
    ).toBeInTheDocument();
    fireEvent.click(within(supplies).getByRole("button", { name: "編輯：位上禮 堅果" }));
    expect(
      within(supplies).getByRole("textbox", { name: "編輯數量／備註" }),
    ).toHaveValue("120 份");
  });

  it("moves an item to another section by drag and drop", async () => {
    render(<PackingList workspaceId="ws" items={items} canEdit />);
    const store = new Map<string, string>();
    const dataTransfer = {
      get types() {
        return Array.from(store.keys());
      },
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? "",
      effectAllowed: "all",
      dropEffect: "none",
    };
    const row = within(screen.getByRole("region", { name: "共用" })).getByRole("listitem");
    const supplies = screen.getByRole("region", { name: "宴客用品" });
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.dragOver(supplies, { dataTransfer });
    expect(supplies).toHaveAttribute("data-drop-active", "true");
    await act(async () => {
      fireEvent.drop(supplies, { dataTransfer });
    });
    expect(movePackingItemAction).toHaveBeenCalledTimes(1);
    const [workspaceId, itemId, , formData] = vi.mocked(movePackingItemAction).mock.calls[0];
    expect([workspaceId, itemId]).toEqual(["ws", "p4"]);
    expect(formData.get("category")).toBe("WEDDING_SUPPLY");
    expect(formData.get("side")).toBe("SHARED");
    expect(formData.get("expectedVersion")).toBe("0");
  });

  it("shows a friendly empty state", () => {
    render(<PackingList workspaceId="ws" items={[]} canEdit />);
    expect(screen.getByText(/還沒有要帶的物品/)).toBeInTheDocument();
  });
});
