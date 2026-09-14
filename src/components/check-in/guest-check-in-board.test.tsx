import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installModalDialogPolyfill } from "@/test/modal-dialog";

const {
  checkInGuestAction,
  updateGuestCheckInAction,
  cancelGuestCheckInAction,
} = vi.hoisted(() => ({
  checkInGuestAction: vi.fn(),
  updateGuestCheckInAction: vi.fn(),
  cancelGuestCheckInAction: vi.fn(),
}));

vi.mock("@/actions/guest-check-ins", () => ({
  checkInGuestAction,
  updateGuestCheckInAction,
  cancelGuestCheckInAction,
}));

import {
  GuestCheckInBoard,
  type GuestCheckInBoardGuest,
  type GuestCheckInBoardTable,
} from "./guest-check-in-board";

installModalDialogPolyfill();

const guests: GuestCheckInBoardGuest[] = [
  {
    id: "guest_pending",
    name: "王小明",
    category: "GUEST",
    side: "PARTNER_A",
    attendanceStatus: "ATTENDING",
    partySize: 4,
    notes: null,
    seatingTable: { number: 1, name: "主桌" },
    checkIn: null,
  },
  {
    id: "guest_arrived",
    name: "林小美",
    category: "GUEST",
    side: "PARTNER_B",
    attendanceStatus: "ATTENDING",
    partySize: 2,
    notes: null,
    seatingTable: { number: 2, name: "同學桌" },
    checkIn: {
      id: "check_in_arrived",
      headcount: 2,
      notes: "準時抵達",
      version: 1,
    },
  },
  {
    id: "guest_declined",
    name: "陳大同",
    category: "GUEST",
    side: "SHARED",
    attendanceStatus: "DECLINED",
    partySize: 1,
    notes: null,
    seatingTable: null,
    checkIn: null,
  },
];

const tables: GuestCheckInBoardTable[] = [
  {
    id: "table_1",
    number: 1,
    name: "主桌",
    capacity: 10,
    expectedHeadcount: 4,
    arrivedHeadcount: 0,
    pendingGroups: 1,
  },
  {
    id: "table_2",
    number: 2,
    name: "同學桌",
    capacity: 10,
    expectedHeadcount: 2,
    arrivedHeadcount: 2,
    pendingGroups: 0,
  },
];

function renderBoard(
  overrides: {
    guests?: GuestCheckInBoardGuest[];
    tables?: GuestCheckInBoardTable[];
    canEdit?: boolean;
  } = {},
) {
  return render(
    <GuestCheckInBoard
      workspaceId="workspace_1"
      guests={overrides.guests ?? guests}
      tables={overrides.tables ?? tables}
      canEdit={overrides.canEdit ?? true}
    />,
  );
}

function guestArticle(name: string) {
  return screen.getByRole("article", { name });
}

describe("GuestCheckInBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkInGuestAction.mockResolvedValue({
      status: "success",
      message: "已完成報到。",
      checkIn: {
        id: "check_in_new",
        headcount: 4,
        notes: null,
        version: 0,
      },
    });
    updateGuestCheckInAction.mockResolvedValue({
      status: "success",
      message: "已更新報到人數。",
      checkIn: {
        id: "check_in_arrived",
        headcount: 1,
        notes: null,
        version: 2,
      },
    });
    cancelGuestCheckInAction.mockResolvedValue({
      status: "success",
      message: "已取消報到。",
    });
  });

  it("separates expected attendance from what actually arrived", () => {
    renderBoard();

    expect(screen.getByText("實到人數").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("預計 6 位")).toBeInTheDocument();
    expect(screen.getByText("未報到組數").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("還有 4 位回覆出席未到")).toBeInTheDocument();
  });

  it("shows the invited party size on the one-tap check-in button", () => {
    renderBoard();

    expect(
      within(guestArticle("王小明")).getByRole("button", { name: "報到 4 位" }),
    ).toBeInTheDocument();
    expect(
      within(guestArticle("林小美")).getByText("實到 2 位"),
    ).toBeInTheDocument();
  });

  it("checks a guest in with the invited party size and updates the running total", async () => {
    renderBoard();

    fireEvent.click(
      within(guestArticle("王小明")).getByRole("button", { name: "報到 4 位" }),
    );

    await waitFor(() => {
      expect(checkInGuestAction).toHaveBeenCalledTimes(1);
    });
    const formData = checkInGuestAction.mock.calls[0]?.[3] as FormData;
    expect(formData.get("headcount")).toBe("4");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已完成報到。");
    });
    expect(screen.getByText("實到人數").nextSibling).toHaveTextContent("6");
    expect(
      within(guestArticle("王小明")).getByText("實到 4 位"),
    ).toBeInTheDocument();
  });

  it("submits an adjusted head count with the expected version", async () => {
    renderBoard();

    fireEvent.click(
      within(guestArticle("林小美")).getByRole("button", { name: "調整人數" }),
    );
    const form = await screen.findByRole("form", {
      name: "調整 林小美 的報到人數表單",
    });
    fireEvent.change(within(form).getByLabelText("實際到場人數"), {
      target: { value: "1" },
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(updateGuestCheckInAction).toHaveBeenCalledTimes(1);
    });
    expect(updateGuestCheckInAction.mock.calls[0]?.[0]).toBe("workspace_1");
    expect(updateGuestCheckInAction.mock.calls[0]?.[1]).toBe("check_in_arrived");
    const formData = updateGuestCheckInAction.mock.calls[0]?.[3] as FormData;
    expect(formData.get("headcount")).toBe("1");
    expect(formData.get("expectedVersion")).toBe("1");
  });

  it("defaults the adjust dialog to the invited party size for a guest who has not arrived", async () => {
    renderBoard();

    fireEvent.click(
      within(guestArticle("王小明")).getByRole("button", { name: "其他人數" }),
    );
    const form = await screen.findByRole("form", { name: "為 王小明 報到表單" });
    expect(within(form).getByLabelText("實際到場人數")).toHaveValue(4);
    expect(within(form).queryByDisplayValue("0")).not.toBeInTheDocument();
  });

  it("cancels a check-in with the expected version and restores the pending count", async () => {
    renderBoard();

    fireEvent.click(
      within(guestArticle("林小美")).getByRole("button", { name: "取消報到" }),
    );
    const form = await screen.findByRole("form", {
      name: "取消 林小美 的報到表單",
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(cancelGuestCheckInAction).toHaveBeenCalledTimes(1);
    });
    const formData = cancelGuestCheckInAction.mock.calls[0]?.[3] as FormData;
    expect(formData.get("expectedVersion")).toBe("1");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已取消報到。");
    });
    expect(screen.getByText("實到人數").nextSibling).toHaveTextContent("0");
    expect(screen.getByText("未報到組數").nextSibling).toHaveTextContent("2");
  });

  it("keeps a just-saved check-in visible while stale RSC props still show nothing", async () => {
    const { rerender } = renderBoard();

    fireEvent.click(
      within(guestArticle("王小明")).getByRole("button", { name: "報到 4 位" }),
    );
    await waitFor(() => {
      expect(
        within(guestArticle("王小明")).getByText("實到 4 位"),
      ).toBeInTheDocument();
    });

    // 舊 payload 已經帶著同一筆較低版本回來，不能把剛存成功的結果蓋掉。
    rerender(
      <GuestCheckInBoard
        workspaceId="workspace_1"
        guests={guests.map((guest) =>
          guest.id === "guest_pending"
            ? {
                ...guest,
                checkIn: {
                  id: "check_in_new",
                  headcount: 4,
                  notes: null,
                  version: 0,
                },
              }
            : guest,
        )}
        tables={tables}
        canEdit
      />,
    );

    await waitFor(() => {
      expect(
        within(guestArticle("王小明")).getByText("實到 4 位"),
      ).toBeInTheDocument();
    });
  });

  it("yields to a collaborator who changed the same check-in afterwards", async () => {
    const { rerender } = renderBoard();

    fireEvent.click(
      within(guestArticle("王小明")).getByRole("button", { name: "報到 4 位" }),
    );
    await waitFor(() => {
      expect(
        within(guestArticle("王小明")).getByText("實到 4 位"),
      ).toBeInTheDocument();
    });

    rerender(
      <GuestCheckInBoard
        workspaceId="workspace_1"
        guests={guests.map((guest) =>
          guest.id === "guest_pending"
            ? {
                ...guest,
                checkIn: {
                  id: "check_in_new",
                  headcount: 2,
                  notes: null,
                  version: 1,
                },
              }
            : guest,
        )}
        tables={tables}
        canEdit
      />,
    );

    await waitFor(() => {
      expect(
        within(guestArticle("王小明")).getByText("實到 2 位"),
      ).toBeInTheDocument();
    });
  });

  it("filters by check-in state and by name", () => {
    renderBoard();

    fireEvent.click(screen.getByRole("radio", { name: /未報到/u }));
    expect(screen.queryByRole("article", { name: "林小美" })).toBeNull();
    expect(guestArticle("王小明")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜尋報到名單"), {
      target: { value: "陳" },
    });
    expect(screen.queryByRole("article", { name: "王小明" })).toBeNull();
    expect(guestArticle("陳大同")).toBeInTheDocument();
  });

  it("rolls up arrival against expectation per table behind a collapsed panel", () => {
    renderBoard();

    const toggle = screen.getByRole("button", { name: "展開逐桌對照" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "收合逐桌對照" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("第 1 桌 主桌")).toBeInTheDocument();
    expect(screen.getByText("1 組未到")).toBeInTheDocument();
    expect(screen.getByText("全數到齊")).toBeInTheDocument();
  });

  it("says a declined guest needs no seat instead of pretending a table is missing", () => {
    renderBoard();

    expect(
      within(guestArticle("陳大同")).getByText(/不需安排座位/u),
    ).toBeInTheDocument();
  });

  it("gives a viewer no check-in controls at all", () => {
    renderBoard({ canEdit: false });

    expect(screen.queryByRole("button", { name: /報到 \d+ 位/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "調整人數" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消報到" })).toBeNull();
    expect(screen.getByText("實到 2 位")).toBeInTheDocument();
  });

  it("explains an empty guest list instead of showing a bare zero", () => {
    renderBoard({ guests: [], tables: [] });

    expect(screen.getByText("報到名單目前沒有賓客。")).toBeInTheDocument();
    expect(screen.queryByText("逐桌實到對照")).toBeNull();
  });

  it("surfaces a failed quick check-in without claiming success", async () => {
    checkInGuestAction.mockResolvedValue({
      status: "error",
      code: "STALE",
      message: "報到資料已更新、已建立或不存在，請重新整理後再試。",
    });
    renderBoard();

    fireEvent.click(
      within(guestArticle("王小明")).getByRole("button", { name: "報到 4 位" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "報到資料已更新、已建立或不存在，請重新整理後再試。",
      );
    });
    expect(
      within(guestArticle("王小明")).getByText("尚未報到"),
    ).toBeInTheDocument();
  });
});
