import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  updateWorkspaceAction: vi.fn(),
  deleteWorkspaceAction: vi.fn(),
}));

vi.mock("@/actions/workspaces", () => actions);

import { WorkspaceOwnerControls } from "./workspace-owner-controls";

const workspace = {
  id: "workspace_internal",
  name: "我們的 婚宴",
  weddingDate: new Date("2028-02-29T00:00:00.000Z"),
  timezone: "Asia/Taipei",
  updatedAt: new Date("2026-07-29T01:02:03.456Z"),
};

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

describe("WorkspaceOwnerControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits the original CAS snapshot, closes on edit success, and restores trigger focus", async () => {
    actions.updateWorkspaceAction.mockResolvedValue({
      status: "success",
      message: "已更新婚宴工作區。",
    });
    const { container } = render(<WorkspaceOwnerControls workspace={workspace} />);
    const trigger = screen.getByRole("button", {
      name: "編輯 我們的 婚宴",
    });

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "編輯婚宴工作區" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByLabelText("婚宴名稱")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("婚宴名稱"), {
      target: { value: "  更新後的   婚宴  " },
    });
    fireEvent.change(screen.getByLabelText(/婚宴日期/u), {
      target: { value: "2029-03-01" },
    });
    const form = dialog.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
      expect(screen.getByRole("status")).toHaveTextContent(
        "已更新婚宴工作區。",
      );
      expect(trigger).toHaveFocus();
    });

    expect(actions.updateWorkspaceAction).toHaveBeenCalledTimes(1);
    const [, , submitted] = actions.updateWorkspaceAction.mock.calls[0] as [
      string,
      unknown,
      FormData,
    ];
    expect(submitted.get("name")).toBe("  更新後的   婚宴  ");
    expect(submitted.get("weddingDate")).toBe("2029-03-01");
    expect(submitted.get("timezone")).toBe("Asia/Taipei");
    expect(submitted.get("expectedUpdatedAt")).toBe(
      "2026-07-29T01:02:03.456Z",
    );
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container).not.toHaveTextContent("workspace_internal");
  });

  it("locks the full edit snapshot and keeps the dialog open for a safe action error", async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    actions.updateWorkspaceAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(<WorkspaceOwnerControls workspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "編輯 我們的 婚宴" }));
    const dialog = screen.getByRole("dialog", { name: "編輯婚宴工作區" });
    const form = dialog.querySelector("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    expect(await screen.findByRole("button", { name: "正在儲存…" })).toBeDisabled();
    expect(screen.getByLabelText("婚宴名稱")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "關閉編輯婚宴" }),
    ).toBeDisabled();
    const cancelEvent = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);

    resolveAction?.({
      status: "error",
      code: "STALE",
      message: "婚宴工作區已被更新或不存在，請重新整理後再試。",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "婚宴工作區已被更新或不存在，請重新整理後再試。",
    );
    expect(dialog).toHaveAttribute("open");
  });

  it("requires the normalized current name and warns about every permanently deleted area", async () => {
    actions.deleteWorkspaceAction.mockResolvedValue({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法刪除婚宴工作區，請稍後再試。",
    });
    const { container } = render(<WorkspaceOwnerControls workspace={workspace} />);
    fireEvent.click(
      screen.getByRole("button", { name: "永久刪除 我們的 婚宴" }),
    );

    const dialog = screen.getByRole("dialog", { name: "永久刪除婚宴工作區" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("此動作永久且無法復原。")).toBeInTheDocument();
    expect(
      screen.getByText(
        /賓客、桌次、任務、婚禮花費、工作人員、婚禮流程、分享與協作資料/u,
      ),
    ).toBeInTheDocument();

    const confirmation = screen.getByLabelText(
      "輸入「我們的 婚宴」以確認永久刪除",
    );
    const deleteButton = screen.getByRole("button", {
      name: "確認永久刪除 我們的 婚宴",
    });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirmation, {
      target: { value: "  我們的   婚宴  " },
    });
    expect(deleteButton).toBeEnabled();

    const form = dialog.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目前無法刪除婚宴工作區，請稍後再試。",
    );
    expect(dialog).toHaveAttribute("open");

    expect(actions.deleteWorkspaceAction).toHaveBeenCalledTimes(1);
    const [, , submitted] = actions.deleteWorkspaceAction.mock.calls[0] as [
      string,
      unknown,
      FormData,
    ];
    expect(submitted.get("confirmationName")).toBe("  我們的   婚宴  ");
    expect(submitted.get("expectedUpdatedAt")).toBe(
      "2026-07-29T01:02:03.456Z",
    );
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
  });

  it("locks the complete delete confirmation while deletion is pending", async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    actions.deleteWorkspaceAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(<WorkspaceOwnerControls workspace={workspace} />);
    fireEvent.click(
      screen.getByRole("button", { name: "永久刪除 我們的 婚宴" }),
    );
    const dialog = screen.getByRole("dialog", { name: "永久刪除婚宴工作區" });
    const confirmation = screen.getByLabelText(
      "輸入「我們的 婚宴」以確認永久刪除",
    );
    fireEvent.change(confirmation, { target: { value: "我們的 婚宴" } });
    fireEvent.submit(dialog.querySelector("form")!);

    expect(
      await screen.findByRole("button", { name: "正在永久刪除…" }),
    ).toBeDisabled();
    expect(confirmation).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "關閉永久刪除婚宴" }),
    ).toBeDisabled();
    const cancelEvent = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);

    resolveAction?.({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法刪除婚宴工作區，請稍後再試。",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目前無法刪除婚宴工作區，請稍後再試。",
    );
    expect(dialog).toHaveAttribute("open");
  });
});
