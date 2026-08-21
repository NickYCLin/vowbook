import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveAttribute(
      "max",
      "20",
    );
    expect(screen.getByLabelText("姓名或稱呼")).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText(/備註/)).not.toHaveAttribute("maxlength");
    expect(container.querySelector("form")).not.toHaveAttribute("novalidate");
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container.querySelector('[name="guestId"]')).toBeNull();
    expect(container.querySelector('[name="userId"]')).toBeNull();
    expect(container.querySelector('[name="role"]')).toBeNull();
  });

  it("turns family into a one-person roster entry with side-specific roles", () => {
    const { container } = render(
      <CreateGuestForm workspaceId="workspace_internal" />
    );

    fireEvent.change(screen.getByLabelText("名單身份"), {
      target: { value: "FAMILY" },
    });

    expect(screen.getByLabelText("家人所屬")).toHaveValue("PARTNER_A");
    expect(screen.getByRole("option", { name: "新郎家人" })).toHaveValue("PARTNER_A");
    expect(screen.getByRole("option", { name: "新娘家人" })).toHaveValue("PARTNER_B");
    expect(screen.queryByLabelText("邀請人數（含本人）")).toBeNull();
    expect(screen.getByText("新人與家人請一人建立一筆名單。"))
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
          importSources={[]}
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

  it("keeps LINEIN party size editable while locking its other managed fields", () => {
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
        managedFields={["NAME", "SIDE", "ATTENDANCE_STATUS"]}
      />,
    );
    openRecordDialogs();

    expect(screen.getByLabelText("姓名或稱呼")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("與新人的關係")).toBeDisabled();
    expect(screen.getByLabelText("出席狀態")).toBeDisabled();
    expect(screen.getByLabelText("邀請人數（含本人）")).not.toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText(/備註/u)).toBeEnabled();
    expect(screen.getAllByText("此欄位由匯入來源維護。")).toHaveLength(3);
    expect(
      container.querySelector(
        'input[type="hidden"][name="side"][value="PARTNER_A"]',
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        'input[type="hidden"][name="attendanceStatus"][value="ATTENDING"]',
      ),
    ).toBeInTheDocument();
  });

  it("still locks party size for a generic source that explicitly manages it", () => {
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
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveAttribute(
      "readonly",
    );
    expect(screen.getAllByText("此欄位由匯入來源維護。")).toHaveLength(1);
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
    expect(screen.getByLabelText("邀請人數（含本人）")).toHaveAttribute(
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

  it("uses only managed source labels in the authoritative deletion warning", () => {
    render(
      <DeleteGuestForm
        workspaceId="workspace_internal"
        guestId="guest_internal"
        expectedVersion={3}
        name="匯入賓客"
        importSources={[
          { sourceLabel: "合成表單", sourceManaged: false },
          { sourceLabel: "拍拍印", sourceManaged: true },
          { sourceLabel: "賓客系統", sourceManaged: true },
        ]}
      />,
    );
    openRecordDialogs();

    expect(
      screen.getByText("這筆資料由 拍拍印、賓客系統 來源維護。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("日後再次匯入這些來源時，這筆賓客可能會依來源資料重新建立。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("此動作無法復原。")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "確認刪除 匯入賓客" }),
    ).toBeInTheDocument();
  });
});
