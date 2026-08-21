import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const actions = vi.hoisted(() => ({
  createBudgetGroupAction: vi.fn(),
  deleteBudgetGroupSubtreeAction: vi.fn(),
  dissolveBudgetGroupAction: vi.fn(),
  updateBudgetGroupAction: vi.fn(),
}));

vi.mock("@/actions/budget-items", () => actions);

import {
  CreateBudgetGroupDialog,
  DeleteBudgetGroupSubtreeDialog,
  DissolveBudgetGroupForm,
  EditBudgetGroupDialog,
} from "./budget-group-forms";

const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

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
      if (!this.open) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterAll(() => {
  if (showModalDescriptor) {
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      showModalDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  }
  if (closeDescriptor) {
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      closeDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

function pressEscape(dialog: HTMLDialogElement) {
  const event = new Event("cancel", { cancelable: true });
  fireEvent(dialog, event);
  if (!event.defaultPrevented) dialog.close();
  return event;
}

describe("Budget GROUP editor dialogs", () => {
  it("creates a root GROUP through a focused native dialog and keeps success feedback visible", async () => {
    actions.createBudgetGroupAction.mockResolvedValueOnce({
      status: "success",
      message: "已建立群組。",
    });
    const onSuccess = vi.fn();
    const { container } = render(
      <CreateBudgetGroupDialog
        workspaceId="workspace_internal"
        onSuccess={onSuccess}
      />,
    );

    const trigger = screen.getByRole("button", { name: "建立群組" });
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    expect(dialog).not.toHaveAttribute("open");

    fireEvent.click(trigger);

    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAccessibleName("建立群組");
    const name = screen.getByLabelText("群組名稱");
    const category = screen.getByLabelText("品項分類");
    expect(name).toHaveFocus();
    expect(name).not.toHaveAttribute("maxlength");
    expect(category).toHaveValue("");
    expect(screen.queryByLabelText("預計花費")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "群組資料" })).toBeInTheDocument();

    fireEvent.change(name, { target: { value: "婚紗方案" } });
    expect(within(category).getAllByRole("group")).toHaveLength(6);
    expect(within(category).getAllByRole("option")).toHaveLength(20);
    expect(category).not.toHaveTextContent("其他");
    expect(category).not.toHaveTextContent("待分類");
    fireEvent.change(category, {
      target: { value: "ITEM_PRE_WEDDING_PHOTOGRAPHY" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "建立群組表單" }));

    await waitFor(() => {
      expect(actions.createBudgetGroupAction).toHaveBeenCalledOnce();
    });
    const submitted = actions.createBudgetGroupAction.mock
      .calls[0][3] as FormData;
    expect(actions.createBudgetGroupAction.mock.calls[0].slice(0, 2)).toEqual([
      "workspace_internal",
      null,
    ]);
    expect(submitted.get("name")).toBe("婚紗方案");
    expect(submitted.get("taxonomyItemKey")).toBe(
      "ITEM_PRE_WEDDING_PHOTOGRAPHY",
    );
    expect(submitted.get("category")).toBeNull();
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole("status")).toHaveTextContent("已建立群組。");
    expect(dialog).not.toContainElement(screen.getByRole("status"));
    expect(onSuccess).toHaveBeenCalledWith("已建立群組。");
  });

  it("creates a nested GROUP with the parent bound outside FormData", async () => {
    actions.createBudgetGroupAction.mockResolvedValueOnce({
      status: "success",
      message: "已建立群組。",
    });
    const { container } = render(
      <CreateBudgetGroupDialog
        workspaceId="workspace_internal"
        parentId="parent_internal"
        parentBreadcrumb={["婚紗方案", "拍攝組合"]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "在「拍攝組合」下建立群組" }),
    );
    expect(
      screen.getByText("建立位置：婚紗方案 › 拍攝組合"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("群組名稱"), {
      target: { value: "精修加購" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "在拍攝組合下建立群組表單" }),
    );

    await waitFor(() => {
      expect(actions.createBudgetGroupAction).toHaveBeenCalledOnce();
    });
    expect(actions.createBudgetGroupAction.mock.calls[0].slice(0, 2)).toEqual([
      "workspace_internal",
      "parent_internal",
    ]);
    const submitted = actions.createBudgetGroupAction.mock
      .calls[0][3] as FormData;
    expect(submitted.get("parentId")).toBeNull();
    expect(container).not.toHaveTextContent("parent_internal");
  });

  it("renames with the original version snapshot and never pairs a fresh token with a stale draft", async () => {
    actions.updateBudgetGroupAction.mockResolvedValueOnce({
      status: "error",
      code: "STALE",
      message: "資料已更新或不存在，請重新整理後再試。",
    });
    const view = render(
      <EditBudgetGroupDialog
        workspaceId="workspace_internal"
        itemId="group_internal"
        name="原群組"
        expectedVersion={4}
        breadcrumb={["婚紗方案", "原群組"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "編輯群組：原群組" }));
    fireEvent.change(screen.getByLabelText("群組名稱"), {
      target: { value: "尚未合併的名稱" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "編輯群組：原群組" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "資料已更新或不存在，請重新整理後再試。",
    );
    const dialog = screen.getByRole("dialog", {
      name: "編輯群組",
    }) as HTMLDialogElement;
    expect(dialog).toHaveAttribute("open");
    expect(dialog.querySelector('[name="expectedVersion"]')).toHaveValue("4");

    view.rerender(
      <EditBudgetGroupDialog
        workspaceId="workspace_internal"
        itemId="group_internal"
        name="另一位使用者的名稱"
        expectedVersion={5}
        breadcrumb={["婚紗方案", "另一位使用者的名稱"]}
      />,
    );

    expect(screen.getByLabelText("群組名稱")).toHaveValue("尚未合併的名稱");
    expect(dialog.querySelector('[name="expectedVersion"]')).toHaveValue("4");
    fireEvent.click(screen.getByRole("button", { name: "載入最新群組資料" }));
    expect(screen.getByLabelText("群組名稱")).toHaveValue("另一位使用者的名稱");
    expect(dialog.querySelector('[name="expectedVersion"]')).toHaveValue("5");
  });

  it("disables the complete fieldset and blocks close paths while pending", async () => {
    let resolveUpdate:
      | ((state: {
          status: "error";
          code: "UNAVAILABLE";
          message: string;
        }) => void)
      | undefined;
    actions.updateBudgetGroupAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    render(
      <EditBudgetGroupDialog
        workspaceId="workspace_internal"
        itemId="group_internal"
        name="婚紗方案"
        expectedVersion={2}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "編輯群組：婚紗方案" }));
    const dialog = screen.getByRole("dialog", {
      name: "編輯群組",
    }) as HTMLDialogElement;
    fireEvent.submit(screen.getByRole("form", { name: "編輯群組：婚紗方案" }));

    await waitFor(() => {
      expect(screen.getByRole("group", { name: "群組資料" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "關閉編輯群組：婚紗方案" }),
    ).toBeDisabled();
    expect(pressEscape(dialog).defaultPrevented).toBe(true);
    expect(dialog).toHaveAttribute("open");

    resolveUpdate?.({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新群組，請稍後再試。",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目前無法更新群組，請稍後再試。",
    );
  });

  it("explains the authoritative root snapshot and dissolves with only the bound group identity and version", async () => {
    actions.dissolveBudgetGroupAction.mockResolvedValueOnce({
      status: "success",
      message: "已移除群組並保留其中項目。",
    });
    const onSuccess = vi.fn();
    render(
      <DissolveBudgetGroupForm
        workspaceId="workspace_internal"
        itemId="group_internal"
        name="婚紗方案"
        expectedVersion={6}
        expectedDirectChildSetHash={"a".repeat(64)}
        directChildCount={2}
        directParentName={null}
        onSuccess={onSuccess}
      />,
    );

    const disclosure = screen.getByText("移除群組並保留項目", {
      selector: "summary",
    });
    expect(disclosure).toHaveAccessibleName("移除群組並保留項目：婚紗方案");
    fireEvent.click(disclosure);
    expect(screen.getByText("會移除群組「婚紗方案」本身。")).toBeVisible();
    expect(screen.getByText("2 個直接子項會移到最上層。")).toBeVisible();
    expect(
      screen.getByText("費用金額、類別、付款資料與附件都不會改變。"),
    ).toBeVisible();

    fireEvent.submit(
      screen.getByRole("form", {
        name: "移除群組並保留項目：婚紗方案",
      }),
    );

    await waitFor(() => {
      expect(actions.dissolveBudgetGroupAction).toHaveBeenCalledOnce();
    });
    const call = actions.dissolveBudgetGroupAction.mock.calls[0];
    expect(call.slice(0, 2)).toEqual(["workspace_internal", "group_internal"]);
    const submitted = call[3] as FormData;
    expect(submitted.get("expectedVersion")).toBe("6");
    expect(submitted.get("expectedDirectChildSetHash")).toBe("a".repeat(64));
    expect(submitted.get("parentId")).toBeNull();
    expect(submitted.get("targetParentId")).toBeNull();
    expect(submitted.get("directChildCount")).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith("已移除群組並保留其中項目。");
  });

  it("wraps maximum-length unbroken group and parent names in the dissolve confirmation", () => {
    const longGroupName = "G".repeat(120);
    const longParentName = "P".repeat(120);
    render(
      <div style={{ width: "390px" }}>
        <DissolveBudgetGroupForm
          workspaceId="workspace_internal"
          itemId="long_group_internal"
          name={longGroupName}
          expectedVersion={1}
          expectedDirectChildSetHash={"c".repeat(64)}
          directChildCount={1}
          directParentName={longParentName}
        />
      </div>,
    );

    fireEvent.click(
      screen.getByText("移除群組並保留項目", { selector: "summary" }),
    );
    expect(
      screen.getByText(`會移除群組「${longGroupName}」本身。`),
    ).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
    expect(
      screen.getByText(`1 個直接子項會移到原上層「${longParentName}」。`),
    ).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
  });

  it("describes the original parent, disables repeat submission while pending, and reports success", async () => {
    let resolveDissolve:
      ((state: { status: "success"; message: string }) => void) | undefined;
    actions.dissolveBudgetGroupAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDissolve = resolve;
        }),
    );
    const onPendingChange = vi.fn();
    const onSuccess = vi.fn();
    render(
      <DissolveBudgetGroupForm
        workspaceId="workspace_internal"
        itemId="nested_group_internal"
        name="拍攝組合"
        expectedVersion={3}
        expectedDirectChildSetHash={"b".repeat(64)}
        directChildCount={1}
        directParentName="婚紗方案"
        onPendingChange={onPendingChange}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.click(
      screen.getByText("移除群組並保留項目", { selector: "summary" }),
    );
    expect(
      screen.getByText("1 個直接子項會移到原上層「婚紗方案」。"),
    ).toBeVisible();
    const form = screen.getByRole("form", {
      name: "移除群組並保留項目：拍攝組合",
    });
    fireEvent.submit(form);

    const submit = await screen.findByRole("button", {
      name: "正在移除群組…",
    });
    expect(submit).toBeDisabled();
    expect(form).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(onPendingChange).toHaveBeenCalledWith(true));

    resolveDissolve?.({
      status: "success",
      message: "已移除群組並保留其中項目。",
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("已移除群組並保留其中項目。");
    });
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("requires the normalized exact group name and submits only the authoritative subtree snapshot", async () => {
    actions.deleteBudgetGroupSubtreeAction.mockResolvedValueOnce({
      status: "success",
      message: "已永久刪除群組與其中 6 筆下層項目。",
    });
    const onSuccess = vi.fn();
    const { container } = render(
      <DeleteBudgetGroupSubtreeDialog
        workspaceId="workspace_internal"
        itemId="group_internal"
        name="婚紗 方案"
        expectedVersion={7}
        expectedSubtreeSnapshotToken={"d".repeat(64)}
        descendantCount={6}
        attachmentCount={3}
        onSuccess={onSuccess}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "永久刪除群組：婚紗 方案",
    });
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    expect(dialog).not.toHaveAttribute("open");

    fireEvent.click(trigger);

    expect(dialog).toHaveAttribute("open");
    expect(
      within(dialog).getByRole("heading", {
        name: "永久刪除群組：婚紗 方案",
      }),
    ).toBeVisible();
    expect(within(dialog).getByText(/總共 7 筆資料/u)).toBeVisible();
    expect(within(dialog).getByText(/下層 6 筆/u)).toBeVisible();
    expect(within(dialog).getByText(/3 個附件/u)).toBeVisible();
    expect(within(dialog).getByText(/無法復原/u)).toBeVisible();

    const confirmationName = within(dialog).getByRole("textbox", {
      name: "輸入「婚紗 方案」確認永久刪除",
    });
    const submit = within(dialog).getByRole("button", {
      name: "永久刪除 7 筆資料",
    });
    expect(submit).toBeDisabled();

    fireEvent.change(confirmationName, { target: { value: "婚紗方案" } });
    expect(submit).toBeDisabled();

    fireEvent.change(confirmationName, {
      target: { value: "  婚紗   方案  " },
    });
    expect(submit).toBeEnabled();

    const form = within(dialog).getByRole("form", {
      name: "永久刪除群組：婚紗 方案",
    });
    const hiddenFieldNames = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    ).map((input) => input.name);
    expect(hiddenFieldNames).toEqual([
      "expectedVersion",
      "expectedSubtreeSnapshotToken",
    ]);

    fireEvent.click(submit);

    await waitFor(() =>
      expect(actions.deleteBudgetGroupSubtreeAction).toHaveBeenCalledOnce(),
    );
    const call = actions.deleteBudgetGroupSubtreeAction.mock.calls[0];
    expect(call.slice(0, 2)).toEqual(["workspace_internal", "group_internal"]);
    const submitted = call[3] as FormData;
    expect(submitted.get("expectedVersion")).toBe("7");
    expect(submitted.get("expectedSubtreeSnapshotToken")).toBe("d".repeat(64));
    expect(submitted.get("confirmationName")).toBe("  婚紗   方案  ");
    expect(submitted.get("itemId")).toBeNull();
    expect(submitted.get("descendantCount")).toBeNull();
    expect(submitted.get("attachmentCount")).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith(
      "已永久刪除群組與其中 6 筆下層項目。",
    );
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("prevents Escape and cancellation while subtree deletion is pending", async () => {
    let resolveDelete:
      | ((state: { status: "success"; message: string }) => void)
      | undefined;
    actions.deleteBudgetGroupSubtreeAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const onPendingChange = vi.fn();
    render(
      <DeleteBudgetGroupSubtreeDialog
        workspaceId="workspace_internal"
        itemId="group_internal"
        name="婚紗方案"
        expectedVersion={4}
        expectedSubtreeSnapshotToken={"e".repeat(64)}
        descendantCount={2}
        attachmentCount={1}
        onPendingChange={onPendingChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "永久刪除群組：婚紗方案" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "永久刪除群組：婚紗方案",
    }) as HTMLDialogElement;
    fireEvent.change(
      within(dialog).getByRole("textbox", {
        name: "輸入「婚紗方案」確認永久刪除",
      }),
      { target: { value: "婚紗方案" } },
    );
    fireEvent.submit(
      within(dialog).getByRole("form", {
        name: "永久刪除群組：婚紗方案",
      }),
    );

    expect(
      await within(dialog).findByRole("button", { name: "正在永久刪除…" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(
      within(dialog).getByRole("button", {
        name: "關閉永久刪除群組：婚紗方案",
      }),
    ).toBeDisabled();
    expect(pressEscape(dialog).defaultPrevented).toBe(true);
    expect(dialog).toHaveAttribute("open");
    await waitFor(() => expect(onPendingChange).toHaveBeenCalledWith(true));

    resolveDelete?.({
      status: "success",
      message: "已永久刪除群組與其中 2 筆下層項目。",
    });
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith(false),
    );
  });
});
