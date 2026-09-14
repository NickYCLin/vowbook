import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installModalDialogPolyfill } from "@/test/modal-dialog";

const {
  createWeddingGiftAction,
  updateWeddingGiftAction,
  deleteWeddingGiftAction,
  setGuestGiftExemptionAction,
  setWeddingGiftReturnAction,
} = vi.hoisted(() => ({
  createWeddingGiftAction: vi.fn(),
  updateWeddingGiftAction: vi.fn(),
  deleteWeddingGiftAction: vi.fn(),
  setGuestGiftExemptionAction: vi.fn(),
  setWeddingGiftReturnAction: vi.fn(),
}));

vi.mock("@/actions/wedding-gifts", () => ({
  createWeddingGiftAction,
  updateWeddingGiftAction,
  deleteWeddingGiftAction,
  setGuestGiftExemptionAction,
  setWeddingGiftReturnAction,
}));

import { WeddingGiftBook } from "./wedding-gift-book";

installModalDialogPolyfill();

const guests = [
  {
    id: "guest_recorded",
    name: "王小明",
    category: "GUEST" as const,
    side: "PARTNER_A" as const,
    attendanceStatus: "ATTENDING" as const,
    weddingGift: {
      id: "gift_recorded",
      amount: 1_200,
      notes: "由爸爸代收",
      createdAt: new Date("2026-08-30T02:00:00.000Z"),
      returnGiftSentAt: null,
      returnGiftNote: null,
      version: 3,
    },
  },
  {
    id: "guest_declined",
    name: "林小美",
    category: "GUEST" as const,
    side: "PARTNER_B" as const,
    attendanceStatus: "DECLINED" as const,
    weddingGift: null,
  },
  {
    id: "guest_host",
    name: "陳新郎",
    category: "COUPLE" as const,
    side: "PARTNER_A" as const,
    attendanceStatus: "ATTENDING" as const,
    weddingGift: null,
  },
  {
    id: "guest_family_recorded",
    name: "陳媽媽",
    category: "FAMILY" as const,
    side: "PARTNER_A" as const,
    attendanceStatus: "ATTENDING" as const,
    weddingGift: {
      id: "gift_family",
      amount: 2_300,
      notes: null,
      createdAt: new Date("2026-08-30T02:00:00.000Z"),
      returnGiftSentAt: null,
      returnGiftNote: null,
      version: 1,
    },
  },
];

function expandBook() {
  fireEvent.click(screen.getByRole("button", { name: "展開禮金簿" }));
}

describe("WeddingGiftBook", () => {
  beforeEach(() => {
    createWeddingGiftAction.mockReset();
    updateWeddingGiftAction.mockReset();
    deleteWeddingGiftAction.mockReset();
    setWeddingGiftReturnAction.mockReset();
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("keeps the ledger anchor and zero summary before any guest is added", () => {
    const { container } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={[]}
        canEdit
      />,
    );

    expect(container.querySelector("#gift-ledger")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "禮金簿" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展開禮金簿" }));
    expect(screen.getByText("禮金簿目前沒有邀請群組。"))
      .toBeInTheDocument();
    expect(screen.getByText("先新增名單後即可登記禮金。"))
      .toBeInTheDocument();
  });

  const returnGuests = [
    {
      id: "guest_attended",
      name: "王小明",
      category: "GUEST" as const,
      side: "PARTNER_A" as const,
      attendanceStatus: "ATTENDING" as const,
      checkIn: { id: "check_in_1" },
      weddingGift: {
        id: "gift_attended",
        amount: 3600,
        notes: null,
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 0,
      },
    },
    {
      id: "guest_declined_with_gift",
      name: "林小美",
      category: "GUEST" as const,
      side: "PARTNER_B" as const,
      attendanceStatus: "DECLINED" as const,
      checkIn: null,
      weddingGift: {
        id: "gift_declined",
        amount: 12000,
        notes: null,
        createdAt: new Date("2026-08-30T03:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 2,
      },
    },
    {
      id: "guest_no_show",
      name: "陳大同",
      category: "GUEST" as const,
      side: "SHARED" as const,
      attendanceStatus: "DECLINED" as const,
      checkIn: null,
      weddingGift: {
        id: "gift_no_show",
        amount: 6000,
        notes: null,
        createdAt: new Date("2026-08-30T01:00:00.000Z"),
        returnGiftSentAt: new Date("2026-09-05T02:00:00.000Z"),
        returnGiftNote: "寄了 2 盒喜餅",
        version: 1,
      },
    },
    {
      id: "guest_no_gift",
      name: "張三",
      category: "GUEST" as const,
      side: "SHARED" as const,
      attendanceStatus: "DECLINED" as const,
      checkIn: null,
      weddingGift: null,
    },
  ];

  function ledgerNames() {
    return screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
  }

  it("sorts the ledger without changing which groups are listed", () => {
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={returnGuests}
        canEdit
        collapsible={false}
      />,
    );

    expect(ledgerNames()).toEqual(["王小明", "林小美", "陳大同", "張三"]);

    const sortSelect = screen.getByLabelText("禮金簿排序");
    fireEvent.change(sortSelect, { target: { value: "AMOUNT_DESC" } });
    expect(ledgerNames()).toEqual(["林小美", "陳大同", "王小明", "張三"]);

    fireEvent.change(sortSelect, { target: { value: "AMOUNT_ASC" } });
    expect(ledgerNames()).toEqual(["王小明", "陳大同", "林小美", "張三"]);

    fireEvent.change(sortSelect, { target: { value: "RECENT" } });
    expect(ledgerNames()).toEqual(["林小美", "王小明", "陳大同", "張三"]);

    fireEvent.change(sortSelect, { target: { value: "NAME" } });
    expect(ledgerNames()).toEqual(["王小明", "林小美", "張三", "陳大同"]);
  });

  it("does not mistake attending or undecided guests awaiting check-in for absentees", () => {
    render(<WeddingGiftBook workspaceId="workspace_1" canEdit collapsible={false}
      guests={[
        { ...returnGuests[0], checkIn: null },
        { ...returnGuests[1], attendanceStatus: "UNDECIDED", checkIn: null },
        { ...returnGuests[2], attendanceStatus: "DECLINED", checkIn: { id: "arrived" } },
      ]} />);
    expect(screen.queryByText(/禮到人不到・/)).not.toBeInTheDocument();
    expect(screen.getByText("待回禮").nextSibling).toHaveTextContent("0");
    expect(screen.queryByRole("button", { name: "標記已回禮" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("禮金登記狀態篩選"), {
      target: { value: "WITHOUT_ATTENDANCE" },
    });
    expect(screen.getByText("找不到符合條件的邀請群組。")).toBeInTheDocument();
  });

  it("filters to gifts from explicitly declined guests and counts pending returns", () => {
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={returnGuests}
        canEdit
        collapsible={false}
      />,
    );

    // 陳大同 已回禮，所以待回禮只剩 林小美。
    expect(screen.getByText("待回禮").nextSibling).toHaveTextContent("1");

    fireEvent.change(screen.getByLabelText("禮金登記狀態篩選"), {
      target: { value: "WITHOUT_ATTENDANCE" },
    });
    expect(ledgerNames()).toEqual(["林小美", "陳大同"]);
    expect(
      screen.getByText("禮到人不到・待回禮回喜餅"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("禮到人不到・已回禮（寄了 2 盒喜餅）"),
    ).toBeInTheDocument();
  });

  it("marks a return gift as sent with the gift CAS token and no client timestamp", async () => {
    setWeddingGiftReturnAction.mockResolvedValue({
      status: "success",
      message: "已標記為已回禮。",
      gift: {
        id: "gift_declined",
        amount: 12000,
        notes: null,
        returnGiftSentAt: new Date("2026-09-06T02:00:00.000Z"),
        returnGiftNote: null,
        version: 3,
      },
    });
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={returnGuests}
        canEdit
        collapsible={false}
      />,
    );

    fireEvent.submit(
      screen.getByRole("form", { name: "標記 林小美 已回禮表單" }),
    );

    await waitFor(() =>
      expect(setWeddingGiftReturnAction).toHaveBeenCalledOnce(),
    );
    expect(setWeddingGiftReturnAction.mock.calls[0]?.[0]).toBe("workspace_1");
    expect(setWeddingGiftReturnAction.mock.calls[0]?.[1]).toBe("gift_declined");
    const formData = setWeddingGiftReturnAction.mock.calls[0]?.[3] as FormData;
    expect(formData.get("expectedVersion")).toBe("2");
    expect(formData.get("returnGiftSent")).toBe("on");
    // 回禮時間一律由 server 決定，表單不得夾帶。
    expect(formData.get("returnGiftSentAt")).toBeNull();

    await waitFor(() => {
      expect(screen.getByText("待回禮").nextSibling).toHaveTextContent("0");
    });
  });

  it("offers to undo a return gift that was already marked as sent", async () => {
    setWeddingGiftReturnAction.mockResolvedValue({
      status: "success",
      message: "已改回尚未回禮。",
      gift: {
        id: "gift_no_show",
        amount: 6000,
        notes: null,
        returnGiftSentAt: null,
        returnGiftNote: "寄了 2 盒喜餅",
        version: 2,
      },
    });
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={returnGuests}
        canEdit
        collapsible={false}
      />,
    );

    fireEvent.submit(
      screen.getByRole("form", { name: "改回 陳大同 尚未回禮表單" }),
    );

    await waitFor(() =>
      expect(setWeddingGiftReturnAction).toHaveBeenCalledOnce(),
    );
    const formData = setWeddingGiftReturnAction.mock.calls[0]?.[3] as FormData;
    expect(formData.get("returnGiftSent")).toBeNull();
    expect(formData.get("returnGiftNote")).toBe("寄了 2 盒喜餅");

    await waitFor(() => {
      expect(screen.getByText("待回禮").nextSibling).toHaveTextContent("2");
    });
  });

  it("gives a viewer no return-gift controls", () => {
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={returnGuests}
        canEdit={false}
        collapsible={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "標記已回禮" })).toBeNull();
    expect(screen.queryByRole("button", { name: "改回未回禮" })).toBeNull();
    expect(screen.getByText("禮到人不到・待回禮回喜餅")).toBeInTheDocument();
  });

  it("keeps the collapsed aria-controls target mounted", () => {
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );

    const toggle = screen.getByRole("button", { name: "展開禮金簿" });
    const contentId = toggle.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();
    const content = document.getElementById(contentId!);
    expect(content).toBeInTheDocument();
    expect(content).not.toBeVisible();

    fireEvent.click(toggle);
    expect(content).toBeVisible();
  });

  it("automatically expands when opened through the overview deep link", async () => {
    window.history.replaceState(null, "", "#gift-ledger");
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit={false}
      />,
    );

    expect(await screen.findByLabelText("搜尋禮金簿名單"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收合禮金簿" }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("summarizes gifts without treating hosts as general guests without records", () => {
    const { container } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );

    const total = screen.getByText("禮金總額").closest("div");
    expect(total).not.toBeNull();
    expect(within(total as HTMLElement).getByText(/3,500/u)).toBeInTheDocument();

    const recorded = screen.getByText("已登記組數").closest("div");
    expect(recorded).not.toBeNull();
    expect(within(recorded as HTMLElement).getByText("2")).toBeInTheDocument();

    const missing = screen.getByText("一般賓客未有紀錄").closest("div");
    expect(missing).not.toBeNull();
    expect(within(missing as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/新人與家人不列入「一般賓客未有紀錄」統計/u))
      .toBeInTheDocument();
    expect(screen.getByText("僅表示目前沒有紀錄，不代表應送禮。"))
      .toBeInTheDocument();
    expect(container.querySelector("#gift-ledger")).toBeInTheDocument();
  });

  it("searches and filters invitation groups while retaining recorded host gifts", () => {
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();

    expect(screen.getByText("顯示 4 / 4 組")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("禮金登記狀態篩選"), {
      target: { value: "RECORDED" },
    });
    expect(screen.getByRole("heading", { name: "王小明" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "陳媽媽" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "林小美" }))
      .not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("禮金登記狀態篩選"), {
      target: { value: "UNRECORDED_GENERAL" },
    });
    expect(screen.getByRole("heading", { name: "林小美" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "陳新郎" }))
      .not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜尋禮金簿名單"), {
      target: { value: " 不存在 " },
    });
    expect(screen.getByText("找不到符合條件的邀請群組。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除禮金簿篩選" }));
    expect(screen.getByText("顯示 4 / 4 組")).toBeInTheDocument();
  });

  it("allows a declined general guest to receive a gift entry", () => {
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();

    const row = screen.getByRole("heading", { name: "林小美" }).closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("不出席"))
      .toBeInTheDocument();
    expect(
      within(row as HTMLElement).getByRole("button", {
        name: "登記 林小美 的禮金",
      }),
    ).toBeInTheDocument();
  });

  it("lets an editor create a positive-integer gift with optional notes", async () => {
    createWeddingGiftAction.mockResolvedValue({
      status: "success",
      message: "已登記禮金。",
      gift: {
        id: "gift_created",
        amount: 3600,
        notes: "由朋友代收",
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 0,
      },
    });
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();

    fireEvent.click(
      screen.getByRole("button", { name: "登記 林小美 的禮金" }),
    );
    const dialog = screen.getByRole("dialog", { name: "登記 林小美 的禮金" });
    const amount = within(dialog).getByLabelText("禮金金額");
    expect(amount).toHaveAttribute("min", "1");
    expect(amount).toHaveAttribute("max", "2147483647");
    expect(amount).toHaveAttribute("step", "1");
    expect(amount).toHaveAttribute("inputmode", "numeric");
    expect(within(dialog).getByLabelText("備註（選填）"))
      .toHaveAttribute("maxlength", "500");

    fireEvent.change(amount, { target: { value: "3600" } });
    fireEvent.change(within(dialog).getByLabelText("備註（選填）"), {
      target: { value: "由朋友代收" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存禮金" }));

    await waitFor(() => expect(createWeddingGiftAction).toHaveBeenCalledOnce());
    const [workspaceId, guestId, , formData] =
      createWeddingGiftAction.mock.calls[0];
    expect(workspaceId).toBe("workspace_1");
    expect(guestId).toBe("guest_declined");
    expect((formData as FormData).get("amount")).toBe("3600");
    expect((formData as FormData).get("notes")).toBe("由朋友代收");
    expect(screen.getByRole("status")).toHaveTextContent("已登記禮金。");
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "登記 林小美 的禮金" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編輯 林小美 的禮金" }))
      .toBeInTheDocument();
  });

  it("submits CAS tokens when editing and removing an existing gift", async () => {
    updateWeddingGiftAction.mockResolvedValue({
      status: "success",
      message: "已更新禮金。",
      gift: {
        id: "gift_recorded",
        amount: 1200,
        notes: "由爸爸代收",
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 4,
      },
    });
    deleteWeddingGiftAction.mockResolvedValue({
      status: "success",
      message: "已移除禮金。",
    });
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();

    fireEvent.click(
      screen.getByRole("button", { name: "編輯 王小明 的禮金" }),
    );
    const editDialog = screen.getByRole("dialog", {
      name: "編輯 王小明 的禮金",
    });
    expect(within(editDialog).getByLabelText("禮金金額")).toHaveValue(1200);
    expect(within(editDialog).getByLabelText("備註（選填）"))
      .toHaveValue("由爸爸代收");
    fireEvent.click(
      within(editDialog).getByRole("button", { name: "儲存變更" }),
    );
    await waitFor(() => expect(updateWeddingGiftAction).toHaveBeenCalledOnce());
    const updateFormData = updateWeddingGiftAction.mock.calls[0]?.[3] as FormData;
    expect(updateWeddingGiftAction.mock.calls[0]?.slice(0, 2)).toEqual([
      "workspace_1",
      "gift_recorded",
    ]);
    expect(updateFormData.get("expectedVersion")).toBe("3");

    fireEvent.click(
      screen.getByRole("button", { name: "移除 王小明 的禮金" }),
    );
    const deleteDialog = screen.getByRole("dialog", {
      name: "移除 王小明 的禮金",
    });
    fireEvent.click(
      within(deleteDialog).getByRole("button", { name: "確認移除禮金" }),
    );
    await waitFor(() => expect(deleteWeddingGiftAction).toHaveBeenCalledOnce());
    const deleteFormData = deleteWeddingGiftAction.mock.calls[0]?.[3] as FormData;
    expect(deleteWeddingGiftAction.mock.calls[0]?.slice(0, 2)).toEqual([
      "workspace_1",
      "gift_recorded",
    ]);
    expect(deleteFormData.get("expectedVersion")).toBe("4");
    expect(screen.queryByRole("button", { name: "移除 王小明 的禮金" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登記 王小明 的禮金" }))
      .toBeInTheDocument();
  });

  it("keeps the delete token frozen when refreshed props contain a newer gift", async () => {
    const { container, rerender } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "移除 王小明 的禮金" }),
    );

    rerender(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests.map((guest) =>
          guest.id === "guest_recorded"
            ? {
                ...guest,
                weddingGift: {
                  ...guest.weddingGift!,
                  amount: 9_000,
                  notes: "協作者較新的內容",
                  version: 4,
                },
              }
            : guest,
        )}
        canEdit
      />,
    );

    const deleteDialog = screen.getByRole("dialog", {
      name: "移除 王小明 的禮金",
    });
    expect(within(deleteDialog).getByText(/已在其他地方更新或移除/u))
      .toBeInTheDocument();
    expect(
      container.querySelector(
        'dialog input[name="expectedVersion"][value="3"]',
      ),
    ).toBeInTheDocument();

    expect(
      within(deleteDialog).getByRole("button", { name: "確認移除禮金" }),
    ).toBeDisabled();
    expect(deleteWeddingGiftAction).not.toHaveBeenCalled();
  });

  it("keeps a dirty edit draft visible but blocks submission after an authoritative delete", async () => {
    const { rerender } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 王小明 的禮金" }),
    );
    let dialog = screen.getByRole("dialog", { name: "編輯 王小明 的禮金" });
    fireEvent.change(within(dialog).getByLabelText("禮金金額"), {
      target: { value: "8888" },
    });
    fireEvent.change(within(dialog).getByLabelText("備註（選填）"), {
      target: { value: "尚未送出的草稿" },
    });

    rerender(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests.map((guest) =>
          guest.id === "guest_recorded"
            ? { ...guest, weddingGift: null }
            : guest,
        )}
        canEdit
      />,
    );

    dialog = screen.getByRole("dialog", { name: "編輯 王小明 的禮金" });
    expect(within(dialog).getByLabelText("禮金金額")).toHaveValue(8888);
    expect(within(dialog).getByLabelText("備註（選填）"))
      .toHaveValue("尚未送出的草稿");
    expect(within(dialog).getByText(/已由其他人移除/u)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "儲存變更" }))
      .toBeDisabled();
    fireEvent.submit(
      within(dialog).getByRole("form", { name: "編輯 王小明 的禮金表單" }),
    );
    expect(updateWeddingGiftAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "編輯 王小明 的禮金" }))
        .not.toBeInTheDocument(),
    );
  });

  it("allows editing an own newly created gift before refreshed props arrive", async () => {
    createWeddingGiftAction.mockResolvedValueOnce({
      status: "success",
      message: "已登記禮金。",
      gift: {
        id: "gift_created",
        amount: 3600,
        notes: "自己的新紀錄",
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 0,
      },
    });
    updateWeddingGiftAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新禮金。",
      gift: {
        id: "gift_created",
        amount: 6600,
        notes: "自己的新紀錄",
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 1,
      },
    });
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "登記 林小美 的禮金" }),
    );
    let dialog = screen.getByRole("dialog", { name: "登記 林小美 的禮金" });
    fireEvent.change(within(dialog).getByLabelText("禮金金額"), {
      target: { value: "3600" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存禮金" }));
    await waitFor(() => expect(createWeddingGiftAction).toHaveBeenCalledOnce());

    fireEvent.click(
      screen.getByRole("button", { name: "編輯 林小美 的禮金" }),
    );
    dialog = screen.getByRole("dialog", { name: "編輯 林小美 的禮金" });
    expect(within(dialog).queryByText(/已由其他人移除/u))
      .not.toBeInTheDocument();
    const saveButton = within(dialog).getByRole("button", {
      name: "儲存變更",
    });
    expect(saveButton).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText("禮金金額"), {
      target: { value: "6600" },
    });
    fireEvent.click(saveButton);
    await waitFor(() => expect(updateWeddingGiftAction).toHaveBeenCalledOnce());
    const formData = updateWeddingGiftAction.mock.calls[0]?.[3] as FormData;
    expect(formData.get("expectedVersion")).toBe("0");
  });

  it("drops a newly created local gift when the next authoritative props still have no gift", async () => {
    createWeddingGiftAction.mockResolvedValueOnce({
      status: "success",
      message: "已登記禮金。",
      gift: {
        id: "gift_created",
        amount: 3600,
        notes: "自己的新紀錄",
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 0,
      },
    });
    const { rerender } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "登記 林小美 的禮金" }),
    );
    let dialog = screen.getByRole("dialog", { name: "登記 林小美 的禮金" });
    fireEvent.change(within(dialog).getByLabelText("禮金金額"), {
      target: { value: "3600" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存禮金" }));
    await waitFor(() => expect(createWeddingGiftAction).toHaveBeenCalledOnce());

    fireEvent.click(
      screen.getByRole("button", { name: "編輯 林小美 的禮金" }),
    );
    dialog = screen.getByRole("dialog", { name: "編輯 林小美 的禮金" });
    fireEvent.change(within(dialog).getByLabelText("備註（選填）"), {
      target: { value: "尚未送出的草稿" },
    });

    rerender(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests.map((guest) => ({ ...guest }))}
        canEdit
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "登記 林小美 的禮金" }),
      ).toBeInTheDocument(),
    );
    dialog = screen.getByRole("dialog", { name: "編輯 林小美 的禮金" });
    expect(within(dialog).getByLabelText("備註（選填）"))
      .toHaveValue("尚未送出的草稿");
    expect(within(dialog).getByText(/已由其他人移除/u)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "儲存變更" }))
      .toBeDisabled();
    expect(screen.getByText(/3,500/u)).toBeInTheDocument();
  });

  it("keeps a create draft visible but blocks submission after the guest is removed", () => {
    const { rerender } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "登記 林小美 的禮金" }),
    );
    let dialog = screen.getByRole("dialog", { name: "登記 林小美 的禮金" });
    fireEvent.change(within(dialog).getByLabelText("禮金金額"), {
      target: { value: "3600" },
    });
    fireEvent.change(within(dialog).getByLabelText("備註（選填）"), {
      target: { value: "尚未送出的草稿" },
    });

    rerender(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests.filter((guest) => guest.id !== "guest_declined")}
        canEdit
      />,
    );

    dialog = screen.getByRole("dialog", { name: "登記 林小美 的禮金" });
    expect(within(dialog).getByLabelText("禮金金額")).toHaveValue(3600);
    expect(within(dialog).getByLabelText("備註（選填）"))
      .toHaveValue("尚未送出的草稿");
    expect(within(dialog).getByText(/賓客已由其他人移除/u))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "儲存禮金" }))
      .toBeDisabled();
    fireEvent.submit(
      within(dialog).getByRole("form", { name: "登記 林小美 的禮金表單" }),
    );
    expect(createWeddingGiftAction).not.toHaveBeenCalled();
  });

  it("uses the incremented edit token before refreshed props arrive", async () => {
    updateWeddingGiftAction
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新禮金。",
        gift: {
          id: "gift_recorded",
          amount: 1800,
          notes: "自己的已儲存內容",
          createdAt: new Date("2026-08-30T02:00:00.000Z"),
          returnGiftSentAt: null,
          returnGiftNote: null,
          version: 4,
        },
      })
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新禮金。",
        gift: {
          id: "gift_recorded",
          amount: 1800,
          notes: "自己的已儲存內容",
          createdAt: new Date("2026-08-30T02:00:00.000Z"),
          returnGiftSentAt: null,
          returnGiftNote: null,
          version: 5,
        },
      });
    const { container } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 王小明 的禮金" }),
    );
    let dialog = screen.getByRole("dialog", { name: "編輯 王小明 的禮金" });
    fireEvent.change(within(dialog).getByLabelText("禮金金額"), {
      target: { value: "1800" },
    });
    fireEvent.change(within(dialog).getByLabelText("備註（選填）"), {
      target: { value: "自己的已儲存內容" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(updateWeddingGiftAction).toHaveBeenCalledOnce());

    // Server action 已成功，但 RSC props 仍是 v3；立即重開與再次送出必須
    // 使用剛提交的欄位與 v4 token。
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 王小明 的禮金" }),
    );
    dialog = screen.getByRole("dialog", { name: "編輯 王小明 的禮金" });
    expect(within(dialog).getByLabelText("禮金金額")).toHaveValue(1800);
    expect(within(dialog).getByLabelText("備註（選填）"))
      .toHaveValue("自己的已儲存內容");
    expect(
      within(dialog).queryByRole("button", { name: "載入最新禮金資料" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(
        'dialog input[name="expectedVersion"][value="4"]',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(updateWeddingGiftAction).toHaveBeenCalledTimes(2));
    const secondFormData = updateWeddingGiftAction.mock.calls[1]?.[3] as FormData;
    expect(secondFormData.get("expectedVersion")).toBe("4");
    await waitFor(() => expect(screen.getByRole("status")).toHaveFocus());
  });

  it("drops an own updated snapshot when refreshed props authoritatively delete it", async () => {
    updateWeddingGiftAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新禮金。",
      gift: {
        id: "gift_recorded",
        amount: 1800,
        notes: "自己的已儲存內容",
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 4,
      },
    });
    const { rerender } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 王小明 的禮金" }),
    );
    const dialog = screen.getByRole("dialog", { name: "編輯 王小明 的禮金" });
    fireEvent.change(within(dialog).getByLabelText("禮金金額"), {
      target: { value: "1800" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(updateWeddingGiftAction).toHaveBeenCalledOnce());

    rerender(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests.map((guest) =>
          guest.id === "guest_recorded"
            ? { ...guest, weddingGift: null }
            : guest,
        )}
        canEdit
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "登記 王小明 的禮金" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/1,800/u)).not.toBeInTheDocument();
  });

  it("prevents close controls and Escape while an edit is being submitted", async () => {
    let resolveUpdate!: (state: {
      status: "success";
      message: string;
      gift: typeof guests[0]["weddingGift"];
    }) => void;
    updateWeddingGiftAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 王小明 的禮金" }),
    );
    const dialog = screen.getByRole("dialog", { name: "編輯 王小明 的禮金" });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(updateWeddingGiftAction).toHaveBeenCalledOnce());

    expect(
      within(dialog).getByRole("button", { name: "關閉編輯 王小明 的禮金" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" }))
      .toBeDisabled();
    const cancelEvent = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);

    resolveUpdate({
      status: "success",
      message: "已更新禮金。",
      gift: {
        id: "gift_recorded",
        amount: 1200,
        notes: "由爸爸代收",
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 4,
      },
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "編輯 王小明 的禮金" }))
        .not.toBeInTheDocument(),
    );
  });

  it("adopts a collaborator's newer authoritative gift after an own success", async () => {
    updateWeddingGiftAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新禮金。",
      gift: {
        id: "gift_recorded",
        amount: 1800,
        notes: "自己的已儲存內容",
        createdAt: new Date("2026-08-30T02:00:00.000Z"),
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 4,
      },
    });
    const { rerender } = render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit
      />,
    );
    expandBook();
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 王小明 的禮金" }),
    );
    let dialog = screen.getByRole("dialog", { name: "編輯 王小明 的禮金" });
    fireEvent.change(within(dialog).getByLabelText("禮金金額"), {
      target: { value: "1800" },
    });
    fireEvent.change(within(dialog).getByLabelText("備註（選填）"), {
      target: { value: "自己的已儲存內容" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(updateWeddingGiftAction).toHaveBeenCalledOnce());

    rerender(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests.map((guest) =>
          guest.id === "guest_recorded"
            ? {
                ...guest,
                weddingGift: {
                  ...guest.weddingGift!,
                  amount: 9_000,
                  notes: "協作者較新的內容",
                  version: 5,
                },
              }
            : guest,
        )}
        canEdit
      />,
    );
    await waitFor(() => expect(screen.getByText(/9,000/u)).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", { name: "編輯 王小明 的禮金" }),
    );
    dialog = screen.getByRole("dialog", { name: "編輯 王小明 的禮金" });
    expect(within(dialog).getByLabelText("禮金金額")).toHaveValue(9000);
    expect(within(dialog).getByLabelText("備註（選填）"))
      .toHaveValue("協作者較新的內容");
    expect(
      within(dialog).queryByRole("button", { name: "載入最新禮金資料" }),
    ).not.toBeInTheDocument();
  });

  it("shows gift amounts to viewers without mutation controls", () => {
    render(
      <WeddingGiftBook
        workspaceId="workspace_1"
        guests={guests}
        canEdit={false}
      />,
    );
    expandBook();

    expect(screen.getByText(/1,200/u)).toBeInTheDocument();
    expect(screen.getByText("由爸爸代收")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(登記|編輯|移除) /u }))
      .not.toBeInTheDocument();
  });
});

it("shows exempt guests without a gift and excludes them from missing gifts", () => {
  render(<WeddingGiftBook workspaceId="workspace_1" canEdit={false} defaultExpanded guests={[{
    id: "exempt", name: "長輩朋友", category: "GUEST", side: "PARTNER_A",
    attendanceStatus: "ATTENDING", weddingGift: null, giftExemptWithCake: true,
  }]} />);
  expect(screen.getByText("不收禮金・會送餅")).toBeInTheDocument();
  expect(screen.queryByText("未有禮金紀錄")).not.toBeInTheDocument();
  expect(screen.queryByText("禮到人不到・待回禮回喜餅")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("禮金登記狀態篩選"), { target: { value: "UNRECORDED_GENERAL" } });
  expect(screen.getByText("找不到符合條件的邀請群組。")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("禮金登記狀態篩選"), { target: { value: "EXEMPT_WITH_CAKE" } });
  expect(screen.getByText("長輩朋友")).toBeInTheDocument();
});

it("saves and cancels the exemption and adopts newer server versions", async () => {
  setGuestGiftExemptionAction.mockResolvedValueOnce({
    status: "success", message: "已更新標記。",
    guest: { version: 1, giftExemptWithCake: true },
  }).mockResolvedValueOnce({
    status: "success", message: "已更新標記。",
    guest: { version: 2, giftExemptWithCake: false },
  });
  const guest = { id: "exempt", name: "長輩朋友", category: "GUEST" as const,
    side: "PARTNER_A" as const, attendanceStatus: "ATTENDING" as const,
    weddingGift: null, version: 0, giftExemptWithCake: false };
  const { rerender } = render(<WeddingGiftBook workspaceId="workspace_1" canEdit defaultExpanded guests={[guest]} />);
  fireEvent.click(screen.getByRole("button", { name: "標記 長輩朋友 不收禮金、會送餅" }));
  await waitFor(() => expect(screen.getByText("不收禮金・會送餅")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "登記 長輩朋友 的禮金" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消 長輩朋友 的不收禮金、會送餅標記" }));
  await waitFor(() => expect(screen.queryByText("不收禮金・會送餅")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "登記 長輩朋友 的禮金" })).toBeInTheDocument();
  expect(setGuestGiftExemptionAction.mock.calls.at(-1)?.[3].get("expectedVersion")).toBe("1");
  rerender(<WeddingGiftBook workspaceId="workspace_1" canEdit defaultExpanded guests={[{ ...guest, version: 3, giftExemptWithCake: true }]} />);
  expect(screen.getByText("不收禮金・會送餅")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "登記 長輩朋友 的禮金" })).not.toBeInTheDocument();
});

it.each(["PARTNER_A","PARTNER_B"] as const)("hides registration for immediate family on %s while keeping other relatives",side=>{
 const guests=["父親","母親","哥哥","弟弟","姊姊","妹妹","表姊"].map((relationshipLabel,i)=>({id:String(i),name:relationshipLabel,relationshipLabel,category:"FAMILY" as const,side,attendanceStatus:"ATTENDING" as const,weddingGift:null}));
 render(<WeddingGiftBook workspaceId="workspace_1" canEdit defaultExpanded guests={guests}/>);
 for(const name of ["父親","母親","哥哥","弟弟","姊姊","妹妹"])expect(screen.queryByRole("button",{name:`登記 ${name} 的禮金`})).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"登記 表姊 的禮金"})).toBeInTheDocument();
});
