import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createWeddingTimelineItemAction: vi.fn(),
  updateWeddingTimelineItemAction: vi.fn(),
  deleteWeddingTimelineItemAction: vi.fn(),
  applyGeneralLunchTimelineTemplateAction: vi.fn(),
}));

vi.mock("@/actions/wedding-timeline", () => actions);

import {
  CreateWeddingTimelineItemForm,
  DeleteWeddingTimelineItemForm,
  EditWeddingTimelineItemForm,
  GeneralLunchTimelineTemplateForm,
} from "./timeline-forms";

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

const staff = [
  { id: "staff_1", roleName: "招待", personName: "小安" },
  { id: "staff_2", roleName: "主持", personName: "小美" },
];

describe("timeline forms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens accessible create/edit dialogs with time fields and zero-to-many staff", () => {
    render(
      <>
        <CreateWeddingTimelineItemForm
          workspaceId="workspace_internal"
          staff={staff}
        />
        <EditWeddingTimelineItemForm
          workspaceId="workspace_internal"
          itemId="item_internal"
          startTime="11:30"
          endTime="12:00"
          phase="迎賓"
          title="賓客入場"
          location={null}
          details={null}
          mediaCue={"迎賓音樂\n開場影片"}
          notes={null}
          assignedStaff={staff.slice(0, 1)}
          staff={staff}
          expectedVersion={3}
        />
      </>,
    );
    const createTrigger = screen.getByRole("button", {
      name: "新增流程項目",
    });
    fireEvent.click(createTrigger);
    const createDialog = screen.getByRole("dialog", {
      name: "新增婚禮流程",
    });
    expect(createDialog).toHaveAttribute("open");
    expect(within(createDialog).getByLabelText("開始時間")).toHaveFocus();
    expect(within(createDialog).getByLabelText("開始時間")).toHaveAttribute(
      "type",
      "time",
    );
    expect(within(createDialog).getByLabelText(/結束時間/)).toHaveAttribute(
      "type",
      "time",
    );
    expect(within(createDialog).getByLabelText("階段")).toHaveAttribute(
      "maxlength",
      "60",
    );
    expect(within(createDialog).getByLabelText("流程項目")).toHaveAttribute(
      "maxlength",
      "120",
    );
    const createMediaCue = within(createDialog).getByLabelText(
      "音樂／影片（選填）",
    );
    expect(createMediaCue.tagName).toBe("TEXTAREA");
    expect(createMediaCue).toHaveAttribute("name", "mediaCue");
    expect(createMediaCue).toHaveAttribute("maxlength", "500");
    expect(
      within(createDialog).getByRole("group", {
        name: "負責工作人員",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(createDialog).getByRole("button", {
        name: "關閉新增婚禮流程",
      }),
    );
    expect(createDialog).not.toHaveAttribute("open");
    expect(createTrigger).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "編輯 賓客入場" }));
    const editDialog = screen.getByRole("dialog", {
      name: "編輯婚禮流程",
    });
    expect(editDialog).toHaveAttribute("open");
    expect(within(editDialog).getByLabelText("開始時間")).toHaveFocus();
    expect(
      within(editDialog).getByLabelText("招待・小安", {
        selector: "input",
      }),
    ).toBeChecked();
    expect(
      document.querySelector('[name="expectedVersion"][value="3"]'),
    ).toBeInTheDocument();
    expect(
      within(editDialog).getByLabelText("音樂／影片（選填）"),
    ).toHaveValue("迎賓音樂\n開場影片");
  });

  it("wraps reverse Tab from the first control to the last dialog control", () => {
    render(
      <CreateWeddingTimelineItemForm
        workspaceId="workspace_internal"
        staff={staff}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新增流程項目" }));
    const dialog = screen.getByRole("dialog", { name: "新增婚禮流程" });
    const first = within(dialog).getByRole("button", {
      name: "關閉新增婚禮流程",
    });
    const last = within(dialog).getByRole("button", {
      name: "新增流程項目",
    });

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });

    expect(last).toHaveFocus();
  });

  it("wraps unbroken staff labels and edit controls inside dialogs", () => {
    const roleName = "R".repeat(60);
    const personName = "P".repeat(120);
    const title = "T".repeat(120);
    const longStaff = [{ ...staff[0], roleName, personName }];
    render(
      <>
        <EditWeddingTimelineItemForm
          workspaceId="workspace_internal"
          itemId="item_internal"
          startTime="11:30"
          endTime={null}
          phase="迎賓"
          title={title}
          location={null}
          details={null}
          mediaCue={null}
          notes={null}
          assignedStaff={longStaff}
          staff={longStaff}
          expectedVersion={3}
        />
        <DeleteWeddingTimelineItemForm
          workspaceId="workspace_internal"
          itemId="item_internal"
          title={title}
          expectedVersion={3}
        />
      </>,
    );
    const trigger = screen.getByRole("button", { name: `編輯 ${title}` });
    expect(trigger).toHaveClass(
      "max-w-full",
      "min-w-0",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
    expect(within(trigger).getByText(`編輯 ${title}`)).toHaveClass(
      "min-w-0",
      "whitespace-normal",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
    fireEvent.click(trigger);
    const label = within(
      screen.getByRole("dialog", { name: "編輯婚禮流程" }),
    ).getByText(`${roleName}・${personName}`);
    expect(label).toHaveClass(
      "min-w-0",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
    expect(label.closest("label")).toHaveClass("min-w-0");
    expect(label.closest("label")?.querySelector('input[type="checkbox"]')).toHaveClass(
      "shrink-0",
    );
    const deleteLabel = screen.getByText(`刪除 ${title}`);
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

  it("labels the editable template as detailed and never exposes source identifiers", () => {
    const { container } = render(
      <GeneralLunchTimelineTemplateForm workspaceId="workspace_internal" />,
    );
    expect(
      screen.getByRole("button", { name: "建立詳細午宴流程範本" }),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("匯入");
  });

  it("keeps the dialog and entered media cue after an error", async () => {
    actions.createWeddingTimelineItemAction.mockResolvedValueOnce({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法新增流程項目，請稍後再試。",
    });
    const { container } = render(
      <CreateWeddingTimelineItemForm
        workspaceId="workspace_internal"
        staff={staff}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新增流程項目" }));
    const dialog = screen.getByRole("dialog", { name: "新增婚禮流程" });
    const mediaCue = within(dialog).getByLabelText("音樂／影片（選填）");
    fireEvent.change(mediaCue, { target: { value: "迎賓音樂\n開場影片" } });
    fireEvent.submit(container.querySelector("form")!);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "目前無法新增流程項目，請稍後再試。",
    );
    expect(dialog).toHaveAttribute("open");
    expect(mediaCue).toHaveValue("迎賓音樂\n開場影片");
  });

  it("blocks dialog closing while a timeline mutation is pending", async () => {
    let resolveCreate:
      | ((value: {
          status: "error";
          code: "UNAVAILABLE";
          message: string;
        }) => void)
      | undefined;
    actions.createWeddingTimelineItemAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { container } = render(
      <CreateWeddingTimelineItemForm
        workspaceId="workspace_internal"
        staff={staff}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新增流程項目" }));
    const dialog = screen.getByRole("dialog", { name: "新增婚禮流程" });
    fireEvent.submit(container.querySelector("form")!);

    const submit = await within(dialog).findByRole("button", {
      name: "新增中…",
    });
    const close = within(dialog).getByRole("button", {
      name: "關閉新增婚禮流程",
    });
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    expect(submit).toBeDisabled();
    expect(close).toBeDisabled();
    expect(cancel).toBeDisabled();
    fireEvent.click(close);
    fireEvent.click(cancel);
    const cancelEvent = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(dialog).toHaveAttribute("open");

    await act(async () => {
      resolveCreate?.({
        status: "error",
        code: "UNAVAILABLE",
        message: "目前無法新增流程項目，請稍後再試。",
      });
    });
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
  });

  it("closes the create dialog and restores focus after a successful mutation", async () => {
    actions.createWeddingTimelineItemAction.mockResolvedValue({
      status: "success",
      message: "已新增流程項目。",
    });
    render(
      <CreateWeddingTimelineItemForm
        workspaceId="workspace_internal"
        staff={staff}
      />,
    );

    const trigger = screen.getByRole("button", { name: "新增流程項目" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "新增婚禮流程" });
    fireEvent.change(within(dialog).getByLabelText("流程項目"), {
      target: { value: "新人進場" },
    });
    fireEvent.change(within(dialog).getByLabelText("音樂／影片（選填）"), {
      target: { value: "進場音樂" },
    });
    fireEvent.click(
      within(dialog).getByLabelText("招待・小安", { selector: "input" }),
    );
    fireEvent.submit(
      within(dialog)
        .getByRole("button", { name: "新增流程項目" })
        .closest("form")!,
    );

    await waitFor(() => {
      expect(dialog).not.toHaveAttribute("open");
      expect(screen.getByText("已新增流程項目。")).toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(within(dialog).getByLabelText("流程項目")).toHaveValue("");
    expect(within(dialog).getByLabelText("音樂／影片（選填）")).toHaveValue("");
    expect(
      within(dialog).getByLabelText("招待・小安", { selector: "input" }),
    ).not.toBeChecked();
  });

  it("keeps timeline fields and assignments paired with the original CAS token", async () => {
    actions.updateWeddingTimelineItemAction.mockResolvedValue({
      status: "error",
      code: "STALE",
      message: "資料已被其他人更新，請重新整理後再試。",
    });
    const initialProps = {
      workspaceId: "workspace_internal",
      itemId: "item_internal",
      startTime: "11:30",
      endTime: "12:00",
      phase: "迎賓",
      title: "賓客入場",
      location: null,
      details: "v1",
      mediaCue: "v1 音樂",
      notes: null,
      assignedStaff: staff.slice(0, 1),
      staff,
      expectedVersion: 3,
    };
    const { rerender } = render(
      <EditWeddingTimelineItemForm {...initialProps} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "編輯 賓客入場" }));
    const dialog = screen.getByRole("dialog", { name: "編輯婚禮流程" });
    fireEvent.change(within(dialog).getByLabelText("音樂／影片（選填）"), {
      target: { value: "使用者尚未儲存的 v1 音樂" },
    });
    fireEvent.click(
      within(dialog).getByLabelText("主持・小美", { selector: "input" }),
    );
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "資料已被其他人更新",
    );

    rerender(
      <EditWeddingTimelineItemForm
        {...initialProps}
        details="協作者 v2"
        mediaCue="協作者 v2 音樂"
        assignedStaff={staff.slice(1)}
        expectedVersion={4}
      />,
    );

    expect(within(dialog).getByLabelText("音樂／影片（選填）")).toHaveValue(
      "使用者尚未儲存的 v1 音樂",
    );
    expect(
      within(dialog).getByLabelText("招待・小安", { selector: "input" }),
    ).toBeChecked();
    expect(
      within(dialog).getByLabelText("主持・小美", { selector: "input" }),
    ).toBeChecked();
    const formData = new FormData(dialog.querySelector("form")!);
    expect(formData.get("expectedVersion")).toBe("3");
    expect(formData.getAll("staffIds")).toEqual(["staff_1", "staff_2"]);
  });
});
