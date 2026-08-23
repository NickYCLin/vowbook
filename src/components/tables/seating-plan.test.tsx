import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./table-forms", () => ({
  AdjustSeatingTablesForm: ({
    currentTableCount,
  }: {
    currentTableCount: number;
  }) => <button>桌數設定（目前 {currentTableCount} 桌）</button>,
  CreateSeatingTableForm: () => <button>新增桌次表單</button>,
  EditSeatingTableForm: ({ tableLabel }: { tableLabel: string }) => (
    <button>編輯 {tableLabel}</button>
  ),
  DeleteSeatingTableForm: ({
    tableId,
    tableLabel,
    onDeleteIntent,
    onIntentRejected,
  }: {
    tableId: string;
    tableLabel: string;
    onDeleteIntent?: (intent: {
      tableId: string;
      tableName: string;
    }) => void;
    onIntentRejected?: (intent: { tableId: string }) => void;
  }) => (
    <div>
      <button>刪除 {tableLabel}</button>
      <button
        onClick={() => onDeleteIntent?.({ tableId, tableName: tableLabel })}
      >
        確認刪除空桌 {tableLabel}
      </button>
      <button onClick={() => onIntentRejected?.({ tableId })}>
        刪除失敗 {tableLabel}
      </button>
    </div>
  ),
  AssignGuestForm: ({
    guestId,
    guestName,
    tables,
    onAssignIntent,
  }: {
    guestId: string;
    guestName: string;
    tables: Array<{ id: string; name: string }>;
    onAssignIntent?: (intent: {
      guestId: string;
      guestName: string;
      tableId: string;
      tableName: string;
    }) => void;
  }) => (
    <button
      onClick={() =>
        onAssignIntent?.({
          guestId,
          guestName,
          tableId: tables[0].id,
          tableName: tables[0].name,
        })
      }
    >
      安排 {guestName}
    </button>
  ),
  UnassignGuestForm: ({
    guestId,
    guestName,
    onUnassignIntent,
  }: {
    guestId: string;
    guestName: string;
    onUnassignIntent?: (intent: { guestId: string; guestName: string }) => void;
  }) => (
    <button onClick={() => onUnassignIntent?.({ guestId, guestName })}>
      移出 {guestName}
    </button>
  ),
}));

vi.mock("./guest-party-size-form", () => ({
  EditGuestPartySizeForm: ({
    guest,
  }: {
    guest: { name: string; partySize: number };
  }) => <button>調整 {guest.name} 人數（{guest.partySize} 位）</button>,
}));

vi.mock("./seating-floor-plan", () => ({
  SeatingFloorPlan: ({
    tables,
    canEdit,
    selectedTableId,
    onSelectTable,
  }: {
    tables: Array<{ id: string; name: string; capacity: number; guests: unknown[] }>;
    canEdit: boolean;
    selectedTableId: string | null;
    onSelectTable?: (tableId: string) => void;
  }) => (
    <section aria-label="宴會場地配置" data-mocked-floor-plan>
      {tables.map((item) =>
        canEdit ? (
          <button
            key={item.id}
            aria-pressed={selectedTableId === item.id}
            onClick={() => onSelectTable?.(item.id)}
          >
            選取 {item.name}
          </button>
        ) : (
          <article key={item.id} aria-label={`${item.name}唯讀圓桌`}>
            {item.name}
          </article>
        ),
      )}
    </section>
  ),
}));

import { SeatingPlan } from "./seating-plan";

/** 未安排賓客現在多帶 CAS 版本與匯入來源旗標。 */
function unassigned(guest: {
  id: string;
  name: string;
  partySize: number;
  side?: "PARTNER_A" | "PARTNER_B" | "SHARED";
}) {
  return {
    ...guest,
    version: 1,
    category: "GUEST" as const,
    side: guest.side ?? ("SHARED" as const),
    attendanceStatus: "UNDECIDED" as const,
    notes: null,
  };
}

const table = {
  id: "table_internal",
  workspaceId: "workspace_internal",
  number: 1,
  position: 1,
  version: 3,
  layoutX: null,
  layoutY: null,
  name: "主桌",
  capacity: 10,
  notes: "靠近舞台",
  createdAt: new Date("2026-07-22T00:00:00.000Z"),
  updatedAt: new Date("2026-07-22T00:00:00.000Z"),
  guests: [
    {
      id: "guest_internal",
      name: "王小明",
      partySize: 3,
      side: "PARTNER_A" as const,
      notes: "素食，需兒童椅\n靠近走道",
    },
  ],
};

describe("SeatingPlan", () => {
  it("groups every unassigned guest by side with accessible headings and preserved controls", () => {
    const { container } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[{ ...table, guests: [] }]}
        unassignedGuests={[
          unassigned({
            id: "guest_a_1",
            name: "男方一",
            partySize: 2,
            side: "PARTNER_A",
          }),
          unassigned({
            id: "guest_shared_1",
            name: "共同一",
            partySize: 1,
            side: "SHARED",
          }),
          unassigned({
            id: "guest_b_1",
            name: "女方一",
            partySize: 3,
            side: "PARTNER_B",
          }),
          unassigned({
            id: "guest_a_2",
            name: "男方二",
            partySize: 1,
            side: "PARTNER_A",
          }),
          unassigned({
            id: "guest_shared_2",
            name: "共同二",
            partySize: 2,
            side: "SHARED",
          }),
        ]}
        canEdit
      />,
    );

    expect(
      screen.getByRole("heading", { name: "未安排賓客", level: 2 }),
    ).toBeInTheDocument();
    for (const heading of ["男方親友", "女方親友", "共同親友"]) {
      expect(
        screen.getByRole("heading", { name: heading, level: 3 }),
      ).toBeInTheDocument();
    }

    const partnerA = screen.getByRole("region", { name: "男方親友" });
    const partnerB = screen.getByRole("region", { name: "女方親友" });
    const shared = screen.getByRole("region", { name: "共同親友" });

    expect(within(partnerA).getByText("2 筆", { exact: true })).toBeInTheDocument();
    expect(within(partnerA).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("男方一"),
      expect.stringContaining("男方二"),
    ]);
    expect(within(partnerA).queryByText("女方一")).toBeNull();
    expect(within(partnerA).queryByText("共同一")).toBeNull();
    expect(
      within(partnerA).getByRole("button", { name: "調整 男方一 人數（2 位）" }),
    ).toBeInTheDocument();
    expect(
      within(partnerA).getByRole("button", { name: "安排 男方一" }),
    ).toBeInTheDocument();

    expect(within(partnerB).getByText("1 筆", { exact: true })).toBeInTheDocument();
    expect(within(partnerB).getByText("女方一")).toBeInTheDocument();
    expect(within(partnerB).queryByText("男方一")).toBeNull();
    expect(
      within(partnerB).getByRole("button", { name: "調整 女方一 人數（3 位）" }),
    ).toBeInTheDocument();
    expect(
      within(partnerB).getByRole("button", { name: "安排 女方一" }),
    ).toBeInTheDocument();

    expect(within(shared).getByText("2 筆", { exact: true })).toBeInTheDocument();
    expect(within(shared).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("共同一"),
      expect.stringContaining("共同二"),
    ]);
    expect(within(shared).queryByText("男方一")).toBeNull();
    expect(
      within(shared).getByRole("button", { name: "調整 共同一 人數（1 位）" }),
    ).toBeInTheDocument();
    expect(
      within(shared).getByRole("button", { name: "安排 共同一" }),
    ).toBeInTheDocument();

    expect(container).not.toHaveTextContent("PARTNER_A");
    expect(container).not.toHaveTextContent("PARTNER_B");
    expect(container).not.toHaveTextContent("guest_a_1");
    // 男、女親友在夠寬時同列左右展示，共同親友獨佔下一列；未安排區在 lg
    // 版面只有 ~300px，兩欄會把每組壓到 150px 以下，所以窄的時候一律單欄。
    // 斷點必須是容器查詢：viewport 斷點量不到這一欄真正的寬度。
    const sideGrid = container.querySelector("[data-unassigned-side-grid]");
    expect(sideGrid).toHaveClass("grid-cols-1", "@lg:grid-cols-2", "min-w-0");
    expect(sideGrid).not.toHaveClass("sm:grid-cols-2");
    expect(container.querySelector('[data-unassigned-side="PARTNER_A"]')).not.toHaveClass(
      "@lg:col-span-2",
    );
    expect(container.querySelector('[data-unassigned-side="PARTNER_B"]')).not.toHaveClass(
      "@lg:col-span-2",
    );
    expect(container.querySelector('[data-unassigned-side="SHARED"]')).toHaveClass(
      "@lg:col-span-2",
    );
    // 內部排版要看欄寬而不是視窗寬。
    expect(
      container.querySelector('[aria-labelledby="unassigned-heading"]'),
    ).toHaveClass("@container");
    expect(
      screen
        .getByRole("region", { name: "未安排賓客" })
        .querySelector(".overflow-hidden"),
    ).toBeNull();
  });

  it("shows explicit empty states for the male and female groups without dropping shared guests", () => {
    render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[{ ...table, guests: [] }]}
        unassignedGuests={[
          unassigned({
            id: "guest_shared",
            name: "雙方好友",
            partySize: 2,
            side: "SHARED",
          }),
        ]}
        canEdit={false}
      />,
    );

    expect(
      within(screen.getByRole("region", { name: "男方親友" })).getByText(
        "目前沒有男方親友待安排。",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "女方親友" })).getByText(
        "目前沒有女方親友待安排。",
      ),
    ).toBeInTheDocument();
    const shared = screen.getByRole("region", { name: "共同親友" });
    expect(within(shared).getByText("雙方好友")).toBeInTheDocument();
    expect(within(shared).getByText("邀請人數 2 位")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows clear no-table and no-guest states", () => {
    const { container, rerender } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[]}
        unassignedGuests={[]}
        canEdit={false}
      />,
    );

    expect(screen.getByText("目前還沒有桌次。")).toBeInTheDocument();
    expect(screen.getByText("目前也沒有可安排的賓客。")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[]}
        unassignedGuests={[unassigned({ id: "guest_2", name: "林小美", partySize: 2 })]}
        canEdit
      />,
    );
    expect(
      screen.getByText("請先建立桌次，再安排未入席賓客。"),
    ).toBeInTheDocument();
    expect(screen.getByText("林小美")).toBeInTheDocument();
    // 沒有桌次可以安排時，人數仍然可以就地調整。
    expect(
      screen.getByRole("button", { name: "調整 林小美 人數（2 位）" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安排 林小美" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增桌次表單" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "桌數設定（目前 0 桌）" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("目前還沒有桌次。")).not.toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("shows assigned party totals, notes, guests, and empty tables", () => {
    render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[
          table,
          { ...table, id: "table_2", name: "親友桌", notes: null, guests: [] },
        ]}
        unassignedGuests={[]}
        canEdit={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "1 號桌 主桌" })).toBeInTheDocument();
    expect(screen.getByText("已安排 3 / 10 位")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByText("靠近舞台")).toBeInTheDocument();
    expect(screen.getByText("王小明・3 位")).toBeInTheDocument();
    const guestNotes = screen.getByText("備註：素食，需兒童椅 靠近走道");
    expect(guestNotes).toHaveClass("break-words", "whitespace-pre-wrap");
    expect(screen.getByText("這桌目前還沒安排賓客。")).toBeInTheDocument();
    expect(screen.getByText("所有賓客都已安排桌次。")).toBeInTheDocument();
  });

  it("keeps VIEWER read-only and hides internal ids", () => {
    const { container } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[table]}
        unassignedGuests={[unassigned({ id: "guest_2", name: "林小美", partySize: 2 })]}
        canEdit={false}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("workspace_internal");
    expect(container).not.toHaveTextContent("table_internal");
    expect(container).not.toHaveTextContent("guest_internal");
  });

  it("shows editor controls for tables, assigned guests, and unassigned guests", () => {
    const { container } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[table]}
        unassignedGuests={[unassigned({ id: "guest_2", name: "林小美", partySize: 2 })]}
        canEdit
      />,
    );

    // 已有桌次時，新增入口移到頁面標題列，不再出現在座位規劃內。
    expect(
      screen.queryByRole("button", { name: "新增桌次表單" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "桌數設定（目前 1 桌）" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編輯 1 號桌 主桌" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刪除 1 號桌 主桌" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移出 王小明" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安排 林小美" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "未安排賓客" })).getByText(
        "1 筆",
        { selector: '[aria-live="polite"]' },
      ),
    ).toHaveAttribute(
      "aria-live",
      "polite",
    );

    const queue = screen.getByRole("region", { name: "未安排賓客" });
    const floorPlan = screen.getByRole("region", { name: "宴會場地配置" });
    const tables = screen.getByRole("region", { name: "桌次明細" });
    expect(
      floorPlan.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      queue.compareDocumentPosition(tables) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 座位規劃內不再有任何展開式表單。
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector('[data-seating-layout="floor-plan-first"]')).toHaveClass(
      "lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2fr)]",
    );
  });

  it("uses the floor-plan selection to switch the editor inspector by table name", () => {
    render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[
          { ...table, guests: [] },
          {
            ...table,
            id: "table_friends",
            number: 2,
            name: "摯友桌",
            guests: [],
          },
        ]}
        unassignedGuests={[]}
        canEdit
      />,
    );

    const inspector = screen.getByRole("region", { name: "桌次明細" });
    expect(within(inspector).getByRole("heading", { name: "1 號桌 主桌" })).toBeInTheDocument();
    expect(
      within(inspector).queryByRole("heading", { name: "2 號桌 摯友桌" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "選取 摯友桌" }));
    expect(
      within(inspector).getByRole("heading", { name: "2 號桌 摯友桌" }),
    ).toBeInTheDocument();
    expect(within(inspector).queryByRole("heading", { name: "1 號桌 主桌" })).toBeNull();
  });

  it("announces and focuses a confirmed unassigned-to-assigned transition", async () => {
    const movingGuest = unassigned({ id: "guest_moving", name: "林小美", partySize: 2 });
    const emptyTable = { ...table, guests: [] };
    const { rerender } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[emptyTable]}
        unassignedGuests={[movingGuest]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "安排 林小美" }));
    expect(
      screen.queryByText("已將林小美安排至 1 號桌 主桌。", { exact: true }),
    ).not.toBeInTheDocument();

    rerender(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[{ ...emptyTable, guests: [movingGuest] }]}
        unassignedGuests={[]}
        canEdit
      />,
    );

    const status = screen.getByRole("status");
    await waitFor(() => {
      expect(status).toHaveTextContent("已將林小美安排至 1 號桌 主桌。");
      expect(status).toHaveFocus();
    });
  });

  it("announces an assignment without scrolling the page back to the status line", async () => {
    const movingGuest = unassigned({ id: "guest_moving", name: "林小美", partySize: 2 });
    const emptyTable = { ...table, guests: [] };
    const { rerender } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[emptyTable]}
        unassignedGuests={[movingGuest]}
        canEdit
      />,
    );
    // 狀態列在整頁最上方。安排完一筆賓客就把畫面捲回頂端，使用者得重新
    // 捲到剛才那一筆，未安排名單長的時候尤其難用。
    const focus = vi.spyOn(screen.getByRole("status"), "focus");

    fireEvent.click(screen.getByRole("button", { name: "安排 林小美" }));
    rerender(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[{ ...emptyTable, guests: [movingGuest] }]}
        unassignedGuests={[]}
        canEdit
      />,
    );

    await waitFor(() => expect(focus).toHaveBeenCalled());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("announces and focuses a confirmed assigned-to-unassigned transition", async () => {
    const { rerender } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[table]}
        unassignedGuests={[]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "移出 王小明" }));
    expect(
      screen.queryByText("已將王小明移出桌次。", { exact: true }),
    ).not.toBeInTheDocument();

    rerender(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[{ ...table, guests: [] }]}
        unassignedGuests={[unassigned(table.guests[0])]}
        canEdit
      />,
    );

    const status = screen.getByRole("status");
    await waitFor(() => {
      expect(status).toHaveTextContent("已將王小明移出桌次。");
      expect(status).toHaveFocus();
    });
  });

  it("does not announce success when refreshed props do not contain the move", () => {
    const movingGuest = unassigned({
      id: "guest_still_waiting",
      name: "陳小華",
      partySize: 2,
    });
    const emptyTable = { ...table, guests: [] };
    const { rerender } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[emptyTable]}
        unassignedGuests={[movingGuest]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "安排 陳小華" }));
    rerender(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[{ ...emptyTable, notes: "伺服器已重新整理" }]}
        unassignedGuests={[{ ...movingGuest }]}
        canEdit
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "桌次安排結果會顯示於此。",
    );
    expect(
      screen.queryByText("已將陳小華安排至主桌。", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it("announces and focuses a confirmed table deletion only after the row disappears", async () => {
    const emptyTable = { ...table, guests: [] };
    const { rerender } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[emptyTable]}
        unassignedGuests={[]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "刪除 1 號桌 主桌" }));
    rerender(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[{ ...emptyTable }]}
        unassignedGuests={[]}
        canEdit
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "桌次安排結果會顯示於此。",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "確認刪除空桌 1 號桌 主桌" }),
    );
    expect(
      screen.queryByText("已刪除空桌 1 號桌 主桌。", { exact: true }),
    ).not.toBeInTheDocument();

    rerender(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[]}
        unassignedGuests={[]}
        canEdit
      />,
    );

    const status = screen.getByRole("status");
    await waitFor(() => {
      expect(status).toHaveTextContent("已刪除空桌 1 號桌 主桌。");
      expect(status).toHaveFocus();
    });
    expect(
      screen.queryByRole("heading", { name: "1 號桌 主桌" }),
    ).not.toBeInTheDocument();
  });

  it("clears a rejected delete intent without announcing success", () => {
    const emptyTable = { ...table, guests: [] };
    const { rerender } = render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[emptyTable]}
        unassignedGuests={[]}
        canEdit
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "確認刪除空桌 1 號桌 主桌" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "刪除失敗 1 號桌 主桌" }));
    rerender(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[]}
        unassignedGuests={[]}
        canEdit
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "桌次安排結果會顯示於此。",
    );
    expect(
      screen.queryByText("已刪除空桌 1 號桌 主桌。", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it("does not expose the table-count adjustment entry to a VIEWER", () => {
    render(
      <SeatingPlan
        workspaceId="workspace_internal"
        tables={[table]}
        unassignedGuests={[]}
        canEdit={false}
      />,
    );

    expect(screen.queryByText(/桌數設定/u)).not.toBeInTheDocument();
  });
});
