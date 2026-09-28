import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { installModalDialogPolyfill } from "@/test/modal-dialog";

vi.mock("@/actions/seating-scenarios", () => {
  const action = vi.fn(async () => ({ status: "idle" }));
  return {
    addScenarioTableAction: action,
    applySeatingScenarioAction: action,
    createSeatingScenarioAction: action,
    deleteSeatingScenarioAction: action,
    removeScenarioTableAction: action,
    renameSeatingScenarioAction: action,
    seatScenarioGuestAction: action,
    updateScenarioTableAction: action,
  };
});

import { SeatingScenarioEditor, type SeatingScenarioDetail } from "./seating-scenarios";

installModalDialogPolyfill();

function detail(overrides: Partial<SeatingScenarioDetail["preview"]> = {}): SeatingScenarioDetail {
  return {
    role: "PARTNER",
    canEdit: true,
    workspaceName: "我們的婚宴",
    scenario: {
      id: "scenario_1",
      name: "王家全到",
      kind: "DRAFT",
      version: 4,
      updatedAt: "2026-09-23T10:00:00.000Z",
      liveChangedSinceCopy: false,
    },
    tables: [
      {
        id: "t1",
        number: 1,
        name: "主桌",
        capacity: 10,
        notes: null,
        seatedHeadcount: 10,
        differsFromLive: false,
        addedInScenario: false,
        guests: [{ id: "g1", name: "陳家親友", partySize: 10, attendanceStatus: "ATTENDING", side: "PARTNER_A" }],
      },
      {
        id: "t2",
        number: 2,
        name: "王家二",
        capacity: 8,
        notes: null,
        seatedHeadcount: 2,
        differsFromLive: true,
        addedInScenario: true,
        guests: [{ id: "g2", name: "王小明", partySize: 2, attendanceStatus: "UNDECIDED", side: "PARTNER_B" }],
      },
    ],
    unseated: [
      { id: "g3", name: "林阿姨", partySize: 2, attendanceStatus: "ATTENDING", side: "SHARED" },
      { id: "g4", name: "李大華", partySize: 1, attendanceStatus: "DECLINED", side: "SHARED" },
    ],
    assumptions: [{ guestId: "g2", name: "王小明", attendanceStatus: "UNDECIDED", toNumber: 2 }],
    preview: {
      moved: [{ guestId: "g5", name: "社團學長", fromNumber: 2, toNumber: 3 }],
      newlySeated: [{ guestId: "g2", name: "王小明", toNumber: 2 }],
      unseated: [],
      willNotSeat: [{ guestId: "g4", name: "李大華", toNumber: 2 }],
      addedTableCount: 1,
      removedTableCount: 0,
      changedTables: [],
      overCapacity: [],
      canApply: true,
      hasChanges: true,
      ...overrides,
    },
    liveFingerprint: "b".repeat(64),
  } as SeatingScenarioDetail;
}

function openApplyDialog() {
  fireEvent.click(screen.getByRole("button", { name: "套用為正式安排" }));
  return screen.getByRole("dialog", { name: "把「王家全到」套用為正式安排？" });
}

describe("SeatingScenarioEditor", () => {

  it("把會出席的未入座賓客列在前面，不出席的收起來", () => {
    render(<SeatingScenarioEditor workspaceId="workspace_1" detail={detail()} />);

    const unseated = screen.getByRole("heading", { name: "未入座" }).closest("section")!;
    expect(within(unseated).getByText("林阿姨")).toBeVisible();
    expect(within(unseated).getByText("不出席的賓客 1 組")).toBeInTheDocument();
    expect(screen.getByText("未回覆 → 坐第 2 桌")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "第 2 桌 · 王家二" })).toBeInTheDocument();
  });

  it("確認框列出換桌、新增桌次與不會入座的人，並帶上看過的正式安排指紋", () => {
    const { container } = render(<SeatingScenarioEditor workspaceId="workspace_1" detail={detail()} />);

    const dialog = openApplyDialog();
    expect(within(dialog).getByText("社團學長 第 2 → 3 桌")).toBeInTheDocument();
    expect(within(dialog).getByText("新增桌次")).toBeInTheDocument();
    expect(within(dialog).getByText("不會入座")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "確認套用" })).toBeEnabled();
    expect(
      container.querySelector<HTMLInputElement>('input[name="expectedLiveFingerprint"]')?.value,
    ).toBe("b".repeat(64));
  });

  it("有桌次超過座位時不能套用", () => {
    render(
      <SeatingScenarioEditor
        workspaceId="workspace_1"
        detail={detail({ canApply: false, overCapacity: [{ number: 1, name: "主桌", capacity: 10, seated: 12 }] })}
      />,
    );

    const dialog = openApplyDialog();
    expect(within(dialog).getByText(/超過座位，請先在方案裡調整/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "確認套用" })).toBeDisabled();
  });

  it("唯讀成員看不到套用與編輯", () => {
    render(<SeatingScenarioEditor workspaceId="workspace_1" detail={{ ...detail(), canEdit: false }} />);

    expect(screen.queryByRole("button", { name: "套用為正式安排" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加開一桌" })).not.toBeInTheDocument();
  });
});
