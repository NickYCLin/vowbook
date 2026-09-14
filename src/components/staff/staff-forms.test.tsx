import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createWeddingStaffAction: vi.fn(),
  updateWeddingStaffAction: vi.fn(),
  deleteWeddingStaffAction: vi.fn(),
}));

vi.mock("@/actions/wedding-staff", () => actions);

import {
  CreateWeddingStaffForm,
  DeleteWeddingStaffForm,
  EditWeddingStaffForm,
} from "./staff-forms";

const emptyTimelineAssignmentFingerprint =
  `vowbook-staff-timeline-v1:${"0".repeat(64)}`;

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

describe("staff forms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens create and edit native dialogs with bounded visible fields", () => {
    render(
      <>
        <CreateWeddingStaffForm workspaceId="workspace_internal" />
        <EditWeddingStaffForm
          workspaceId="workspace_internal"
          staffId="staff_internal"
          roleName="主持"
          personName="小安"
          contactPhone={null}
          notes="流程確認"
          mealCount={null}
          vegetarianMealCount={null}
          redEnvelopeAmount={null}
          expectedVersion={2}
        />
      </>,
    );
    const createTrigger = screen.getByRole("button", {
      name: "新增工作人員",
    });
    fireEvent.click(createTrigger);
    const createDialog = screen.getByRole("dialog", {
      name: "新增婚禮工作人員",
    });
    expect(createDialog).toHaveAttribute("open");
    expect(within(createDialog).getByLabelText("職務")).toHaveFocus();
    expect(within(createDialog).getByLabelText("職務")).toHaveAttribute(
      "maxlength",
      "60",
    );
    expect(within(createDialog).getByLabelText("姓名")).toHaveAttribute(
      "maxlength",
      "120",
    );
    expect(within(createDialog).getByLabelText(/聯絡電話/)).toHaveAttribute(
      "maxlength",
      "40",
    );
    expect(within(createDialog).getByLabelText(/備註/)).toHaveAttribute(
      "maxlength",
      "500",
    );
    expect(
      createDialog.querySelector('datalist option[value="總招待"]'),
    ).toBeInTheDocument();
    expect(
      createDialog.querySelector('datalist option[value="收禮金"]'),
    ).toBeInTheDocument();
    expect(
      createDialog.querySelector('datalist option[value="花童"]'),
    ).toBeInTheDocument();
    fireEvent.click(
      within(createDialog).getByRole("button", {
        name: "關閉新增婚禮工作人員",
      }),
    );
    expect(createDialog).not.toHaveAttribute("open");
    expect(createTrigger).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "編輯 小安" }));
    expect(
      screen.getByRole("dialog", { name: "編輯婚禮工作人員" }),
    ).toHaveAttribute("open");
    expect(
      within(
        screen.getByRole("dialog", { name: "編輯婚禮工作人員" }),
      ).getByLabelText("職務"),
    ).toHaveFocus();
    expect(
      document.querySelector('[name="expectedVersion"][value="2"]'),
    ).toBeInTheDocument();
  });

  it("reveals the meal head count only after the meal box is ticked", async () => {
    actions.createWeddingStaffAction.mockResolvedValue({
      status: "success",
      message: "已新增婚禮工作人員。",
    });
    render(<CreateWeddingStaffForm workspaceId="workspace_internal" />);
    fireEvent.click(screen.getByRole("button", { name: "新增工作人員" }));

    const dialog = screen.getByRole("dialog", { name: "新增婚禮工作人員" });
    expect(within(dialog).queryByLabelText("便當份數")).toBeNull();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "需要便當" }));
    expect(within(dialog).getByLabelText("便當份數")).toHaveValue(1);
    expect(within(dialog).getByLabelText("其中素食份數")).toHaveValue(0);

    fireEvent.change(within(dialog).getByLabelText("便當份數"), {
      target: { value: "6" },
    });
    fireEvent.change(within(dialog).getByLabelText("其中素食份數"), {
      target: { value: "2" },
    });
    fireEvent.change(within(dialog).getByLabelText("職務"), {
      target: { value: "攝影" },
    });
    fireEvent.change(within(dialog).getByLabelText("姓名"), {
      target: { value: "星河影像" },
    });
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() =>
      expect(actions.createWeddingStaffAction).toHaveBeenCalledOnce(),
    );
    const formData = actions.createWeddingStaffAction.mock
      .calls[0]?.[2] as FormData;
    expect(formData.get("needsMeal")).toBe("on");
    expect(formData.get("mealCount")).toBe("6");
    expect(formData.get("vegetarianMealCount")).toBe("2");
  });

  it("sends no meal fields at all when the box stays unticked", async () => {
    actions.createWeddingStaffAction.mockResolvedValue({
      status: "success",
      message: "已新增婚禮工作人員。",
    });
    render(<CreateWeddingStaffForm workspaceId="workspace_internal" />);
    fireEvent.click(screen.getByRole("button", { name: "新增工作人員" }));

    const dialog = screen.getByRole("dialog", { name: "新增婚禮工作人員" });
    fireEvent.change(within(dialog).getByLabelText("職務"), {
      target: { value: "招待" },
    });
    fireEvent.change(within(dialog).getByLabelText("姓名"), {
      target: { value: "小安" },
    });
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() =>
      expect(actions.createWeddingStaffAction).toHaveBeenCalledOnce(),
    );
    const formData = actions.createWeddingStaffAction.mock
      .calls[0]?.[2] as FormData;
    expect(formData.get("needsMeal")).toBeNull();
    expect(formData.get("mealCount")).toBeNull();
    expect(formData.get("vegetarianMealCount")).toBeNull();
  });

  it("opens an existing vendor team with its stored head count already filled", () => {
    render(
      <EditWeddingStaffForm
        workspaceId="workspace_internal"
        staffId="staff_1"
        roleName="攝影"
        personName="星河影像"
        contactPhone={null}
        notes={null}
        mealCount={6}
        vegetarianMealCount={2}
        redEnvelopeAmount={null}
        expectedVersion={3}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "編輯 星河影像" }));

    const dialog = screen.getByRole("dialog", { name: "編輯婚禮工作人員" });
    expect(
      within(dialog).getByRole("checkbox", { name: "需要便當" }),
    ).toBeChecked();
    expect(within(dialog).getByLabelText("便當份數")).toHaveValue(6);
    expect(within(dialog).getByLabelText("其中素食份數")).toHaveValue(2);
  });

  it("wraps forward Tab from the last control to the first dialog control", () => {
    render(<CreateWeddingStaffForm workspaceId="workspace_internal" />);
    fireEvent.click(screen.getByRole("button", { name: "新增工作人員" }));
    const dialog = screen.getByRole("dialog", {
      name: "新增婚禮工作人員",
    });
    const first = within(dialog).getByRole("button", {
      name: "關閉新增婚禮工作人員",
    });
    const last = within(dialog).getByRole("button", {
      name: "新增工作人員",
    });

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });

    expect(first).toHaveFocus();
  });

  it("requires a second confirmation before removal", () => {
    render(
      <DeleteWeddingStaffForm
        workspaceId="workspace_internal"
        staffId="staff_internal"
        personName="小安"
        expectedVersion={2}
        timelineAssignmentFingerprint={emptyTimelineAssignmentFingerprint}
      />,
    );
    // 第一段：只看得到觸發鈕，確認內容還藏在未開啟的對話框裡。
    expect(screen.getByText("此動作無法復原。")).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "移除 小安" }));

    // 第二段：開啟後才出現不可復原警告與確認鈕。
    expect(screen.getByText("此動作無法復原。")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "確認移除：小安" }),
    ).toBeInTheDocument();
  });

  it("freezes the staff and assignment snapshot while removal is open", () => {
    const { container, rerender } = render(
      <DeleteWeddingStaffForm
        workspaceId="workspace_internal"
        staffId="staff_internal"
        personName="小安"
        expectedVersion={2}
        timelineAssignmentFingerprint={emptyTimelineAssignmentFingerprint}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "移除 小安" }));

    const newerFingerprint =
      `vowbook-staff-timeline-v1:${"1".repeat(64)}`;
    rerender(
      <DeleteWeddingStaffForm
        workspaceId="workspace_internal"
        staffId="staff_internal"
        personName="協作者更新後"
        expectedVersion={3}
        timelineAssignmentFingerprint={newerFingerprint}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "小安" });
    expect(within(dialog).getByText(/流程指派已有較新的資料/u))
      .toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "確認移除：小安" }),
    ).toBeDisabled();
    expect(
      container.querySelector('input[name="expectedVersion"][value="2"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        `input[name="expectedTimelineAssignmentFingerprint"][value="${emptyTimelineAssignmentFingerprint}"]`,
      ),
    ).toBeInTheDocument();
  });

  it("keeps long names in the accessible name of edit and removal controls", () => {
    const personName = "P".repeat(120);
    render(
      <>
        <EditWeddingStaffForm
          workspaceId="workspace_internal"
          staffId="staff_internal"
          roleName="主持"
          personName={personName}
          contactPhone={null}
          notes={null}
          mealCount={null}
          vegetarianMealCount={null}
          redEnvelopeAmount={null}
          expectedVersion={2}
        />
        <DeleteWeddingStaffForm
          workspaceId="workspace_internal"
          staffId="staff_internal"
          personName={personName}
          expectedVersion={2}
          timelineAssignmentFingerprint={emptyTimelineAssignmentFingerprint}
        />
      </>,
    );
    // 長名字只留在可及性名稱裡；畫面上只顯示短動詞，手機卡片才不會被姓名撐爆。
    const editTrigger = screen.getByRole("button", {
      name: `編輯 ${personName}`,
    });
    expect(editTrigger).toHaveTextContent(/^編輯$/u);
    expect(editTrigger).toHaveClass("min-h-11", "max-w-full", "min-w-0");
    const deleteTrigger = screen.getByRole("button", {
      name: `移除 ${personName}`,
    });
    expect(deleteTrigger).toHaveTextContent(/^移除$/u);
    expect(deleteTrigger).toHaveClass("min-h-11", "max-w-full", "min-w-0");
  });

  it("closes the create dialog and restores focus after a successful mutation", async () => {
    actions.createWeddingStaffAction.mockResolvedValue({
      status: "success",
      message: "已新增工作人員。",
    });
    render(<CreateWeddingStaffForm workspaceId="workspace_internal" />);

    const trigger = screen.getByRole("button", { name: "新增工作人員" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "新增婚禮工作人員",
    });
    fireEvent.change(within(dialog).getByLabelText("職務"), {
      target: { value: "總招待" },
    });
    fireEvent.change(within(dialog).getByLabelText("姓名"), {
      target: { value: "小安" },
    });
    fireEvent.submit(
      within(dialog)
        .getByRole("button", { name: "新增工作人員" })
        .closest("form")!,
    );

    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
      expect(screen.getByText("已新增工作人員。")).toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(within(dialog).getByLabelText("職務")).toHaveValue("");
    expect(within(dialog).getByLabelText("姓名")).toHaveValue("");
  });

  it("keeps a dirty staff draft paired with its original CAS token after rerender", async () => {
    actions.updateWeddingStaffAction.mockResolvedValue({
      status: "error",
      code: "STALE",
      message: "資料已被其他人更新，請重新整理後再試。",
    });
    const { rerender } = render(
      <EditWeddingStaffForm
        workspaceId="workspace_internal"
        staffId="staff_internal"
        roleName="主持"
        personName="小安"
        contactPhone={null}
        notes="v1"
        mealCount={null}
        vegetarianMealCount={null}
        redEnvelopeAmount={null}
        expectedVersion={2}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "編輯 小安" }));
    const dialog = screen.getByRole("dialog", { name: "編輯婚禮工作人員" });
    fireEvent.change(within(dialog).getByLabelText("職務"), {
      target: { value: "使用者尚未儲存的舊草稿" },
    });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "資料已被其他人更新",
    );

    rerender(
      <EditWeddingStaffForm
        workspaceId="workspace_internal"
        staffId="staff_internal"
        roleName="協作者的新職務"
        personName="小安"
        contactPhone="0900000000"
        notes="v2"
        mealCount={null}
        vegetarianMealCount={null}
        redEnvelopeAmount={null}
        expectedVersion={3}
      />,
    );

    expect(within(dialog).getByLabelText("職務")).toHaveValue(
      "使用者尚未儲存的舊草稿",
    );
    const formData = new FormData(dialog.querySelector("form")!);
    expect(formData.get("expectedVersion")).toBe("2");
    expect(within(dialog).getByLabelText(/聯絡電話/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/備註/)).toHaveValue("v1");
    expect(
      within(dialog).getByText(
        "這位工作人員已有較新的資料，目前表單仍保留原本的草稿與版本。",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "載入最新資料" }),
    );

    expect(within(dialog).getByLabelText("職務")).toHaveValue("協作者的新職務");
    expect(within(dialog).getByLabelText(/聯絡電話/)).toHaveValue("0900000000");
    expect(within(dialog).getByLabelText(/備註/)).toHaveValue("v2");
    expect(dialog.querySelector('input[name="expectedVersion"]')).toHaveValue("3");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "載入最新資料" }),
    ).toBeNull();
  });

  it("advances its own successful staff snapshot before the next submit", async () => {
    actions.updateWeddingStaffAction
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新工作人員。",
      })
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新工作人員。",
      });
    const { rerender } = render(
      <EditWeddingStaffForm
        workspaceId="workspace_internal"
        staffId="staff_internal"
        roleName="主持"
        personName="小安"
        contactPhone={null}
        notes="v1"
        mealCount={null}
        vegetarianMealCount={null}
        redEnvelopeAmount={null}
        expectedVersion={2}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "編輯 小安" }));
    const dialog = screen.getByRole("dialog", { name: "編輯婚禮工作人員" });
    fireEvent.change(within(dialog).getByLabelText("職務"), {
      target: { value: "  總招待  " },
    });
    fireEvent.change(within(dialog).getByLabelText("姓名"), {
      target: { value: "  小美  " },
    });
    fireEvent.change(within(dialog).getByLabelText(/聯絡電話/), {
      target: { value: "  0911222333  " },
    });
    fireEvent.submit(dialog.querySelector("form")!);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已更新工作人員。",
    );
    expect(dialog.querySelector('input[name="expectedVersion"]')).toHaveValue("3");
    expect(within(dialog).getByLabelText("職務")).toHaveValue("總招待");
    expect(within(dialog).getByLabelText("姓名")).toHaveValue("小美");
    expect(within(dialog).getByLabelText(/聯絡電話/)).toHaveValue("0911222333");

    rerender(
      <EditWeddingStaffForm
        workspaceId="workspace_internal"
        staffId="staff_internal"
        roleName="總招待"
        personName="小美"
        contactPhone="0911222333"
        notes="v1"
        mealCount={null}
        vegetarianMealCount={null}
        redEnvelopeAmount={null}
        expectedVersion={3}
      />,
    );
    expect(
      within(dialog).queryByRole("button", { name: "載入最新資料" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "編輯 小美" }));
    fireEvent.change(within(dialog).getByLabelText(/備註/), {
      target: { value: "再次更新" },
    });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() =>
      expect(actions.updateWeddingStaffAction).toHaveBeenCalledTimes(2),
    );
    const secondSubmission = actions.updateWeddingStaffAction.mock.calls[1]?.[3];
    expect(secondSubmission).toBeInstanceOf(FormData);
    expect((secondSubmission as FormData).get("expectedVersion")).toBe("3");
    await waitFor(() =>
      expect(dialog.querySelector('input[name="expectedVersion"]')).toHaveValue("4"),
    );
  });
});
