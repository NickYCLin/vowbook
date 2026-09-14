import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createWeddingTaskAction: vi.fn(),
  updateWeddingTaskAction: vi.fn(),
  changeWeddingTaskStatusAction: vi.fn(),
  deleteWeddingTaskAction: vi.fn(),
}));

vi.mock("@/actions/wedding-tasks", () => actions);

import { installModalDialogPolyfill } from "@/test/modal-dialog";
import {
  ChangeWeddingTaskStatusForm,
  CreateWeddingTaskForm,
  DeleteWeddingTaskForm,
  EditWeddingTaskForm,
} from "./task-forms";

installModalDialogPolyfill();

/** 開啟以觸發鈕名稱指定的對話框，讓其中的表單進入可存取樹。 */
function openDialog(triggerName: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: triggerName }));
}

describe("wedding task forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows task details without rendering trusted internal fields", () => {
    const { container } = render(
      <CreateWeddingTaskForm workspaceId="workspace_internal" />,
    );

    expect(screen.getByLabelText("任務名稱")).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText(/任務說明/)).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText(/到期日/)).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("任務歸屬")).toHaveValue("SHARED");
    expect(screen.getByRole("option", { name: "共同任務" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "男方任務" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "女方任務" })).toBeInTheDocument();
    expect(container.querySelector("form")).not.toHaveAttribute("novalidate");
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container.querySelector('[name="taskId"]')).toBeNull();
    expect(container.querySelector('[name="status"]')).toBeNull();
    expect(container).not.toHaveTextContent("workspace_internal");
  });

  it("provides edit, clear status actions, and a two-stage delete", () => {
    const longTitle = "確認婚宴流程與所有合作人員".repeat(8);
    const { container } = render(
      <>
        <EditWeddingTaskForm
          workspaceId="workspace_internal"
          taskId="task_internal"
          title={longTitle}
          description="逐項確認"
          dueDate="2028-02-29"
          side="SHARED"
          expectedVersion={4}
        />
        <ChangeWeddingTaskStatusForm
          workspaceId="workspace_internal"
          taskId="task_internal"
          targetStatus="DONE"
          label="標記完成"
          taskTitle={longTitle}
          expectedVersion={4}
        />
        <DeleteWeddingTaskForm
          workspaceId="workspace_internal"
          taskId="task_internal"
          title={longTitle}
          expectedVersion={4}
        />
      </>,
    );

    // 長標題只留在可及性名稱裡；畫面上只顯示短動詞。
    const editTrigger = screen.getByRole("button", { name: `編輯 ${longTitle}` });
    expect(editTrigger).toHaveTextContent(/^編輯$/u);
    expect(editTrigger).toHaveClass("min-h-11");
    expect(
      screen.getByRole("button", { name: `標記完成：${longTitle}` }),
    ).toHaveClass("min-h-11");
    const deleteTrigger = screen.getByRole("button", { name: `刪除 ${longTitle}` });
    expect(deleteTrigger).toHaveTextContent(/^刪除$/u);
    expect(deleteTrigger).toHaveClass("min-h-11");

    // 刪除仍是兩段式：先開啟確認對話框，才會出現不可復原的警告與確認鈕。
    expect(screen.getByText("此動作無法復原。")).not.toBeVisible();
    openDialog(`刪除 ${longTitle}`);
    expect(screen.getByText("此動作無法復原。")).toBeVisible();
    expect(
      screen.getByRole("button", { name: `確認刪除 ${longTitle}` }),
    ).toBeInTheDocument();

    expect(container.querySelector('[name="taskId"]')).toBeNull();
    expect(container.querySelector('[name="status"]')).toBeNull();
    expect(container.querySelectorAll('[name="expectedVersion"]')).toHaveLength(3);
    for (const versionInput of container.querySelectorAll(
      '[name="expectedVersion"]',
    )) {
      expect(versionInput).toHaveAttribute("type", "hidden");
      expect(versionInput).toHaveAttribute("value", "4");
    }
    expect(container).not.toHaveTextContent("task_internal");

    openDialog(`編輯 ${longTitle}`);
    expect(
      screen.getByRole("form", { name: "編輯任務表單" }),
    ).not.toHaveAttribute("novalidate");
  });

  it("preserves create inputs after a handled action error and clears only after success", async () => {
    actions.createWeddingTaskAction
      .mockResolvedValueOnce({
        status: "error",
        code: "UNAVAILABLE",
        message: "目前無法新增婚宴任務，請稍後再試。",
      })
      .mockResolvedValueOnce({ status: "success", message: "已新增婚宴任務。" });

    const { container } = render(
      <CreateWeddingTaskForm workspaceId="workspace_internal" />,
    );
    const title = screen.getByLabelText("任務名稱");
    const description = screen.getByLabelText(/任務說明/);
    const dueDate = screen.getByLabelText(/到期日/);
    const side = screen.getByLabelText("任務歸屬");
    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    fireEvent.change(title, { target: { value: "🎉".repeat(120) } });
    fireEvent.change(description, { target: { value: "保留這段說明" } });
    fireEvent.change(dueDate, { target: { value: "2028-02-29" } });
    fireEvent.change(side, { target: { value: "PARTNER_B" } });
    expect(screen.getByLabelText("任務歸屬")).toHaveValue("PARTNER_B");
    fireEvent.submit(form!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目前無法新增婚宴任務，請稍後再試。",
    );
    expect(title).toHaveValue("🎉".repeat(120));
    expect(description).toHaveValue("保留這段說明");
    expect(dueDate).toHaveValue("2028-02-29");
    expect(screen.getByLabelText("任務歸屬")).toHaveValue("PARTNER_B");

    fireEvent.submit(form!);
    expect(await screen.findByRole("status")).toHaveTextContent("已新增婚宴任務。");
    await waitFor(() => {
      expect(title).toHaveValue("");
      expect(description).toHaveValue("");
      expect(dueDate).toHaveValue("");
      expect(screen.getByLabelText("任務歸屬")).toHaveValue("SHARED");
    });
  });

  it("keeps a stale draft paired with its original version until the latest snapshot is loaded", async () => {
    actions.updateWeddingTaskAction
      .mockResolvedValueOnce({
        status: "error",
        code: "STALE",
        message: "這項任務已被其他人更新，請確認最新內容後再試一次。",
      })
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新任務內容。",
      });
    const { container, rerender } = render(
      <EditWeddingTaskForm
        workspaceId="workspace_internal"
        taskId="task_internal"
        title="原始任務"
        description="原始說明"
        dueDate="2028-02-29"
        side="SHARED"
        expectedVersion={4}
      />,
    );
    openDialog("編輯 原始任務");
    const title = screen.getByLabelText("任務名稱");
    const description = screen.getByLabelText(/任務說明/);
    const side = screen.getByLabelText("任務歸屬");
    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    fireEvent.change(title, { target: { value: "修改後任務" } });
    fireEvent.change(description, { target: { value: "修改後說明" } });
    fireEvent.change(side, { target: { value: "PARTNER_A" } });
    expect(screen.getByLabelText("任務歸屬")).toHaveValue("PARTNER_A");
    fireEvent.submit(form!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "這項任務已被其他人更新，請確認最新內容後再試一次。",
    );
    expect(title).toHaveValue("修改後任務");
    expect(description).toHaveValue("修改後說明");
    expect(screen.getByLabelText("任務歸屬")).toHaveValue("PARTNER_A");

    rerender(
      <EditWeddingTaskForm
        workspaceId="workspace_internal"
        taskId="task_internal"
        title="伺服器最新任務"
        description="伺服器最新說明"
        dueDate="2028-03-01"
        side="PARTNER_B"
        expectedVersion={5}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "這項任務已被其他人更新，請確認最新內容後再試一次。",
    );
    expect(screen.getByLabelText("任務名稱")).toHaveValue("修改後任務");
    expect(screen.getByLabelText(/任務說明/)).toHaveValue("修改後說明");
    expect(screen.getByLabelText("任務歸屬")).toHaveValue("PARTNER_A");
    expect(screen.getByLabelText(/到期日/)).toHaveValue("2028-02-29");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue("4");
    expect(
      screen.getByText(
        "這筆任務已有較新的資料，目前表單仍保留原本的草稿與版本。",
      ),
    ).toBeInTheDocument();

    const loadLatestButton = screen.getByRole("button", {
      name: "載入最新資料",
    });
    expect(loadLatestButton).toHaveAttribute("type", "button");
    fireEvent.click(loadLatestButton);

    expect(screen.getByLabelText("任務名稱")).toHaveValue("伺服器最新任務");
    expect(screen.getByLabelText(/任務說明/)).toHaveValue("伺服器最新說明");
    expect(screen.getByLabelText(/到期日/)).toHaveValue("2028-03-01");
    expect(screen.getByLabelText("任務歸屬")).toHaveValue("PARTNER_B");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue("5");
    expect(screen.queryByRole("button", { name: "載入最新資料" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.submit(form!);
    await waitFor(() => {
      expect(actions.updateWeddingTaskAction).toHaveBeenCalledTimes(2);
    });
    const submitted = actions.updateWeddingTaskAction.mock.calls[1]?.[3];
    expect(submitted).toBeInstanceOf(FormData);
    expect((submitted as FormData).get("expectedVersion")).toBe("5");
    expect((submitted as FormData).get("title")).toBe("伺服器最新任務");
    expect((submitted as FormData).get("description")).toBe("伺服器最新說明");
    expect((submitted as FormData).get("dueDate")).toBe("2028-03-01");
    expect((submitted as FormData).get("side")).toBe("PARTNER_B");
  });

  it("advances an own successful edit snapshot before the next submit and accepts matching server props", async () => {
    actions.updateWeddingTaskAction
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新任務內容。",
      })
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新任務內容。",
      });
    const { container, rerender } = render(
      <EditWeddingTaskForm
        workspaceId="workspace_internal"
        taskId="task_internal"
        title="原始任務"
        description="原始說明"
        dueDate="2028-02-29"
        side="SHARED"
        expectedVersion={4}
      />,
    );
    openDialog("編輯 原始任務");
    const form = screen.getByRole("form", { name: "編輯任務表單" });

    fireEvent.change(screen.getByLabelText("任務名稱"), {
      target: { value: "  已   更新任務  " },
    });
    fireEvent.change(screen.getByLabelText(/任務說明/u), {
      target: { value: "  已更新說明  " },
    });
    fireEvent.change(screen.getByLabelText("任務歸屬"), {
      target: { value: "PARTNER_A" },
    });
    fireEvent.submit(form);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已更新任務內容。",
    );
    expect(screen.getByLabelText("任務名稱")).toHaveValue("已 更新任務");
    expect(screen.getByLabelText(/任務說明/u)).toHaveValue("已更新說明");
    expect(screen.getByLabelText("任務歸屬")).toHaveValue("PARTNER_A");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "5",
    );
    expect(
      screen.queryByRole("button", { name: "載入最新資料" }),
    ).toBeNull();

    rerender(
      <EditWeddingTaskForm
        workspaceId="workspace_internal"
        taskId="task_internal"
        title="已 更新任務"
        description="已更新說明"
        dueDate="2028-02-29"
        side="PARTNER_A"
        expectedVersion={5}
      />,
    );

    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "5",
    );
    expect(
      screen.queryByRole("button", { name: "載入最新資料" }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("任務名稱"), {
      target: { value: "再次更新任務" },
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(actions.updateWeddingTaskAction).toHaveBeenCalledTimes(2);
    });
    const secondSubmission = actions.updateWeddingTaskAction.mock.calls[1]?.[3];
    expect(secondSubmission).toBeInstanceOf(FormData);
    expect((secondSubmission as FormData).get("expectedVersion")).toBe("5");
    await waitFor(() =>
      expect(
        container.querySelector('[name="expectedVersion"]'),
      ).toHaveValue("6"),
    );
    expect(
      screen.queryByRole("button", { name: "載入最新資料" }),
    ).toBeNull();
  });

  it("freezes the destructive task snapshot until the dialog is closed and reopened", () => {
    const { rerender } = render(
      <DeleteWeddingTaskForm
        workspaceId="workspace_internal"
        taskId="task_internal"
        title="原始任務"
        expectedVersion={4}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "刪除 原始任務" }));
    const dialog = screen.getByRole("dialog", { name: "原始任務" });

    rerender(
      <DeleteWeddingTaskForm
        workspaceId="workspace_internal"
        taskId="task_internal"
        title="協作者更新的任務"
        expectedVersion={5}
      />,
    );

    expect(dialog).toHaveAttribute("open");
    expect(dialog.querySelector('input[name="expectedVersion"]')).toHaveValue(
      "4",
    );
    expect(dialog).toHaveTextContent("原始任務");
    expect(
      within(dialog).getByText(
        "這筆任務已有較新的資料，請關閉後重新確認刪除。",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "確認刪除 原始任務" }),
    ).toBeDisabled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "關閉刪除任務" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "刪除 協作者更新的任務" }),
    );

    const reopenedDialog = screen.getByRole("dialog", {
      name: "協作者更新的任務",
    });
    expect(
      reopenedDialog.querySelector('input[name="expectedVersion"]'),
    ).toHaveValue("5");
    expect(within(reopenedDialog).queryByRole("alert")).toBeNull();
    expect(
      within(reopenedDialog).getByRole("button", {
        name: "確認刪除 協作者更新的任務",
      }),
    ).toBeEnabled();
  });
});
