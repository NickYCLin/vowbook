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
import {
  getSeatingFloorPlanMetrics,
  getSeatingFloorPlanSafeCoordinateBounds,
  resolveSeatingFloorPlanPositions,
} from "@/domain/seating-floor-plan";

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

  it("offers editor selection and directional alternatives that persist one CAS move", async () => {
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
    const controls = screen.getByRole("group", { name: "1 號桌 主桌位置調整" });
    await fireEvent.click(
      within(controls).getByRole("button", { name: "將 1 號桌 主桌 向右移動" }),
    );

    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    const formData = updateLayout.mock.calls[0][3] as FormData;
    expect(updateLayout.mock.calls[0].slice(0, 3)).toEqual([
      "workspace_internal",
      "table_internal_main",
      { status: "idle" },
    ]);
    expect(formData.get("layoutX")).toBe("550");
    expect(formData.get("layoutY")).toBe("220");
    expect(formData.get("expectedVersion")).toBe("3");
    await waitFor(() => expect(mainCard).toHaveAttribute("data-layout-x", "550"));
  });

  it("preserves a non-centre pointer grab offset and submits one exact CAS move on release", async () => {
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
    const handle = screen.getByRole("button", { name: "選取並移動 1 號桌 主桌" });

    // 主桌中心是 (600, 415.36)，從中心右 30px、上 20px 的位置開始拖曳。
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
    // 跟著指標跑的那張不能補間，否則圓桌會拖在手指後面。
    expect(
      screen.getByRole("article", {
        name: "1 號桌 主桌，男方親友，已安排 3 / 10 位，兒童椅 2 張",
      }).className,
    ).not.toContain("transition-[box-shadow,left,top]");
    expect(updateLayout).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, {
      pointerId: 7,
      clientX: 730,
      clientY: 475.36,
    });

    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    const formData = updateLayout.mock.calls[0][3] as FormData;
    expect(updateLayout.mock.calls[0].slice(0, 3)).toEqual([
      "workspace_internal",
      "table_internal_main",
      { status: "idle" },
    ]);
    expect(formData.get("layoutX")).toBe("614");
    expect(formData.get("layoutY")).toBe("336");
    expect(formData.get("expectedVersion")).toBe("3");
  });

  it("reports a finished move without scrolling away from the table being adjusted", async () => {
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );

    await fireEvent.click(
      screen.getByRole("button", { name: "將 1 號桌 主桌 向右移動" }),
    );
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));

    // 訊息在場地圖下方，聚焦不能連帶把畫面捲過去，否則微調位置時每按
    // 一次方向鍵就會看不到那張桌子。
    const feedback = await screen.findByRole("status");
    const focus = vi.spyOn(feedback, "focus");
    // 預設的 mock 每次都回傳同一個物件，狀態沒換身分就不會重跑聚焦效果。
    updateLayout.mockResolvedValueOnce({
      status: "success",
      message: "已更新場地位置。",
    });
    // 方向鍵在送出期間是 disabled，對 disabled 的按鈕點下去不會有任何事。
    // 前一次移動的 isPending 還沒放掉就點，這一段會整個變成空轉。
    const moveLeft = screen.getByRole("button", { name: "將 1 號桌 主桌 向左移動" });
    await waitFor(() => expect(moveLeft).toBeEnabled());
    fireEvent.click(moveLeft);

    await waitFor(() => expect(focus).toHaveBeenCalled());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
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
    const handle = screen.getByRole("button", { name: "選取並移動 1 號桌 主桌" });
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

    const controls = screen.getByRole("group", { name: "1 號桌 主桌位置調整" });
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

  it("snaps a drag that lands near a layout slot so the plan stays aligned", async () => {
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
    const handle = screen.getByRole("button", { name: "選取並移動 1 號桌 主桌" });

    // 從主桌中心 (600, 415.36) 拖到 (336, 429.1)，換算後是 (200, 240)：
    // 離女方區席位 (190, 220) 不到半個圓桌，放開時要吸附過去。
    fireEvent.pointerDown(handle, {
      pointerId: 9,
      isPrimary: true,
      button: 0,
      clientX: 600,
      clientY: 415.36,
    });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 336, clientY: 429.1 });
    fireEvent.pointerUp(handle, { pointerId: 9, clientX: 336, clientY: 429.1 });

    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    const formData = updateLayout.mock.calls[0][3] as FormData;
    expect(formData.get("layoutX")).toBe("190");
    expect(formData.get("layoutY")).toBe("220");
    expect(
      screen.getByRole("article", {
        name: "1 號桌 主桌，男方親友，已安排 3 / 10 位，兒童椅 2 張",
      }),
    ).toHaveAttribute("data-layout-x", "190");
  });

  it("clamps a pointer edge move before rendering or persisting an optimistic position", async () => {
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
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 960,
      bottom: 960,
      width: 960,
      height: 960,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", { name: "選取並移動 1 號桌 主桌" });
    const mainCard = screen.getByRole("article", {
      name: "1 號桌 主桌，男方親友，已安排 3 / 10 位，兒童椅 2 張",
    });
    const safeBounds = getSeatingFloorPlanSafeCoordinateBounds(tables.length);

    fireEvent.pointerDown(handle, {
      pointerId: 11,
      isPrimary: true,
      button: 0,
      clientX: 480,
      clientY: 258.432,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 11,
      clientX: 0,
      clientY: 0,
    });

    expect(updateLayout).not.toHaveBeenCalled();
    expect(mainCard).toHaveAttribute("data-layout-x", String(safeBounds.minX));
    expect(mainCard).toHaveAttribute("data-layout-y", String(safeBounds.minY));
    expect(mainCard).toHaveAttribute("data-layout-x", "0");
    expect(mainCard).toHaveAttribute("data-layout-y", "0");

    fireEvent.pointerUp(handle, {
      pointerId: 11,
      clientX: 0,
      clientY: 0,
    });

    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    const formData = updateLayout.mock.calls[0][3] as FormData;
    expect(formData.get("layoutX")).toBe(String(safeBounds.minX));
    expect(formData.get("layoutY")).toBe(String(safeBounds.minY));
  });

  it("maps an existing rendered coordinate back to the same stored coordinate", async () => {
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_friends"
        onSelectTable={vi.fn()}
      />,
    );
    const venue = screen.getByTestId("seating-floor-plan-board");
    vi.spyOn(venue, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", {
      name: "選取並移動 2 號桌 摯友桌",
    });

    // (240, 720) renders at (27.12%, 69.92%). Cross the threshold, then
    // return to that exact rendered centre before releasing.
    fireEvent.pointerDown(handle, {
      pointerId: 9,
      isPrimary: true,
      button: 0,
      clientX: 271.2,
      clientY: 699.2,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 9,
      clientX: 275.2,
      clientY: 699.2,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 9,
      clientX: 271.2,
      clientY: 699.2,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 9,
      clientX: 271.2,
      clientY: 699.2,
    });

    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    const formData = updateLayout.mock.calls[0][3] as FormData;
    expect(formData.get("layoutX")).toBe("240");
    expect(formData.get("layoutY")).toBe("720");
    expect(formData.get("expectedVersion")).toBe("4");
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
    const handle = screen.getByRole("button", { name: "選取並移動 1 號桌 主桌" });

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
    const handle = screen.getByRole("button", { name: "選取並移動 1 號桌 主桌" });

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
      name: "選取並移動 253 號桌 婚宴桌 200",
    });
    expect(lastCard).toHaveStyle({ width: "44px", height: "44px" });
    expect(lastButton).toHaveClass("min-h-11", "min-w-11");
    // 圓桌只剩 44px 時只印桌號：桌名壓成 8px 根本讀不出來，而桌號本來就是
    // 賓客找位子時真正在看的東西。桌名仍留在無障礙名稱與 title 裡。
    expect(lastButton).toHaveTextContent("253");
    expect(lastButton).not.toHaveTextContent("婚宴桌 200");
  });

  it("resets persisted coordinates and refreshes authoritative props after a stale error", async () => {
    const { rerender } = render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_friends"
        onSelectTable={vi.fn()}
      />,
    );
    const controls = screen.getByRole("group", { name: "2 號桌 摯友桌位置調整" });
    await fireEvent.click(
      within(controls).getByRole("button", { name: "還原 2 號桌 摯友桌 自動排列" }),
    );
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    const resetData = updateLayout.mock.calls[0][3] as FormData;
    expect(resetData.get("layoutX")).toBe("");
    expect(resetData.get("layoutY")).toBe("");
    expect(resetData.get("expectedVersion")).toBe("4");

    updateLayout.mockResolvedValueOnce({
      status: "error",
      message: "桌次已由其他人更新，請重新載入後再試。",
    });
    rerender(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "將 1 號桌 主桌 向左移動" }),
    );
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "桌次已由其他人更新",
      );
    });
  });

  it("replaces a full optimistic snapshot when authoritative table changes recompute automatic slots", async () => {
    const { rerender } = render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={tables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );

    await fireEvent.click(
      screen.getByRole("button", { name: "將 1 號桌 主桌 向右移動" }),
    );
    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));

    const refreshedTables = [
      {
        ...tables[0],
        version: tables[0].version + 1,
        layoutX: 550,
        layoutY: 220,
      },
      tables[1],
      {
        id: "table_internal_new",
        number: 3,
        position: 3,
        version: 0,
        layoutX: null,
        layoutY: null,
        name: "新親友桌",
        capacity: 8,
        guests: [],
      },
    ];
    const expected = new Map(
      resolveSeatingFloorPlanPositions(refreshedTables).map((position) => [
        position.tableId,
        position,
      ]),
    );
    rerender(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={refreshedTables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );

    for (const table of refreshedTables) {
      const expectedPosition = expected.get(table.id);
      const assignedPartySize = table.guests.reduce(
        (total, guest) => total + guest.partySize,
        0,
      );
      const assignedChildSeats = table.guests.reduce(
        (total, guest) => total + (guest.childSeatCount ?? 0),
        0,
      );
      const card = screen.getByRole("article", {
        name: `${table.number} 號桌 ${table.name}，${
          table.guests.length > 0 ? "男方親友，" : ""
        }已安排 ${assignedPartySize} / ${table.capacity} 位${
          assignedChildSeats > 0 ? `，兒童椅 ${assignedChildSeats} 張` : ""
        }`,
      });
      expect(card).toHaveAttribute("data-layout-x", String(expectedPosition?.x));
      expect(card).toHaveAttribute("data-layout-y", String(expectedPosition?.y));
    }
  });

  it("optimistically resolves a safe fallback when reset preferred slot is persisted by another table", async () => {
    const blockedResetTables = [
      {
        ...tables[0],
        layoutX: 0,
        layoutY: 0,
      },
      {
        ...tables[1],
        layoutX: 500,
        layoutY: 220,
      },
    ];
    render(
      <SeatingFloorPlan
        workspaceId="workspace_internal"
        tables={blockedResetTables}
        canEdit
        selectedTableId="table_internal_main"
        onSelectTable={vi.fn()}
      />,
    );

    const mainCard = screen.getByRole("article", {
      name: "1 號桌 主桌，男方親友，已安排 3 / 10 位，兒童椅 2 張",
    });
    const blockerCard = screen.getByRole("article", {
      name: "2 號桌 摯友桌，已安排 0 / 8 位",
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "還原 1 號桌 主桌 自動排列" }),
    );

    await waitFor(() => expect(updateLayout).toHaveBeenCalledTimes(1));
    expect(mainCard).toHaveAttribute("data-layout-source", "automatic");
    // 主桌偏好的 (500, 220) 被佔走，退到後備池的第一個候選：摯友桌自己的
    // 偏好席位，也就是女方區唯一那一欄（兩桌時每側只排得下一欄）。
    expect(mainCard).toHaveAttribute("data-layout-x", "190");
    expect(mainCard).toHaveAttribute("data-layout-y", "220");
    expect(blockerCard).toHaveAttribute("data-layout-x", "500");
    expect(blockerCard).toHaveAttribute("data-layout-y", "220");
  });

  it("rolls back an optimistic move and refreshes once when the server reports a layout conflict", async () => {
    updateLayout.mockResolvedValueOnce({
      status: "error",
      message: "目前場地配置無法安全排列，請調整桌次位置後再試。",
    });
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
    await fireEvent.click(
      screen.getByRole("button", { name: "將 1 號桌 主桌 向右移動" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "目前場地配置無法安全排列",
      );
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(mainCard).toHaveAttribute("data-layout-x", "500");
    });
    expect(updateLayout).toHaveBeenCalledTimes(1);
  });
});
