import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createGuestAction, updateGuestAction, deleteGuestAction } = vi.hoisted(
  () => ({
    createGuestAction: vi.fn(),
    updateGuestAction: vi.fn(),
    deleteGuestAction: vi.fn(),
  }),
);

vi.mock("@/actions/guests", () => ({
  createGuestAction,
  updateGuestAction,
  deleteGuestAction,
}));

import { installModalDialogPolyfill } from "@/test/modal-dialog";
import {
  CreateGuestDialog,
  CreateGuestForm,
  DeleteGuestForm,
  EditGuestForm,
} from "./guest-forms";

installModalDialogPolyfill();

/**
 * 編輯與刪除都改成對話框，內容要開啟後才會進入可存取樹。
 * 開啟畫面上所有「編輯 …」「刪除 …」觸發鈕，讓後續斷言照舊查詢。
 */
function openRecordDialogs() {
  for (const trigger of screen.queryAllByRole("button", {
    name: /^(編輯|刪除) /u,
  })) {
    fireEvent.click(trigger);
  }
}

describe("guest forms", () => {
  beforeEach(() => {
    createGuestAction.mockReset();
    updateGuestAction.mockReset();
    deleteGuestAction.mockReset();
  });

  it("shows only human-facing fields and never asks for internal ids", () => {
    const { container } = render(
      <CreateGuestForm workspaceId="workspace_internal" />,
    );

    expect(screen.getByLabelText("姓名或稱呼")).toBeInTheDocument();
    expect(screen.getByLabelText("名單身份")).toHaveValue("GUEST");
    expect(screen.getByLabelText("與新人的關係")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "男方親友" }),
    ).toHaveValue("PARTNER_A");
    expect(
      screen.getByRole("option", { name: "女方親友" }),
    ).toHaveValue("PARTNER_B");
    expect(
      screen.getByRole("option", { name: "共同親友" }),
    ).toHaveValue("SHARED");
    expect(screen.queryByRole("option", { name: "新人一方" })).toBeNull();
    expect(screen.queryByRole("option", { name: "新人另一方" })).toBeNull();
    expect(screen.getByLabelText("出席狀態")).toBeInTheDocument();
    expect(screen.getByLabelText("賓客輩份")).toHaveValue("UNSPECIFIED");
    expect(screen.getByRole("option", { name: "長輩" })).toHaveValue("ELDER");
    expect(screen.getByRole("option", { name: "平輩" })).toHaveValue("PEER");
    expect(screen.getByRole("option", { name: "晚輩" })).toHaveValue("JUNIOR");
    expect(screen.getByText("名單會先依輩份，再依姓氏筆劃排列；未設定會排在最後。"))
      .toBeInTheDocument();
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveAttribute(
      "max",
      "20",
    );
    expect(screen.getByLabelText("姓名或稱呼")).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText(/備註/)).not.toHaveAttribute("maxlength");
    expect(screen.getByRole("heading", { name: "聯絡與回覆資料" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText(/關係補充/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/聯絡電話/u)).toHaveAttribute("type", "tel");
    expect(screen.getByLabelText(/電子信箱/u)).toHaveAttribute("type", "email");
    expect(screen.queryByLabelText(/證婚儀式/u)).toBeNull();
    expect(screen.getByLabelText(/兒童座椅/u)).toHaveAttribute("min", "0");
    expect(screen.getByLabelText(/素食人數/u)).toHaveAttribute("max", "1");
    expect(screen.getByLabelText(/喜帖方式/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/寄送地址/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/賓客留言/u)).toBeInTheDocument();
    expect(container.querySelector("form")).not.toHaveAttribute("novalidate");
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container.querySelector('[name="guestId"]')).toBeNull();
    expect(container.querySelector('[name="userId"]')).toBeNull();
    expect(container.querySelector('[name="role"]')).toBeNull();
  });

  it("does not expose the legacy single-ceremony attendance field", () => {
    render(<CreateGuestForm workspaceId="workspace_internal" />);
    expect(screen.queryByLabelText(/證婚/u)).not.toBeInTheDocument();
  });

  it("keeps requirement maxima aligned with the current party size", () => {
    render(<CreateGuestForm workspaceId="workspace_internal" />);
    const partySize = screen.getByLabelText("邀請人數（含本人）");
    const childSeats = screen.getByLabelText(/兒童座椅/u);
    const vegetarianMeals = screen.getByLabelText(/素食人數/u);

    expect(childSeats).toHaveAttribute("max", "1");
    expect(vegetarianMeals).toHaveAttribute("max", "1");

    fireEvent.change(partySize, { target: { value: "4" } });

    expect(childSeats).toHaveAttribute("max", "4");
    expect(vegetarianMeals).toHaveAttribute("max", "4");
  });

  it("keeps a failed create draft but resets every field after a successful create", async () => {
    createGuestAction
      .mockResolvedValueOnce({ status: "error", message: "合成新增失敗。" })
      .mockResolvedValueOnce({ status: "success", message: "已新增賓客。" });
    render(<CreateGuestDialog workspaceId="workspace_internal" />);

    fireEvent.click(screen.getByRole("button", { name: "新增名單成員" }));
    fireEvent.change(screen.getByLabelText("姓名或稱呼"), {
      target: { value: "保留的草稿" },
    });
    fireEvent.change(screen.getByLabelText("名單身份"), {
      target: { value: "FAMILY" },
    });
    fireEvent.change(screen.getByLabelText("家人所屬"), {
      target: { value: "PARTNER_B" },
    });
    fireEvent.change(screen.getByLabelText("賓客輩份"), {
      target: { value: "ELDER" },
    });
    fireEvent.change(screen.getByLabelText("出席狀態"), {
      target: { value: "ATTENDING" },
    });
    fireEvent.change(screen.getByLabelText("邀請人數（含本人）"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText(/聯絡電話/u), {
      target: { value: "0911-111-111" },
    });

    fireEvent.click(screen.getByRole("button", { name: "加入名單" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("合成新增失敗。");
    await waitFor(() =>
      expect(screen.getByLabelText("名單身份")).toHaveValue("FAMILY"),
    );
    expect(screen.getByLabelText("姓名或稱呼")).toHaveValue("保留的草稿");
    expect(screen.getByLabelText("家人所屬")).toHaveValue("PARTNER_B");
    expect(screen.getByLabelText("賓客輩份")).toHaveValue("ELDER");
    expect(screen.getByLabelText("出席狀態")).toHaveValue("ATTENDING");
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveValue(4);
    expect(screen.getByLabelText(/聯絡電話/u)).toHaveValue("0911-111-111");

    fireEvent.click(screen.getByRole("button", { name: "加入名單" }));
    await screen.findByRole("button", { name: "新增名單成員" });
    fireEvent.click(screen.getByRole("button", { name: "新增名單成員" }));

    expect(screen.getByLabelText("姓名或稱呼")).toHaveValue("");
    expect(screen.getByLabelText("名單身份")).toHaveValue("GUEST");
    expect(screen.getByLabelText("與新人的關係")).toHaveValue("SHARED");
    expect(screen.getByLabelText("賓客輩份")).toHaveValue("UNSPECIFIED");
    expect(screen.getByLabelText("出席狀態")).toHaveValue("UNDECIDED");
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveValue(1);
    expect(screen.getByLabelText(/聯絡電話/u)).toHaveValue("");
    expect(screen.queryByLabelText(/證婚/u)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets family include companions while keeping side-specific roles", () => {
    const { container } = render(
      <CreateGuestForm workspaceId="workspace_internal" />
    );

    fireEvent.change(screen.getByLabelText("名單身份"), {
      target: { value: "FAMILY" },
    });

    expect(screen.getByLabelText("家人所屬")).toHaveValue("PARTNER_A");
    expect(screen.getByRole("option", { name: "新郎家人" })).toHaveValue("PARTNER_A");
    expect(screen.getByRole("option", { name: "新娘家人" })).toHaveValue("PARTNER_B");
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveValue(1);
    expect(screen.getByText("可包含同行的伴侶、小孩或寶寶，最多 20 位；需要兒童座椅可在下方填寫。"))
      .toBeInTheDocument();
    expect(
      container.querySelector('input[type="hidden"][name="partySize"][value="1"]'),
    ).toBeNull();
  });

  it("keeps each newlywed as an individual roster entry", () => {
    const { container } = render(
      <CreateGuestForm workspaceId="workspace_internal" />
    );

    fireEvent.change(screen.getByLabelText("名單身份"), {
      target: { value: "COUPLE" },
    });

    expect(screen.getByLabelText("賓客輩份")).toHaveValue("PEER");
    expect(screen.queryByLabelText("邀請人數（含本人）")).toBeNull();
    expect(screen.getByText("新人請一人建立一筆名單。"))
      .toBeInTheDocument();
    expect(
      container.querySelector('input[type="hidden"][name="partySize"][value="1"]'),
    ).toBeInTheDocument();
  });

  it("binds edit and delete controls without rendering id inputs", () => {
    const { container } = render(
      <>
        <EditGuestForm
          workspaceId="workspace_internal"
          guestId="guest_internal"
          expectedVersion={3}
          name="王小明"
          category="GUEST"
          side="PARTNER_A"
          attendanceStatus="ATTENDING"
          partySize={2}
          notes={null}
          managedFields={[]}
        />
        <DeleteGuestForm
          workspaceId="workspace_internal"
          guestId="guest_internal"
          expectedVersion={3}
          name="王小明"
          hasManagedImportSource={false}
        />
      </>,
    );
    openRecordDialogs();

    // 觸發鈕上只印「編輯」「刪除」，賓客姓名留在無障礙名稱裡。
    const editTrigger = screen.getByRole("button", { name: "編輯 王小明" });
    const deleteTrigger = screen.getByRole("button", { name: "刪除 王小明" });
    expect(editTrigger).toHaveClass("min-h-11");
    expect(deleteTrigger).toHaveClass("min-h-11");
    expect(editTrigger).toHaveTextContent(/^編輯$/u);
    expect(deleteTrigger).toHaveTextContent(/^刪除$/u);
    expect(screen.getByText("此動作無法復原。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "確認刪除 王小明" }),
    ).toBeInTheDocument();
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container.querySelector('[name="guestId"]')).toBeNull();
    expect(
      container.querySelectorAll(
        'input[type="hidden"][name="expectedVersion"][value="3"]',
      ),
    ).toHaveLength(2);
    expect(
      screen.getByRole("form", { name: "編輯賓客表單" }),
    ).not.toHaveAttribute("novalidate");
  });

  it("keeps every operational field editable for an imported guest", () => {
    const { container } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="匯入賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes="人工備註"
        details={{
          relationshipLabel: "大學同學",
          contactPhone: "0900-000-000",
          contactEmail: "guest@example.test",
          ceremonyAttendance: false,
          childSeatCount: 1,
          vegetarianCount: 0,
          invitationDelivery: "DIGITAL",
          mailingAddress: null,
          guestMessage: "祝福新人",
          attendanceReply: "會出席",
          invitationReply: "已傳送",
        }}
        managedFields={["NAME", "SIDE", "ATTENDANCE_STATUS"]}
      />,
    );
    openRecordDialogs();

    expect(screen.getByLabelText("姓名或稱呼")).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("與新人的關係")).toBeEnabled();
    expect(screen.getByLabelText("出席狀態")).toBeEnabled();
    expect(screen.getByLabelText("邀請人數（含本人）")).not.toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText(/備註/u)).toBeEnabled();
    expect(screen.getByLabelText(/關係補充/u)).toHaveValue("大學同學");
    expect(screen.getByLabelText(/聯絡電話/u)).toHaveValue("0900-000-000");
    expect(screen.getByLabelText(/電子信箱/u)).toHaveValue("guest@example.test");
    expect(screen.queryByLabelText(/證婚儀式/u)).toBeNull();
    expect(screen.getByLabelText(/兒童座椅/u)).toHaveValue(1);
    expect(screen.getByLabelText(/素食人數/u)).toHaveValue(0);
    expect(screen.getByLabelText(/喜帖方式/u)).toHaveValue("DIGITAL");
    expect(screen.getByLabelText(/賓客留言/u)).toHaveValue("祝福新人");
    expect(
      screen.getByText(
        "這筆資料曾由外部來源建立，仍可依現場狀況修改；原始來源紀錄會保留供後續追蹤。",
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        'input[type="hidden"][name="side"][value="PARTNER_A"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        'input[type="hidden"][name="attendanceStatus"][value="ATTENDING"]',
      ),
    ).toBeNull();
  });

  it("keeps party size editable for a generic imported source", () => {
    render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="通用匯入賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes={null}
        managedFields={["PARTY_SIZE"]}
      />,
    );
    openRecordDialogs();

    expect(screen.getByLabelText("姓名或稱呼")).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("與新人的關係")).toBeEnabled();
    expect(screen.getByLabelText("出席狀態")).toBeEnabled();
    expect(screen.getByLabelText("邀請人數（含本人）")).not.toHaveAttribute(
      "readonly",
    );
    expect(
      screen.getByText(
        "這筆資料曾由外部來源建立，仍可依現場狀況修改；原始來源紀錄會保留供後續追蹤。",
      ),
    ).toBeInTheDocument();
  });

  it("keeps a pristine edit snapshot unchanged when newer props arrive", () => {
    const { container, rerender } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="原始賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes="原始備註"
        managedFields={[]}
      />,
    );
    openRecordDialogs();

    rerender(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={4}
        name="最新賓客"
        category="GUEST"
        side="PARTNER_B"
        attendanceStatus="DECLINED"
        partySize={6}
        notes="最新備註"
        managedFields={["PARTY_SIZE"]}
      />,
    );
    openRecordDialogs();

    expect(screen.getByLabelText("姓名或稱呼")).toHaveValue("原始賓客");
    expect(screen.getByLabelText("與新人的關係")).toHaveValue("PARTNER_A");
    expect(screen.getByLabelText("出席狀態")).toHaveValue("ATTENDING");
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveValue(2);
    expect(screen.getByLabelText(/備註/u)).toHaveValue("原始備註");
    expect(screen.getByLabelText("邀請人數（含本人）")).not.toHaveAttribute(
      "readonly",
    );
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "3",
    );
    expect(screen.getByRole("button", { name: "載入最新資料" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("keeps a dirty party-size draft paired with its original token", () => {
    const { container, rerender } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="原始賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes={null}
        managedFields={[]}
      />,
    );
    openRecordDialogs();

    fireEvent.change(screen.getByLabelText("邀請人數（含本人）"), {
      target: { value: "5" },
    });
    rerender(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={4}
        name="原始賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={7}
        notes={null}
        managedFields={[]}
      />,
    );
    openRecordDialogs();

    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveValue(5);
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "3",
    );
    expect(screen.getByRole("button", { name: "載入最新資料" })).toBeInTheDocument();
  });

  it("treats a managed-field-only prop change as a newer snapshot", () => {
    const { rerender } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="來源賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes={null}
        managedFields={[]}
      />,
    );
    openRecordDialogs();

    rerender(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="來源賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes={null}
        managedFields={["PARTY_SIZE"]}
      />,
    );
    openRecordDialogs();

    expect(screen.getByLabelText("邀請人數（含本人）")).not.toHaveAttribute(
      "readonly",
    );
    expect(screen.getByRole("button", { name: "載入最新資料" })).toBeInTheDocument();
  });

  it("reloads editable values, token, and managed fields as one snapshot", () => {
    const { container, rerender } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="原始賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes="原始備註"
        managedFields={["NAME", "SIDE", "ATTENDANCE_STATUS"]}
      />,
    );
    openRecordDialogs();

    rerender(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={4}
        name="最新賓客"
        category="GUEST"
        side="PARTNER_B"
        attendanceStatus="DECLINED"
        partySize={6}
        notes="最新備註"
        managedFields={["PARTY_SIZE"]}
      />,
    );
    openRecordDialogs();
    fireEvent.click(screen.getByRole("button", { name: "載入最新資料" }));

    expect(screen.getByLabelText("姓名或稱呼")).toHaveValue("最新賓客");
    expect(screen.getByLabelText("姓名或稱呼")).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("與新人的關係")).toHaveValue("PARTNER_B");
    expect(screen.getByLabelText("與新人的關係")).toBeEnabled();
    expect(screen.getByLabelText("出席狀態")).toHaveValue("DECLINED");
    expect(screen.getByLabelText("出席狀態")).toBeEnabled();
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveValue(6);
    expect(screen.getByLabelText("邀請人數（含本人）")).not.toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText(/備註/u)).toHaveValue("最新備註");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "4",
    );
    expect(
      container.querySelector('input[type="hidden"][name="side"]'),
    ).toBeNull();
    expect(
      container.querySelector('input[type="hidden"][name="attendanceStatus"]'),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "載入最新資料" })).toBeNull();
  });

  it("clears stale action feedback when the latest snapshot is loaded", async () => {
    updateGuestAction.mockResolvedValueOnce({
      status: "error",
      message: "舊資料儲存失敗。",
    });
    const { rerender } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="原始賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes={null}
        managedFields={[]}
      />,
    );
    openRecordDialogs();

    fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "舊資料儲存失敗。",
    );

    rerender(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={4}
        name="最新賓客"
        category="GUEST"
        side="PARTNER_B"
        attendanceStatus="DECLINED"
        partySize={6}
        notes="最新備註"
        managedFields={["PARTY_SIZE"]}
      />,
    );
    openRecordDialogs();
    expect(screen.getByRole("alert")).toHaveTextContent("舊資料儲存失敗。");

    fireEvent.click(screen.getByRole("button", { name: "載入最新資料" }));

    expect(screen.queryByText("舊資料儲存失敗。")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the incremented token when resubmitting before refreshed props arrive", async () => {
    updateGuestAction
      .mockResolvedValueOnce({ status: "success", message: "已更新賓客。" })
      .mockResolvedValueOnce({ status: "success", message: "已更新賓客。" });
    const onSuccess = vi.fn();
    const { container } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="原始賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes="原始備註"
        managedFields={[]}
        onSuccess={onSuccess}
      />,
    );
    openRecordDialogs();
    const dialog = container.querySelector("dialog");

    fireEvent.change(screen.getByLabelText("姓名或稱呼"), {
      target: { value: "更新後賓客" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("已更新賓客。"));
    expect(dialog).not.toHaveAttribute("open");

    // Server action 已成功，但最新 RSC props 尚未抵達；立即重開也必須使用
    // 剛提交成功的 v+1 snapshot，而不是再送一次舊 token。
    openRecordDialogs();
    expect(screen.getByLabelText("姓名或稱呼")).toHaveValue("更新後賓客");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "4",
    );
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));

    await waitFor(() => expect(updateGuestAction).toHaveBeenCalledTimes(2));
    const secondSubmission = updateGuestAction.mock.calls[1]?.[3];
    expect(secondSubmission).toBeInstanceOf(FormData);
    expect((secondSubmission as FormData).get("expectedVersion")).toBe("4");
  });

  it("recognizes the matching server snapshot after an own successful edit", async () => {
    updateGuestAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新賓客。",
    });
    const onSuccess = vi.fn();
    const { container, rerender } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="原始賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes="原始備註"
        managedFields={[]}
        onSuccess={onSuccess}
      />,
    );
    openRecordDialogs();

    fireEvent.change(screen.getByLabelText("姓名或稱呼"), {
      target: { value: "更新後賓客" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("已更新賓客。"));

    rerender(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={4}
        name="更新後賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes="原始備註"
        managedFields={[]}
        onSuccess={onSuccess}
      />,
    );
    openRecordDialogs();

    expect(screen.getByLabelText("姓名或稱呼")).toHaveValue("更新後賓客");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "4",
    );
    expect(
      screen.queryByRole("button", { name: "載入最新資料" }),
    ).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not silently adopt a collaborator snapshot newer than the pending own success", async () => {
    updateGuestAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新賓客。",
    });
    const { container, rerender } = render(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="原始賓客"
        category="GUEST"
        side="PARTNER_A"
        attendanceStatus="ATTENDING"
        partySize={2}
        notes={null}
        managedFields={[]}
      />,
    );
    openRecordDialogs();
    fireEvent.change(screen.getByLabelText("姓名或稱呼"), {
      target: { value: "自己的已儲存內容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));
    await waitFor(() =>
      expect(container.querySelector("dialog")).not.toHaveAttribute("open"),
    );

    // 自己的寫入應是 v4；若協作者隨即寫到 v5，v5 不能被誤認為自己的
    // authoritative response 而靜默洗掉剛儲存的內容。
    rerender(
      <EditGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={5}
        name="協作者較新的內容"
        category="GUEST"
        side="PARTNER_B"
        attendanceStatus="DECLINED"
        partySize={1}
        notes="協作者備註"
        managedFields={[]}
      />,
    );
    openRecordDialogs();

    expect(screen.getByLabelText("姓名或稱呼")).toHaveValue(
      "自己的已儲存內容",
    );
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "4",
    );
    expect(screen.getByRole("button", { name: "載入最新資料" }))
      .toBeInTheDocument();
  });

  it("uses a generic authoritative deletion warning for imported guests", () => {
    render(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="匯入賓客"
        hasManagedImportSource
      />,
    );
    openRecordDialogs();

    expect(
      screen.getByText("這筆資料仍連結外部匯入來源。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("日後再次匯入時，這筆賓客可能會依來源資料重新建立。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("此動作無法復原。")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "確認刪除 匯入賓客" }),
    ).toBeInTheDocument();
  });

  it("warns when deleting a guest will also permanently remove a gift entry", () => {
    render(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="有禮金的賓客"
        hasManagedImportSource={false}
        weddingGift={{ id: "gift_1", version: 2 }}
        checkIn={{ id: "check_in_1", version: 4, headcount: 3 }}
      />,
    );
    openRecordDialogs();

    expect(screen.getByText("此禮金紀錄也會永久移除。"))
      .toBeInTheDocument();
  });

  it("does not show the gift cascade warning when no gift is recorded", () => {
    render(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="沒有禮金的賓客"
        hasManagedImportSource={false}
        weddingGift={null}
      />,
    );
    openRecordDialogs();

    expect(screen.queryByText("此禮金紀錄也會永久移除。"))
      .not.toBeInTheDocument();
  });

  it("closes and announces a successful guest deletion", async () => {
    deleteGuestAction.mockResolvedValue({
      status: "success",
      message: "已刪除賓客。",
    });
    const onSuccess = vi.fn();
    render(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="待刪除賓客"
        hasManagedImportSource={false}
        weddingGift={{ id: "gift_1", version: 2 }}
        checkIn={{ id: "check_in_1", version: 4, headcount: 3 }}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "刪除 待刪除賓客" }));
    fireEvent.click(
      screen.getByRole("button", { name: "確認刪除 待刪除賓客" }),
    );

    await waitFor(() => expect(deleteGuestAction).toHaveBeenCalledOnce());
    const formData = deleteGuestAction.mock.calls[0]?.[3] as FormData;
    expect(formData.get("expectedVersion")).toBe("3");
    expect(formData.get("expectedWeddingGiftId")).toBe("gift_1");
    expect(formData.get("expectedWeddingGiftVersion")).toBe("2");
    expect(formData.get("expectedGuestCheckInId")).toBe("check_in_1");
    expect(formData.get("expectedGuestCheckInVersion")).toBe("4");
    expect(onSuccess).toHaveBeenCalledWith("已刪除賓客。");
    expect(
      screen.queryByRole("dialog", { name: "待刪除賓客" }),
    ).not.toBeInTheDocument();
  });

  it("freezes guest and gift delete tokens until the confirmation closes", () => {
    const { container, rerender } = render(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="原始賓客"
        hasManagedImportSource={false}
        weddingGift={{ id: "gift_1", version: 2 }}
        checkIn={{ id: "check_in_1", version: 4, headcount: 3 }}
      />,
    );
    openRecordDialogs();

    rerender(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={4}
        name="協作者更新後"
        hasManagedImportSource
        weddingGift={{ id: "gift_1", version: 3 }}
        checkIn={{ id: "check_in_1", version: 5, headcount: 4 }}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "原始賓客" });
    expect(within(dialog).getByText(/已有較新的資料/u)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "確認刪除 原始賓客" }),
    ).toBeDisabled();
    expect(
      container.querySelector('input[name="expectedVersion"][value="3"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        'input[name="expectedWeddingGiftId"][value="gift_1"]',
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        'input[name="expectedWeddingGiftVersion"][value="2"]',
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        'input[name="expectedGuestCheckInId"][value="check_in_1"]',
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        'input[name="expectedGuestCheckInVersion"][value="4"]',
      ),
    ).toBeInTheDocument();
  });

  it("warns that deleting a checked-in guest also removes the arrival record", () => {
    render(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="已報到賓客"
        hasManagedImportSource={false}
        checkIn={{ id: "check_in_1", version: 4, headcount: 3 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "刪除 已報到賓客" }));

    const dialog = screen.getByRole("dialog", { name: "已報到賓客" });
    expect(
      within(dialog).getByText(/已登記的報到紀錄（實到 3 位）也會永久移除。/u),
    ).toBeInTheDocument();
  });

  it("sends empty cascade tokens for a guest with no gift and no check-in", async () => {
    deleteGuestAction.mockResolvedValue({
      status: "success",
      message: "已刪除賓客。",
    });
    render(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="乾淨賓客"
        hasManagedImportSource={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "刪除 乾淨賓客" }));
    fireEvent.click(screen.getByRole("button", { name: "確認刪除 乾淨賓客" }));

    await waitFor(() => expect(deleteGuestAction).toHaveBeenCalledOnce());
    const formData = deleteGuestAction.mock.calls[0]?.[3] as FormData;
    expect(formData.get("expectedGuestCheckInId")).toBe("");
    expect(formData.get("expectedGuestCheckInVersion")).toBe("");
  });
});

it("searches family titles in one field while preserving side and seniority", () => {
  render(<CreateGuestDialog workspaceId="workspace_internal" />);
  fireEvent.click(screen.getByRole("button", { name: "新增名單成員" }));
  fireEvent.change(screen.getByLabelText("名單身份"), { target: { value: "FAMILY" } });
  fireEvent.change(screen.getByLabelText("家人所屬"), { target: { value: "PARTNER_B" } });
  const relation = screen.getByRole("combobox", {name:/家人關係稱謂/});
  fireEvent.change(relation, {target:{value:"舅媽"}});
  fireEvent.click(screen.getByRole("option", {name:/舅母（舅媽、妗母）/}));
  expect(relation).toHaveValue("舅母");
  expect(screen.queryByLabelText(/關係補充/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("家人所屬")).toHaveValue("PARTNER_B");
  expect(screen.getByLabelText("賓客輩份")).toHaveValue("UNSPECIFIED");
  fireEvent.change(relation, {target:{value:"二舅媽"}});
  fireEvent.change(screen.getByLabelText("名單身份"), { target: { value: "GUEST" } });
  expect(screen.getByLabelText(/關係補充/)).toHaveValue("二舅媽");
});
