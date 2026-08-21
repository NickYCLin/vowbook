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

  it("wraps unbroken names in edit and removal controls", () => {
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
          expectedVersion={2}
        />
        <DeleteWeddingStaffForm
          workspaceId="workspace_internal"
          staffId="staff_internal"
          personName={personName}
          expectedVersion={2}
        />
      </>,
    );
    const editTrigger = screen.getByRole("button", {
      name: `編輯 ${personName}`,
    });
    expect(editTrigger).toHaveClass(
      "max-w-full",
      "min-w-0",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
    expect(within(editTrigger).getByText(`編輯 ${personName}`)).toHaveClass(
      "min-w-0",
      "whitespace-normal",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
    const deleteLabel = screen.getByText(`移除 ${personName}`);
    expect(deleteLabel).toHaveClass(
      "min-w-0",
      "whitespace-normal",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
    expect(deleteLabel.closest("button")).toHaveClass(
      "max-w-full",
      "min-w-0",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
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
        expectedVersion={3}
      />,
    );

    expect(within(dialog).getByLabelText("職務")).toHaveValue(
      "使用者尚未儲存的舊草稿",
    );
    const formData = new FormData(dialog.querySelector("form")!);
    expect(formData.get("expectedVersion")).toBe("2");
  });
});
