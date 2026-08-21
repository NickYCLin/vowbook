import {
  act,
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
  createBudgetItemAction: vi.fn(),
  updateBudgetItemAction: vi.fn(),
  changeBudgetItemBookingStatusAction: vi.fn(),
  moveBudgetItemAction: vi.fn(),
  deleteBudgetItemAction: vi.fn(),
  resetBudgetDataAction: vi.fn(),
}));

vi.mock("@/actions/budget-items", () => actions);

import {
  ChangeBudgetItemBookingStatusForm,
  CreateBudgetItemForm,
  DeleteBudgetItemForm,
  EditBudgetItemForm,
  ResetBudgetDataForm,
} from "./budget-forms";

const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        if (!this.open) {
          this.setAttribute("open", "");
        }
      },
    });
  }

  if (typeof HTMLDialogElement.prototype.close !== "function") {
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement, returnValue = "") {
        if (!this.open) {
          return;
        }

        this.returnValue = returnValue;
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      },
    });
  }
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

function pressEscape(dialog: HTMLDialogElement) {
  const cancelEvent = new Event("cancel", { cancelable: true });
  fireEvent(dialog, cancelEvent);
  if (!cancelEvent.defaultPrevented) {
    dialog.close();
  }
  return cancelEvent;
}

function openEditDialog(name: string) {
  const trigger = screen.getByRole("button", {
    name: `編輯項目：${name}`,
  });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: "編輯花費項目",
  }) as HTMLDialogElement;
  return { dialog, trigger };
}

describe("budget item forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all fields with numeric-friendly hints and no trusted internal fields", () => {
    const { container } = render(
      <CreateBudgetItemForm workspaceId="workspace_internal" />,
    );

    expect(
      screen.getByRole("form", { name: "新增花費表單" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "記下婚禮花費" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新增花費項目" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("項目名稱")).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText("品項分類")).toHaveAttribute(
      "name",
      "taxonomyItemKey",
    );
    const taxonomy = screen.getByLabelText("品項分類");
    expect(taxonomy.tagName).toBe("SELECT");
    expect(
      within(taxonomy)
        .getAllByRole("group")
        .map((group) => group.getAttribute("label")),
    ).toEqual([
      "籌備第1-2月",
      "籌備第3個月",
      "籌備婚禮第4個月",
      "婚禮前倒數2個月",
      "文定儀式用品、工作人員紅包",
      "迎娶儀式用品、工作人員紅包",
    ]);
    expect(
      within(taxonomy)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "求婚",
      "婚宴場地",
      "婚紗照拍攝",
      "喜餅",
      "新娘秘書",
      "婚禮攝影",
      "婚禮錄影",
      "婚禮主持",
      "婚禮樂團",
      "婚禮互動",
      "禮服租借",
      "婚鞋",
      "婚禮佈置",
      "印喜帖及寄送",
      "保養療程",
      "婚禮小物",
      "文定儀式（男方準備）",
      "文定儀式（女方準備）",
      "迎娶儀式男方準備",
      "迎娶儀式女方準備",
    ]);
    expect(taxonomy).toHaveTextContent("婚宴場地");
    expect(taxonomy).not.toHaveTextContent("其他");
    expect(taxonomy).not.toHaveTextContent("待分類");
    const relatedTaxonomy = screen.getByLabelText("用途關聯（選填）");
    expect(relatedTaxonomy).toHaveAttribute(
      "name",
      "relatedTaxonomyItemKey",
    );
    expect(within(relatedTaxonomy).getAllByRole("group")).toHaveLength(6);
    expect(within(relatedTaxonomy).getAllByRole("option")).toHaveLength(21);
    expect(relatedTaxonomy).toHaveValue("");
    const relatedTaxonomyHelp = screen.getByText(
      "主分類回答錢花在哪裡；用途關聯回答這筆費用為哪個品項產生，不會重複計入總額。",
    );
    expect(relatedTaxonomyHelp).toHaveAttribute("id");
    expect(relatedTaxonomy).toHaveAttribute(
      "aria-describedby",
      relatedTaxonomyHelp.id,
    );
    expect(screen.getByLabelText("預計花費")).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(screen.getByLabelText(/實付金額/)).toHaveAttribute(
      "pattern",
      "[0-9]*",
    );
    expect(screen.getByLabelText(/付款期限/)).toHaveAttribute("type", "date");
    expect(screen.getByLabelText(/訂金費用/)).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(screen.getByLabelText(/尾款費用/)).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(screen.getByLabelText(/加購費用/)).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(screen.getByLabelText(/預估費用範圍/)).toBeInTheDocument();
    expect(screen.getByLabelText(/候選廠商或工作人員/)).toBeInTheDocument();
    expect(screen.getByLabelText(/確定廠商/)).toBeInTheDocument();
    expect(screen.getByLabelText(/廠商聯絡人/)).toBeInTheDocument();
    expect(screen.getByLabelText(/主要負責人/)).toBeInTheDocument();
    expect(screen.getByLabelText(/備註/)).not.toHaveAttribute("maxlength");
    expect(
      screen.getByText(
        "任一欄有值時，預計花費會由訂金、尾款與加購費用自動加總。",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container.querySelector('[name="itemId"]')).toBeNull();
    expect(container.querySelector('[name="paid"]')).toBeNull();
    expect(container).not.toHaveTextContent("workspace_internal");
  });

  it("keeps the category select mounted and focused after a keyboard selection", () => {
    render(<CreateBudgetItemForm workspaceId="workspace_internal" />);
    const category = screen.getByLabelText("品項分類");
    category.focus();

    fireEvent.change(category, { target: { value: "ITEM_WEDDING_VENUE" } });

    expect(screen.getByLabelText("品項分類")).toBe(category);
    expect(category).toHaveFocus();
  });


  it("submits an optional purpose relation and clears it when it becomes the primary classification", async () => {
    actions.createBudgetItemAction.mockResolvedValue({
      status: "success",
      message: "已新增花費項目。",
    });
    const { container } = render(
      <CreateBudgetItemForm workspaceId="workspace_internal" />,
    );
    fireEvent.change(screen.getByLabelText("項目名稱"), {
      target: { value: "拍攝禮服加購" },
    });
    fireEvent.change(screen.getByLabelText("品項分類"), {
      target: { value: "ITEM_ATTIRE_RENTAL" },
    });
    fireEvent.change(screen.getByLabelText("用途關聯（選填）"), {
      target: { value: "ITEM_PRE_WEDDING_PHOTOGRAPHY" },
    });
    fireEvent.change(screen.getByLabelText("預計花費"), {
      target: { value: "12000" },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(actions.createBudgetItemAction).toHaveBeenCalledOnce();
    });
    const submitted = actions.createBudgetItemAction.mock
      .calls[0][2] as FormData;
    expect(submitted.get("taxonomyItemKey")).toBe("ITEM_ATTIRE_RENTAL");
    expect(submitted.get("relatedTaxonomyItemKey")).toBe(
      "ITEM_PRE_WEDDING_PHOTOGRAPHY",
    );

    fireEvent.change(screen.getByLabelText("品項分類"), {
      target: { value: "ITEM_ATTIRE_RENTAL" },
    });
    fireEvent.change(screen.getByLabelText("用途關聯（選填）"), {
      target: { value: "ITEM_PRE_WEDDING_PHOTOGRAPHY" },
    });
    fireEvent.change(screen.getByLabelText("品項分類"), {
      target: { value: "ITEM_PRE_WEDDING_PHOTOGRAPHY" },
    });
    expect(screen.getByLabelText("用途關聯（選填）")).toHaveValue("");
  });

  it("requires an explicit Drive classification when a legacy category has no unique match", () => {
    render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="legacy_budget_internal"
        name="舊資料"
        category="OTHER_PENDING"
        taxonomyItemKey={null}
        plannedAmount={0}
        actualAmount={null}
        dueDate={null}
        bookingStatus="PLANNING"
        notes={null}
        expectedVersion={1}
      />,
    );

    openEditDialog("舊資料");
    const taxonomy = screen.getByLabelText("品項分類");
    expect(taxonomy).toBeRequired();
    expect(taxonomy).toHaveValue("");
    expect(within(taxonomy).getAllByRole("group")).toHaveLength(6);
    expect(within(taxonomy).getAllByRole("option")).toHaveLength(20);
    expect(taxonomy).not.toHaveTextContent("其他");
    expect(taxonomy).not.toHaveTextContent("待分類");
  });

  it("derives PLANNING blank, BOOKED deposit, and PAID full actual amounts without editable payment fields", () => {
    const { rerender } = render(
      <CreateBudgetItemForm workspaceId="workspace_internal" />,
    );
    const planned = screen.getByLabelText("預計花費");
    const actual = screen.getByLabelText(/實付金額/);
    const deposit = screen.getByLabelText(/訂金費用/);
    const balance = screen.getByLabelText(/尾款費用/);

    expect(planned).not.toHaveAttribute("readonly");
    expect(actual).toHaveAttribute("readonly");
    fireEvent.change(planned, { target: { value: "900" } });
    fireEvent.change(deposit, { target: { value: "100" } });
    fireEvent.change(balance, { target: { value: "250" } });
    expect(planned).toHaveValue("350");
    expect(planned).toHaveAttribute("readonly");
    expect(actual).toHaveValue("");

    fireEvent.change(deposit, { target: { value: "" } });
    fireEvent.change(balance, { target: { value: "" } });
    expect(planned).toHaveValue("900");
    expect(planned).not.toHaveAttribute("readonly");

    rerender(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="合成項目"
        category="VENUE_CATERING"
        plannedAmount={999}
        actualAmount={999}
        dueDate={null}
        depositAmount={100}
        balanceAmount={250}
        additionalAmount={50}
        bookingStatus="BOOKED_BALANCE_DUE"
        notes={null}
        expectedVersion={1}
      />,
    );
    expect(screen.getByLabelText("預計花費")).toHaveValue("400");
    expect(screen.getByLabelText("預計花費")).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/實付金額/)).toHaveValue("100");
    expect(screen.getByLabelText(/實付金額/)).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText(/加購費用/), {
      target: { value: "75" },
    });
    expect(screen.getByLabelText("預計花費")).toHaveValue("425");
    expect(screen.getByLabelText(/實付金額/)).toHaveValue("100");

    rerender(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="合成項目"
        category="VENUE_CATERING"
        plannedAmount={999}
        actualAmount={100}
        dueDate={null}
        depositAmount={100}
        balanceAmount={250}
        additionalAmount={75}
        bookingStatus="PAID"
        notes={null}
        expectedVersion={2}
      />,
    );
    expect(screen.getByLabelText("預計花費")).toHaveValue("425");
    expect(screen.getByLabelText(/實付金額/)).toHaveValue("425");
  });

  it("provides short contextual edit and remove entries with two-stage removal", async () => {
    const longName = "婚宴場地與餐飲完整花費項目".repeat(8);
    const onDeleteSuccess = vi.fn();
    actions.deleteBudgetItemAction.mockResolvedValueOnce({
      status: "success",
      message: "已移除花費項目。",
    });
    const { container } = render(
      <>
        <EditBudgetItemForm
          workspaceId="workspace_internal"
          itemId="budget_internal"
          name={longName}
          category="VENUE_CATERING"
          plannedAmount={120000}
          actualAmount={118000}
          dueDate="2028-02-29"
          notes="含訂金"
          expectedVersion={4}
        />
        <ChangeBudgetItemBookingStatusForm
          workspaceId="workspace_internal"
          itemId="budget_internal"
          bookingStatus="PLANNING"
          itemName={longName}
          expectedVersion={4}
        />
        <DeleteBudgetItemForm
          workspaceId="workspace_internal"
          itemId="budget_internal"
          name={longName}
          expectedVersion={4}
          onSuccess={onDeleteSuccess}
        />
      </>,
    );

    expect(
      screen.getByRole("form", { name: `更新狀態 ${longName}` }),
    ).toBeInTheDocument();
    const editEntry = screen.getByRole("button", {
      name: `編輯項目：${longName}`,
    });
    expect(editEntry).toHaveAttribute("type", "button");
    expect(editEntry).toHaveAccessibleName(`編輯項目：${longName}`);
    expect(editEntry).toHaveClass(
      "inline-flex",
      "min-h-11",
      "w-fit",
      "max-w-full",
      "items-center",
      "rounded-full",
      "border",
      "border-line",
      "px-4",
      "py-2",
      "text-clay",
      "transition",
      "hover:bg-clay-soft",
      "focus-visible:ring-2",
      "focus-visible:ring-clay",
    );
    expect(editEntry).not.toHaveClass(
      "underline",
      "decoration-line-strong",
      "underline-offset-4",
    );
    expect(editEntry.closest("details")).toBeNull();
    const editDialog = container.querySelector("dialog");
    expect(editDialog).not.toHaveAttribute("open");

    fireEvent.click(editEntry);

    expect(
      screen.getByRole("dialog", { name: "編輯花費項目" }),
    ).toHaveAttribute("open");
    expect(
      screen.getByRole("form", { name: `編輯 ${longName}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "儲存花費項目" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `更新下訂與付款狀態：${longName}`,
      }),
    ).toHaveClass("min-h-11");
    expect(screen.getByLabelText(`下訂與付款狀態：${longName}`)).toHaveValue(
      "PLANNING",
    );
    const removeEntry = screen.getByText("移除項目", { selector: "summary" });
    const removeDisclosure = removeEntry.closest("details");
    expect(removeEntry).toHaveAccessibleName(`移除項目：${longName}`);
    expect(removeEntry).toHaveClass(
      "inline-flex",
      "min-h-11",
      "w-fit",
      "max-w-full",
      "items-center",
      "rounded-control",
      "border",
      "border-danger/40",
      "px-4",
      "text-danger",
      "transition",
      "hover:bg-danger-soft",
    );
    expect(removeEntry).not.toHaveClass(
      "underline",
      "decoration-danger/40",
      "underline-offset-4",
    );
    expect(removeDisclosure).not.toHaveAttribute("open");
    expect(actions.deleteBudgetItemAction).not.toHaveBeenCalled();

    fireEvent.click(removeEntry);

    expect(removeDisclosure).toHaveAttribute("open");
    expect(actions.deleteBudgetItemAction).not.toHaveBeenCalled();
    expect(screen.getByText("此動作無法復原。")).toBeInTheDocument();
    expect(
      screen.getByText("只有在確認不再需要這筆花費紀錄時才繼續。"),
    ).toBeInTheDocument();
    const confirmRemove = screen.getByRole("button", {
      name: `確認移除：${longName}`,
    });
    expect(confirmRemove).toHaveTextContent("確認移除");
    expect(confirmRemove).toHaveClass("min-h-11", "max-w-full");
    expect(container.querySelector('[name="itemId"]')).toBeNull();
    expect(container.querySelector('[name="paid"]')).toBeNull();
    expect(container.querySelectorAll('[name="expectedVersion"]')).toHaveLength(
      3,
    );
    expect(container).not.toHaveTextContent("budget_internal");

    fireEvent.click(confirmRemove);
    await waitFor(() => {
      expect(actions.deleteBudgetItemAction).toHaveBeenCalledOnce();
    });
    const submitted = actions.deleteBudgetItemAction.mock
      .calls[0][3] as FormData;
    expect(submitted.get("expectedVersion")).toBe("4");
    expect(onDeleteSuccess).toHaveBeenCalledOnce();
  });

  it("opens an accessible native modal card and focuses the first editable field", () => {
    const name = "森林系婚宴場地";
    const { container } = render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name={name}
        category="VENUE_CATERING"
        plannedAmount={120000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={4}
      />,
    );
    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog).not.toHaveAttribute("open");

    const { dialog: openedDialog, trigger } = openEditDialog(name);

    expect(trigger).toHaveAttribute("type", "button");
    expect(openedDialog).toHaveAccessibleName("編輯花費項目");
    expect(
      screen.getByRole("heading", { name: "編輯花費項目" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "編輯花費層級路徑" }),
    ).toHaveTextContent(name);
    expect(screen.getByText("第 1 層")).toBeInTheDocument();
    expect(screen.getByLabelText("項目名稱")).toHaveFocus();
    expect(openedDialog).toHaveClass(
      "w-[calc(100%-2rem)]",
      "max-h-[calc(100dvh-2rem)]",
      "overflow-x-hidden",
      "overflow-y-auto",
      "bg-surface",
      "backdrop:bg-stone-950/30",
    );
    expect(openedDialog.querySelector("header")).toHaveClass("bg-surface");
    expect(openedDialog.querySelector("header")).not.toHaveClass(
      "bg-surface/95",
    );
    expect(screen.getByRole("button", { name: "儲存花費項目" })).toHaveClass(
      "min-h-11",
    );
    expect(screen.getByRole("button", { name: "取消" })).toHaveClass(
      "min-h-11",
    );
  });

  it("closes from either control or Escape, restores focus, and keeps a dirty draft", () => {
    const name = "婚宴攝影";
    render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name={name}
        category="PHOTOGRAPHY_VIDEO"
        plannedAmount={36000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={2}
      />,
    );

    let { dialog, trigger } = openEditDialog(name);
    fireEvent.change(screen.getByLabelText("項目名稱"), {
      target: { value: "尚未送出的婚宴攝影" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: `關閉編輯花費項目：${name}` }),
    );
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();

    ({ dialog, trigger } = openEditDialog(name));
    expect(screen.getByLabelText("項目名稱")).toHaveValue("尚未送出的婚宴攝影");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();

    ({ dialog, trigger } = openEditDialog(name));
    const cancelEvent = pressEscape(dialog);
    expect(cancelEvent.defaultPrevented).toBe(false);
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("closes only after a successful save and leaves server errors visible in the modal", async () => {
    actions.updateBudgetItemAction
      .mockResolvedValueOnce({
        status: "error",
        code: "UNAVAILABLE",
        message: "目前無法更新花費項目，請稍後再試。",
      })
      .mockResolvedValueOnce({
        status: "success",
        message: "已更新花費項目。",
      });
    const name = "婚宴主持";
    const { container } = render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name={name}
        category="OTHER_PENDING"
        plannedAmount={18000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={3}
      />,
    );
    const { dialog, trigger } = openEditDialog(name);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目前無法更新花費項目，請稍後再試。",
    );
    expect(dialog).toHaveAttribute("open");

    fireEvent.submit(form!);

    const successFeedback = await screen.findByRole("status");
    expect(successFeedback).toHaveTextContent("已更新花費項目。");
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
    expect(dialog).not.toContainElement(successFeedback);
    expect(successFeedback).toBeVisible();
    expect(trigger).toHaveFocus();

    openEditDialog(name);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("prevents every close path while a save is pending", async () => {
    let resolveUpdate:
      | ((value: {
          status: "error";
          code: "UNAVAILABLE";
          message: string;
        }) => void)
      | undefined;
    actions.updateBudgetItemAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const name = "喜餅";
    const { container } = render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name={name}
        category="RINGS_KEEPSAKES"
        plannedAmount={50000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={6}
      />,
    );
    const { dialog } = openEditDialog(name);
    fireEvent.submit(container.querySelector("form")!);

    const submit = await screen.findByRole("button", { name: "正在儲存…" });
    const close = screen.getByRole("button", {
      name: `關閉編輯花費項目：${name}`,
    });
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(submit).toBeDisabled();
    expect(close).toBeDisabled();
    expect(cancel).toBeDisabled();

    fireEvent.click(close);
    fireEvent.click(cancel);
    const cancelEvent = pressEscape(dialog);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(dialog).toHaveAttribute("open");

    await act(async () => {
      resolveUpdate?.({
        status: "error",
        code: "UNAVAILABLE",
        message: "目前無法更新花費項目，請稍後再試。",
      });
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(dialog).toHaveAttribute("open");
  });

  it("preserves create inputs after an error and resets only after success", async () => {
    actions.createBudgetItemAction
      .mockResolvedValueOnce({
        status: "error",
        code: "UNAVAILABLE",
        message: "目前無法新增花費項目，請稍後再試。",
      })
      .mockResolvedValueOnce({
        status: "success",
        message: "已新增花費項目。",
      });

    const { container } = render(
      <CreateBudgetItemForm workspaceId="workspace_internal" />,
    );
    const values = {
      name: screen.getByLabelText("項目名稱"),
      category: screen.getByLabelText("品項分類"),
      planned: screen.getByLabelText("預計花費"),
      actual: screen.getByLabelText(/實付金額/),
      dueDate: screen.getByLabelText(/付款期限/),
      notes: screen.getByLabelText(/備註/),
    };
    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    fireEvent.change(values.name, { target: { value: "🎉".repeat(120) } });
    fireEvent.change(values.category, {
      target: { value: "ITEM_WEDDING_VENUE" },
    });
    fireEvent.change(values.planned, { target: { value: "120000" } });
    fireEvent.change(values.actual, { target: { value: "118000" } });
    fireEvent.change(values.dueDate, { target: { value: "2028-02-29" } });
    fireEvent.change(values.notes, { target: { value: "保留備註" } });
    fireEvent.submit(form!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目前無法新增花費項目，請稍後再試。",
    );
    expect(values.name).toHaveValue("🎉".repeat(120));
    expect(values.planned).toHaveValue("120000");
    expect(values.notes).toHaveValue("保留備註");

    fireEvent.submit(form!);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已新增花費項目。",
    );
    await waitFor(() => {
      for (const [name, field] of Object.entries(values)) {
        if (name === "category") {
          continue;
        }
        expect(field).toHaveValue("");
      }
      expect(screen.getByLabelText("品項分類")).toHaveValue("");
    });
  });

  it("adopts a newer server snapshot while the edit form is pristine", async () => {
    const { container, rerender } = render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="原始項目"
        category="VENUE_CATERING"
        taxonomyItemKey="ITEM_WEDDING_VENUE"
        plannedAmount={120000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={4}
      />,
    );

    rerender(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="伺服器最新項目"
        category="PEOPLE_SERVICES"
        taxonomyItemKey="ITEM_WEDDING_HOST"
        plannedAmount={140000}
        actualAmount={135000}
        dueDate="2028-03-01"
        notes="最新備註"
        expectedVersion={5}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("項目名稱")).toHaveValue("伺服器最新項目");
      expect(screen.getByLabelText("品項分類")).toHaveValue(
        "ITEM_WEDDING_HOST",
      );
      expect(screen.getByLabelText("預計花費")).toHaveValue("140000");
      expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
        "5",
      );
    });
  });

  it("keeps a dirty draft paired with its old version across unrelated revalidation", async () => {
    const { container, rerender } = render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="原始項目"
        category="VENUE_CATERING"
        plannedAmount={120000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={4}
      />,
    );
    fireEvent.change(screen.getByLabelText("項目名稱"), {
      target: { value: "尚未送出的修改" },
    });
    fireEvent.change(screen.getByLabelText("預計花費"), {
      target: { value: "130000" },
    });

    rerender(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="其他人更新的項目"
        category="PEOPLE_SERVICES"
        plannedAmount={140000}
        actualAmount={135000}
        dueDate="2028-03-01"
        notes="其他人更新的備註"
        expectedVersion={5}
      />,
    );

    expect(screen.getByLabelText("項目名稱")).toHaveValue("尚未送出的修改");
    expect(screen.getByLabelText("品項分類")).toHaveValue("ITEM_WEDDING_VENUE");
    expect(screen.getByLabelText("預計花費")).toHaveValue("130000");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "4",
    );
  });

  it("preserves an attempted stale edit while rebasing the version", async () => {
    actions.updateBudgetItemAction.mockResolvedValueOnce({
      status: "error",
      code: "STALE",
      message: "資料已更新或不存在，請重新整理後再試。",
    });
    const { container, rerender } = render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="原始項目"
        category="VENUE_CATERING"
        plannedAmount={120000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={4}
      />,
    );
    const { dialog } = openEditDialog("原始項目");
    const name = screen.getByLabelText("項目名稱");
    const planned = screen.getByLabelText("預計花費");
    const form = container.querySelector("form");
    fireEvent.change(name, { target: { value: "修改後項目" } });
    fireEvent.change(planned, { target: { value: "130000" } });
    fireEvent.submit(form!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "資料已更新或不存在，請重新整理後再試。",
    );
    expect(dialog).toHaveAttribute("open");

    rerender(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="伺服器最新項目"
        category="PEOPLE_SERVICES"
        plannedAmount={140000}
        actualAmount={135000}
        dueDate="2028-03-01"
        notes="最新備註"
        expectedVersion={5}
      />,
    );

    expect(screen.getByLabelText("項目名稱")).toHaveValue("修改後項目");
    expect(screen.getByLabelText("預計花費")).toHaveValue("130000");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "資料已更新或不存在，請重新整理後再試。",
    );
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "5",
    );

    fireEvent.change(screen.getByLabelText(/備註/), {
      target: { value: "衝突後補充" },
    });
    rerender(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="伺服器再次更新"
        category="TRANSPORT_LODGING"
        plannedAmount={150000}
        actualAmount={145000}
        dueDate="2028-04-01"
        notes="另一筆更新"
        expectedVersion={6}
      />,
    );

    expect(screen.getByLabelText("項目名稱")).toHaveValue("修改後項目");
    expect(screen.getByLabelText(/備註/)).toHaveValue("衝突後補充");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "5",
    );
  });

  it("adopts the normalized server snapshot after its own successful edit", async () => {
    actions.updateBudgetItemAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新花費項目。",
    });
    const { container, rerender } = render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="原始項目"
        category="VENUE_CATERING"
        plannedAmount={120000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={4}
      />,
    );
    const { dialog } = openEditDialog("原始項目");
    fireEvent.change(screen.getByLabelText("項目名稱"), {
      target: { value: "  使用者修改  " },
    });
    fireEvent.submit(container.querySelector("form")!);
    const successFeedback = await screen.findByRole("status");
    expect(successFeedback).toHaveTextContent("已更新花費項目。");
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
    });
    expect(dialog).not.toContainElement(successFeedback);
    expect(successFeedback).toBeVisible();

    rerender(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="使用者修改"
        category="VENUE_CATERING"
        plannedAmount={120000}
        actualAmount={null}
        dueDate={null}
        notes={null}
        expectedVersion={5}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("項目名稱")).toHaveValue("使用者修改");
      expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
        "5",
      );
    });
  });

  it("treats every rich field as part of the pristine and dirty draft snapshot", async () => {
    const common = {
      workspaceId: "workspace_internal",
      itemId: "budget_internal",
      name: "合成項目",
      category: "OTHER_PENDING" as const,
      plannedAmount: 46500,
      actualAmount: 12000,
      dueDate: null,
      notes: "合成備註",
    };
    const { container, rerender } = render(
      <EditBudgetItemForm
        {...common}
        depositAmount={12000}
        balanceAmount={34000}
        additionalAmount={500}
        estimatedRange="合成估價 A"
        candidateVendors="合成候選 A"
        confirmedVendor="合成確認 A"
        vendorContact="contact-a@example.test"
        primaryContact="PARTNER_A"
        expectedVersion={4}
      />,
    );

    rerender(
      <EditBudgetItemForm
        {...common}
        depositAmount={13000}
        balanceAmount={35000}
        additionalAmount={600}
        estimatedRange="合成估價 B"
        candidateVendors="合成候選 B"
        confirmedVendor="合成確認 B"
        vendorContact="contact-b@example.test"
        primaryContact="PARTNER_B"
        expectedVersion={4}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/訂金費用/)).toHaveValue("13000");
      expect(screen.getByLabelText(/尾款費用/)).toHaveValue("35000");
      expect(screen.getByLabelText(/加購費用/)).toHaveValue("600");
      expect(screen.getByLabelText(/預估費用範圍/)).toHaveValue("合成估價 B");
      expect(screen.getByLabelText(/候選廠商或工作人員/)).toHaveValue(
        "合成候選 B",
      );
      expect(screen.getByLabelText(/確定廠商/)).toHaveValue("合成確認 B");
      expect(screen.getByLabelText(/廠商聯絡人/)).toHaveValue(
        "contact-b@example.test",
      );
      expect(screen.getByLabelText(/主要負責人/)).toHaveValue("PARTNER_B");
    });

    fireEvent.change(screen.getByLabelText(/廠商聯絡人/), {
      target: { value: "dirty-contact@example.test" },
    });
    rerender(
      <EditBudgetItemForm
        {...common}
        depositAmount={14000}
        balanceAmount={36000}
        additionalAmount={700}
        estimatedRange="合成估價 C"
        candidateVendors="合成候選 C"
        confirmedVendor="合成確認 C"
        vendorContact="contact-c@example.test"
        primaryContact={null}
        expectedVersion={5}
      />,
    );

    expect(screen.getByLabelText(/訂金費用/)).toHaveValue("13000");
    expect(screen.getByLabelText(/廠商聯絡人/)).toHaveValue(
      "dirty-contact@example.test",
    );
    expect(screen.getByLabelText(/主要負責人/)).toHaveValue("PARTNER_B");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "4",
    );
  });

  it("submits imported multiline rich fields byte-for-byte unchanged", async () => {
    actions.updateBudgetItemAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新花費項目。",
    });
    const estimatedRange = "NT$40,000\n～\nNT$60,000";
    const confirmedVendor = "合成廠商\n第二聯絡窗口";
    const vendorContact = "電話 0900\n信箱 contact@example.test";
    const { container } = render(
      <EditBudgetItemForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        name="合成項目"
        category="OTHER_PENDING"
        plannedAmount={46500}
        actualAmount={null}
        dueDate={null}
        estimatedRange={estimatedRange}
        confirmedVendor={confirmedVendor}
        vendorContact={vendorContact}
        notes={null}
        expectedVersion={4}
      />,
    );
    openEditDialog("合成項目");

    expect(screen.getByLabelText(/預估費用範圍/)).toHaveValue(estimatedRange);
    expect(screen.getByLabelText(/確定廠商/)).toHaveValue(confirmedVendor);
    expect(screen.getByLabelText(/廠商聯絡人/)).toHaveValue(vendorContact);
    fireEvent.change(screen.getByLabelText("項目名稱"), {
      target: { value: "只修改名稱" },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(actions.updateBudgetItemAction).toHaveBeenCalledOnce();
    });
    const submitted = actions.updateBudgetItemAction.mock
      .calls[0][3] as FormData;
    expect(submitted.get("estimatedRange")).toBe(estimatedRange);
    expect(submitted.get("confirmedVendor")).toBe(confirmedVendor);
    expect(submitted.get("vendorContact")).toBe(vendorContact);
  });

  it("keeps a dirty three-state status paired with its token and rebases once after STALE", async () => {
    actions.changeBudgetItemBookingStatusAction.mockResolvedValueOnce({
      status: "error",
      code: "STALE",
      message: "資料已更新或不存在，請重新整理後再試。",
    });
    const { container, rerender } = render(
      <ChangeBudgetItemBookingStatusForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        bookingStatus="PLANNING"
        itemName="合成項目"
        expectedVersion={4}
      />,
    );
    const select = screen.getByLabelText("下訂與付款狀態：合成項目");
    fireEvent.change(select, { target: { value: "PAID" } });

    rerender(
      <ChangeBudgetItemBookingStatusForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        bookingStatus="BOOKED_BALANCE_DUE"
        itemName="合成項目"
        expectedVersion={5}
      />,
    );
    expect(select).toHaveValue("PAID");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "4",
    );

    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "資料已更新或不存在，請重新整理後再試。",
    );
    rerender(
      <ChangeBudgetItemBookingStatusForm
        workspaceId="workspace_internal"
        itemId="budget_internal"
        bookingStatus="BOOKED_BALANCE_DUE"
        itemName="合成項目"
        expectedVersion={5}
      />,
    );
    expect(select).toHaveValue("PAID");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "5",
    );
  });

  it("keeps the Budget reset submit disabled until the owner confirms a prepared snapshot and exact normalized workspace name", async () => {
    actions.resetBudgetDataAction.mockResolvedValueOnce({
      status: "success",
      message: "已清除 37 筆花費與 2 個附件，Drive 固定分類已保留。",
    });
    const { container } = render(
      <ResetBudgetDataForm
        workspaceId="workspace_internal"
        workspaceName="我們的婚宴"
        snapshot={{
          token: "a".repeat(64),
          itemCount: 37,
          notionItemCount: 27,
          manualItemCount: 10,
          attachmentCount: 2,
        }}
      />,
    );
    fireEvent.click(
      screen.getByText("資料重建（僅 OWNER）"),
    );

    expect(
      screen.getByText("37 筆非系統花費（Notion 27 筆、手動 10 筆）"),
    ).toBeVisible();
    expect(
      screen.getByText(/保留 Drive 的 6 個籌備階段與 20 個固定品項分類/u),
    ).toBeVisible();
    expect(
      screen.getByText(/2 個附件將永久刪除，無法復原/u),
    ).toBeVisible();
    const submit = screen.getByRole("button", { name: "清除並準備重建" });
    expect(submit).toBeDisabled();

    const preparedSnapshotCheckbox = screen.getByRole("checkbox", {
      name: "我已備妥可重新匯入的 Notion snapshot",
    });
    act(() => preparedSnapshotCheckbox.click());
    expect(preparedSnapshotCheckbox).toBeChecked();
    expect(submit).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText('輸入「我們的婚宴」確認清除'),
      { target: { value: "  我們的婚宴  " } },
    );
    await waitFor(() => expect(submit).toBeEnabled());
    expect(
      container.querySelector('[name="expectedResetSnapshotToken"]'),
    ).toHaveValue("a".repeat(64));

    fireEvent.submit(screen.getByRole("form", { name: "清除花費資料" }));
    await waitFor(() => {
      expect(actions.resetBudgetDataAction).toHaveBeenCalledOnce();
    });
    const submitted = actions.resetBudgetDataAction.mock
      .calls[0][2] as FormData;
    expect(submitted.get("preparedSnapshot")).toBe("READY");
    expect(submitted.get("confirmationName")).toBe("  我們的婚宴  ");
    expect(submitted.get("expectedResetSnapshotToken")).toBe("a".repeat(64));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已清除 37 筆花費與 2 個附件",
    );
  });
});
