import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, updateLayout, swapContents, resetLayouts } = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateLayout: vi.fn(),
  swapContents: vi.fn(),
  resetLayouts: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/actions/seating-tables", () => ({
  updateSeatingTableLayoutAction: updateLayout,
  swapSeatingTableContentsAction: swapContents,
  resetSeatingTableLayoutsAction: resetLayouts,
}));

import { SeatingFloorPlan } from "./seating-floor-plan";
import { seatingTableNumber } from "@/domain/seating-table";
import { getSeatingFloorPlanMetrics } from "@/domain/seating-floor-plan";

const tables = [
  {
    id: "table_internal_main",
    number: 1,
    position: 1,
    version: 3,
    layoutX: null,
    layoutY: null,
    name: "主桌",
    capacity: 10,
    guests: [
      {
        id: "guest_internal",
        name: "王小明",
        partySize: 3,
        side: "PARTNER_A" as const,
        childSeatCount: 2,
      },
    ],
  },
  {
    id: "table_internal_friends",
    number: 2,
    position: 2,
    version: 4,
    layoutX: 240,
    layoutY: 720,
    name: "摯友桌",
    capacity: 8,
    guests: [],
  },
];

describe("SeatingFloorPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateLayout.mockResolvedValue({
      status: "success",
      message: "已更新場地位置。",
    });
    swapContents.mockResolvedValue({
      status: "success",
      message: "已交換兩桌的桌名與入座賓客；桌號保持不變。",
    });
    resetLayouts.mockResolvedValue({
      status: "success",
      message: "已將 1 桌還原自動排列。",
    });
  });

  it("restores every manually placed table to automatic only after an explicit confirm", async () => {
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "依桌號重新排列" }),
    );
    // 打開確認列不等於執行：這個動作無法復原，要再按一次才會打伺服器。
    expect(resetLayouts).not.toHaveBeenCalled();
    expect(
      screen.getByText(/確定把 1 桌的手動位置清除，並依桌號重新排列/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "確定重新排列" }));

    // 樂觀更新：手動擺的那張桌子立刻回到自動排列，不等伺服器回應。
    expect(
      screen.getByRole("article", { name: "2 號桌 摯友桌，已安排 0 / 8 位" }),
    ).toHaveAttribute("data-layout-source", "automatic");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "已將 1 桌還原自動排列。",
      ),
    );
    expect(resetLayouts).toHaveBeenCalledTimes(1);
    expect(resetLayouts).toHaveBeenCalledWith(
      "workspace_internal",
      { status: "idle" },
      expect.any(FormData),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels the bulk reset without touching the server and stays disabled when all tables are automatic", () => {
    const { unmount } = render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "依桌號重新排列" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(resetLayouts).not.toHaveBeenCalled();
    expect(
      screen.getByRole("article", { name: "2 號桌 摯友桌，已安排 0 / 8 位" }),
    ).toHaveAttribute("data-layout-source", "persisted");
    unmount();

    // 沒有任何手動位置時按鈕停用：這時「還原全部」沒有意義。
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables.map((table) => ({
          ...table,
          layoutX: null,
          layoutY: null,
        }))}
        canEdit
        selectedTableId={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "依桌號重新排列" }),
    ).toBeDisabled();
  });

  it("rolls back the bulk reset and refreshes authoritative props on a server error", async () => {
    resetLayouts.mockResolvedValue({
      status: "error",
      message: "目前無法還原自動排列，請稍後再試。",
    });

    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "依桌號重新排列" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "確定重新排列" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "目前無法還原自動排列，請稍後再試。",
      ),
    );
    // 樂觀預覽整組丟掉，回到伺服器的權威版面。
    expect(
      screen.getByRole("article", { name: "2 號桌 摯友桌，已安排 0 / 8 位" }),
    ).toHaveAttribute("data-layout-source", "persisted");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders a named venue, guide zones, aisle, and circular occupancy cards without ordinals or ids", () => {
    const { container } = render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit={false}
        selectedTableId={null}
      />,
    );

    const board = screen.getByRole("region", { name: "宴會場地配置" });
    const scrollContainer = container.querySelector("[data-floor-plan-scroll]");
    expect(scrollContainer).toHaveClass("max-w-full", "overflow-x-auto");
    expect(board).toHaveStyle({
      boxSizing: "border-box",
      minWidth: "960px",
    });
    expect(board).toHaveAttribute("data-board-min-width", "960");
    expect(board).toHaveAttribute("data-marker-size", "112");
    expect(within(board).getByText("舞台", { exact: true })).toBeInTheDocument();
    // 背景不再標「左女右男」：桌次沒有關係欄位，自動排列也只照閱讀順序落位，
    // 位置跟賓客是誰無關，寫死在背景上等於保證有些桌會被標錯邊。
    expect(within(board).queryByText("女方親友")).toBeNull();
    expect(within(board).queryByText("男方親友")).toBeNull();
    // 側別改標在圓桌上，而且是從實際入座的賓客推得的。
    expect(within(board).getByText("男方", { exact: true })).toBeInTheDocument();
    expect(within(board).getByText("中央動線", { exact: true })).toBeInTheDocument();
    const mainTable = within(board).getByRole("article", {
      name: "1 號桌 主桌，男方親友，已安排 3 / 10 位，兒童椅 2 張",
    });
    expect(mainTable).toBeInTheDocument();
    expect(mainTable.querySelector("[title]")).toHaveClass(
      "justify-items-center",
      "text-center",
    );
    expect(within(mainTable).getByText("1", { exact: true })).toHaveClass(
      "w-full",
      "text-center",
    );
    expect(within(mainTable).getByText("主桌", { exact: true })).toHaveClass(
      "w-full",
      "text-center",
    );
    expect(within(mainTable).getByText("男方", { exact: true })).toHaveClass(
      "w-full",
      "justify-center",
      "text-center",
    );
    expect(within(mainTable).getByText("3 / 10 位", { exact: true })).toHaveClass(
      "w-full",
      "text-center",
    );
    expect(within(mainTable).getByText("兒童椅 2")).toBeInTheDocument();
    expect(within(board).getByRole("article", { name: "2 號桌 摯友桌，已安排 0 / 8 位" })).toHaveAttribute(
      "data-layout-source",
      "persisted",
    );
    expect(within(board).queryByRole("button")).toBeNull();
    expect(container).not.toHaveTextContent("table_internal");
    expect(container).not.toHaveTextContent("guest_internal");
    expect(container).not.toHaveTextContent("順位");
    expect(container).not.toHaveTextContent("第 1 桌");
  });

  it("renders persisted coordinate endpoints fully inside the canonical 15-table board", () => {
    const transitionTables = Array.from({ length: 15 }, (_, index) => ({
      id: `transition_table_${index}`,
      number: seatingTableNumber(index + 1),
      position: index + 1,
      version: 1,
      layoutX: index === 0 ? 0 : index === 1 ? 1000 : null,
      layoutY: index === 0 ? 0 : index === 1 ? 1000 : null,
      name: index === 0 ? "左上端點桌" : index === 1 ? "右下端點桌" : `婚宴桌 ${index + 1}`,
      capacity: 10,
      guests: [],
    }));

    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={transitionTables}
        canEdit={false}
        selectedTableId={null}
      />,
    );

    const board = screen.getByTestId("seating-floor-plan-board");
    const topLeft = within(board).getByRole("article", {
      name: "1 號桌 左上端點桌，已安排 0 / 10 位",
    });
    const bottomRight = within(board).getByRole("article", {
      name: "2 號桌 右下端點桌，已安排 0 / 10 位",
    });

    expect(board).toHaveAttribute("data-board-min-width", "960");
    expect(board).toHaveAttribute("data-board-height", "960");
    expect(board).toHaveAttribute("data-marker-size", "112");
    expect(topLeft).toHaveStyle({ left: "6%", top: "8%" });
    expect(bottomRight).toHaveStyle({ left: "94%", top: "94%" });
    expect(topLeft).toHaveStyle({ width: "112px", height: "112px" });
    expect(bottomRight).toHaveStyle({ width: "112px", height: "112px" });
  });

  it("keeps the selected table number and slot fixed while offering content exchange only", () => {
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );

    const mainCard = screen.getByRole("article", {
      name: "1 號桌 主桌，男方親友，已安排 3 / 10 位，兒童椅 2 張",
    });
    expect(mainCard).toHaveAttribute("data-layout-x", "500");
    expect(mainCard).toHaveAttribute("data-layout-y", "220");
    expect(mainCard).toHaveStyle({ left: "50%", top: "26.92%" });
    const controls = screen.getByRole("group", {
      name: "1 號桌 主桌內容交換",
    });
    expect(controls).toHaveTextContent("桌號與位置固定，只交換桌名與賓客");
    expect(within(controls).queryByRole("button", { name: /向.+移動/ })).toBeNull();
    expect(
      within(controls).queryByRole("button", { name: /還原.+自動排列/ }),
    ).toBeNull();
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it("keeps the numbered slot fixed when a drag ends on empty floor space", () => {
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );
    const venue = screen.getByTestId("seating-floor-plan-board");
    vi.spyOn(venue, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 200,
      left: 100,
      top: 200,
      right: 1100,
      bottom: 1000,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", {
      name: "選取並拖曳交換 1 號桌 主桌",
    });
    const mainCard = screen.getByRole("article", {
      name: "1 號桌 主桌，男方親友，已安排 3 / 10 位，兒童椅 2 張",
    });

    fireEvent.pointerDown(handle, {
      pointerId: 7,
      isPrimary: true,
      button: 0,
      clientX: 630,
      clientY: 395.36,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 7,
      clientX: 730,
      clientY: 475.36,
    });
    expect(mainCard).toHaveAttribute("data-layout-x", "500");
    expect(mainCard).toHaveAttribute("data-layout-y", "220");
    expect(updateLayout).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, {
      pointerId: 7,
      clientX: 730,
      clientY: 475.36,
    });

    expect(mainCard).toHaveAttribute("data-layout-x", "500");
    expect(mainCard).toHaveAttribute("data-layout-y", "220");
    expect(updateLayout).not.toHaveBeenCalled();
    expect(swapContents).not.toHaveBeenCalled();
  });

  it("swaps table names and guests while fixed numbers stay in place", async () => {
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );
    const venue = screen.getByTestId("seating-floor-plan-board");
    vi.spyOn(venue, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 200,
      left: 100,
      top: 200,
      right: 1100,
      bottom: 1000,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", {
      name: "選取並拖曳交換 1 號桌 主桌",
    });
    const mainCard = screen.getByRole("article", {
      name: "1 號桌 主桌，男方親友，已安排 3 / 10 位，兒童椅 2 張",
    });
    const friendsCard = screen.getByRole("article", {
      name: "2 號桌 摯友桌，已安排 0 / 8 位",
    });

    // 從主桌中心 (600, 415.36) 拖到摯友桌所在的 (240, 720)。
    fireEvent.pointerDown(handle, {
      pointerId: 11,
      isPrimary: true,
      button: 0,
      clientX: 600,
      clientY: 415.36,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 11,
      clientX: 371.2,
      clientY: 759.36,
    });

    // 壓住的期間要標示出「放開會跟它換」。
    expect(friendsCard).toHaveAttribute("data-swap-target", "true");
    // 桌號與場地位置固定，預覽只交換桌名與入座賓客。
    expect(mainCard).toHaveAttribute("data-layout-x", "500");
    expect(mainCard).toHaveAttribute("data-layout-y", "220");
    expect(friendsCard).toHaveAttribute("data-layout-x", "240");
    expect(friendsCard).toHaveAttribute("data-layout-y", "720");
    expect(mainCard).toHaveAccessibleName(
      "1 號桌 摯友桌，已安排 0 / 10 位",
    );
    expect(friendsCard).toHaveAccessibleName(
      "2 號桌 主桌，男方親友，已安排 3 / 8 位，兒童椅 2 張",
    );
    expect(updateLayout).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, {
      pointerId: 11,
      clientX: 371.2,
      clientY: 759.36,
    });

    await waitFor(() => expect(swapContents).toHaveBeenCalledTimes(1));
    expect(updateLayout).not.toHaveBeenCalled();
    expect(swapContents.mock.calls[0].slice(0, 3)).toEqual([
      "workspace_internal",
      "table_internal_main",
      { status: "idle" },
    ]);
    const formData = swapContents.mock.calls[0][3] as FormData;
    expect(formData.get("targetTableId")).toBe("table_internal_friends");
    expect(formData.get("expectedVersion")).toBe("3");
    expect(formData.get("targetExpectedVersion")).toBe("4");
    // 座標不由用戶端指定：否則「交換」會變成把桌子放到任意位置的旁門。
    expect(formData.get("layoutX")).toBeNull();
    expect(formData.get("layoutY")).toBeNull();

    // 樂觀預覽保留固定座標，並維持交換後的桌名與賓客。
    await waitFor(() =>
      expect(
        screen.getByRole("article", { name: "1 號桌 摯友桌，已安排 0 / 10 位" }),
      ).toHaveAttribute("data-layout-x", "500"),
    );
    expect(friendsCard).toHaveAttribute("data-layout-x", "240");
    expect(friendsCard).not.toHaveAttribute("data-swap-target");
  });

  it("offers a keyboard-reachable swap for people who cannot drag", async () => {
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );

    const controls = screen.getByRole("group", { name: "1 號桌 主桌內容交換" });
    fireEvent.change(
      within(controls).getByLabelText("與其他桌交換桌名與賓客"),
      { target: { value: "table_internal_friends" } },
    );
    await fireEvent.click(
      within(controls).getByRole("button", {
        name: "交換 1 號桌 主桌 與所選桌次的桌名與入座賓客",
      }),
    );

    await waitFor(() => expect(swapContents).toHaveBeenCalledTimes(1));
    const formData = swapContents.mock.calls[0][3] as FormData;
    expect(formData.get("targetTableId")).toBe("table_internal_friends");
    expect(formData.get("expectedVersion")).toBe("3");
    expect(formData.get("targetExpectedVersion")).toBe("4");
  });

  it("selects a table without writing layout coordinates when the pointer does not move", () => {
    const onSelectTable = vi.fn();
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId={null}
        onSelectTable={onSelectTable}
      />,
    );
    const handle = screen.getByRole("button", {
      name: "選取並拖曳交換 1 號桌 主桌",
    });

    fireEvent.pointerDown(handle, {
      pointerId: 8,
      isPrimary: true,
      button: 0,
      clientX: 527,
      clientY: 241,
    });
    fireEvent.pointerUp(handle, { pointerId: 8, clientX: 527, clientY: 241 });

    expect(onSelectTable).toHaveBeenCalledWith("table_internal_main");
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it("does not select or persist a table from non-primary pointers", () => {
    const onSelectTable = vi.fn();
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId={null}
        onSelectTable={onSelectTable}
      />,
    );
    const handle = screen.getByRole("button", {
      name: "選取並拖曳交換 1 號桌 主桌",
    });

    fireEvent.pointerDown(handle, {
      pointerId: 12,
      isPrimary: false,
      button: 0,
      clientX: 527,
      clientY: 241,
    });
    fireEvent.pointerUp(handle, { pointerId: 12, clientX: 527, clientY: 241 });
    fireEvent.pointerDown(handle, {
      pointerId: 13,
      isPrimary: true,
      button: 2,
      clientX: 527,
      clientY: 241,
    });
    fireEvent.pointerUp(handle, { pointerId: 13, clientX: 527, clientY: 241 });

    expect(onSelectTable).not.toHaveBeenCalled();
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it("renders 200 visible named editor targets at the accessible density size", () => {
    const denseTables = Array.from({ length: 200 }, (_, index) => ({
      id: `dense_table_${index}`,
      number: seatingTableNumber(index + 1),
      position: index + 1,
      version: 1,
      layoutX: null,
      layoutY: null,
      name: index === 0 ? "主桌" : `婚宴桌 ${index + 1}`,
      capacity: 10,
      guests: [],
    }));
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={denseTables}
        canEdit
        selectedTableId={null}
        onSelectTable={vi.fn()}
      />,
    );

    const board = screen.getByTestId("seating-floor-plan-board");
    const denseMetrics = getSeatingFloorPlanMetrics(200);
    expect(board).toHaveAttribute("data-marker-size", "44");
    expect(board).toHaveAttribute(
      "data-board-height",
      String(denseMetrics.boardHeightPx),
    );
    expect(within(board).getAllByRole("article")).toHaveLength(200);
    const lastCard = within(board).getByRole("article", {
      name: "253 號桌 婚宴桌 200，已安排 0 / 10 位",
    });
    const lastButton = within(lastCard).getByRole("button", {
      name: "選取並拖曳交換 253 號桌 婚宴桌 200",
    });
    expect(lastCard).toHaveStyle({ width: "44px", height: "44px" });
    expect(lastButton).toHaveClass("min-h-11", "min-w-11");
    // 圓桌只剩 44px 時只印桌號：桌名壓成 8px 根本讀不出來，而桌號本來就是
    // 賓客找位子時真正在看的東西。桌名仍留在無障礙名稱與 title 裡。
    expect(lastButton).toHaveTextContent("253");
    expect(lastButton).not.toHaveTextContent("婚宴桌 200");
  });

});
