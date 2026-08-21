import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installModalDialogPolyfill } from "@/test/modal-dialog";

const actions = vi.hoisted(() => ({
  adjustSeatingTablesAction: vi.fn(),
  createSeatingTableAction: vi.fn(),
  updateSeatingTableAction: vi.fn(),
  deleteSeatingTableAction: vi.fn(),
  assignGuestToTableAction: vi.fn(),
  unassignGuestFromTableAction: vi.fn(),
}));

vi.mock("@/actions/seating-tables", () => actions);

installModalDialogPolyfill();

import {
  AdjustSeatingTablesForm,
  SeatingTableActionFeedback,
  SeatingTableAdjustmentConfirmation,
  AssignGuestForm,
  CreateSeatingTableForm,
  DeleteSeatingTableForm,
  EditSeatingTableForm,
  UnassignGuestForm,
} from "./table-forms";

describe("seating table forms", () => {
  beforeEach(() => {
    for (const action of Object.values(actions)) {
      action.mockReset();
    }
  });

  it("offers a bounded, mobile-safe total table count setup with a new-table capacity", () => {
    const { container } = render(
      <AdjustSeatingTablesForm
        workspaceId="workspace_internal"
        currentTableCount={12}
      />,
    );

    expect(screen.getByRole("heading", { name: "桌數設定" })).toBeInTheDocument();
    expect(screen.getByLabelText("總桌數")).toHaveValue(12);
    expect(screen.getByLabelText("總桌數")).toHaveAttribute("min", "0");
    expect(screen.getByLabelText("總桌數")).toHaveAttribute("max", "200");
    expect(screen.getByLabelText("新增桌的預設容量")).toHaveValue(10);
    expect(
      screen.getByText("既有桌次的桌名、容量與賓客安排不會在增加桌數時被覆寫。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "套用桌數設定" })).toHaveClass(
      "min-h-11",
    );
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
  });

  it("keeps a table-count draft until the server count actually changes", () => {
    const { rerender } = render(
      <AdjustSeatingTablesForm
        workspaceId="workspace_internal"
        currentTableCount={1}
      />,
    );
    const tableCount = screen.getByLabelText("總桌數");

    fireEvent.change(tableCount, { target: { value: "7" } });
    expect(tableCount).toHaveValue(7);

    rerender(
      <AdjustSeatingTablesForm
        workspaceId="workspace_internal"
        currentTableCount={1}
      />,
    );
    expect(screen.getByLabelText("總桌數")).toHaveValue(7);

    rerender(
      <AdjustSeatingTablesForm
        workspaceId="workspace_internal"
        currentTableCount={2}
      />,
    );
    expect(screen.getByLabelText("總桌數")).toHaveValue(2);
  });

  it("keeps the successful table-count status mounted when the authoritative count changes", async () => {
    actions.adjustSeatingTablesAction.mockResolvedValueOnce({
      status: "success",
      message: "已將總桌數設定為 2 桌。",
    });
    const { rerender } = render(
      <AdjustSeatingTablesForm
        workspaceId="workspace_internal"
        currentTableCount={1}
      />,
    );

    fireEvent.change(screen.getByLabelText("總桌數"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "套用桌數設定" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("已將總桌數設定為 2 桌。");
    await waitFor(() => expect(status).toHaveFocus());

    rerender(
      <AdjustSeatingTablesForm
        workspaceId="workspace_internal"
        currentTableCount={2}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "已將總桌數設定為 2 桌。",
    );
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByLabelText("總桌數")).toHaveValue(2);
  });

  it("disables destructive adjustment controls while the action is pending", async () => {
    let resolveAction:
      | ((state: { status: "success"; message: string }) => void)
      | undefined;
    actions.adjustSeatingTablesAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    render(
      <AdjustSeatingTablesForm
        workspaceId="workspace_internal"
        currentTableCount={2}
      />,
    );

    fireEvent.change(screen.getByLabelText("總桌數"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "套用桌數設定" }));

    await waitFor(() => {
      expect(screen.getByLabelText("總桌數")).toBeDisabled();
      expect(screen.getByLabelText("新增桌的預設容量")).toBeDisabled();
    });

    resolveAction?.({
      status: "success",
      message: "已將總桌數設定為 3 桌。",
    });
    await screen.findByText("已將總桌數設定為 3 桌。");
  });

  it("renders the complete destructive snapshot without promising automatic unassignment", () => {
    const { container } = render(
      <SeatingTableAdjustmentConfirmation
        confirmation={{
          operation: "adjust-table-count",
          targetTableCount: 6,
          removedTableCount: 2,
          affectedGuestGroupCount: 3,
          affectedGuestPartySize: 7,
          canConfirm: false,
          fingerprint: `vowbook-seating-removal-v1:${"a".repeat(64)}`,
          tables: [
            {
              position: 7,
              name: "自訂親友桌",
              capacity: 12,
              notes: "靠近出口",
              affectedGuestGroupCount: 3,
              affectedGuestPartySize: 7,
            },
            {
              position: 8,
              name: "備用空桌",
              capacity: 8,
              notes: null,
              affectedGuestGroupCount: 0,
              affectedGuestPartySize: 0,
            },
          ],
        }}
        onCancel={vi.fn()}
        pending
      />,
    );

    expect(
      screen.getByRole("heading", { name: "確認縮減桌數" }),
    ).toBeInTheDocument();
    expect(screen.getByText("將移除名單中的 2 桌。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "自訂親友桌" })).toBeInTheDocument();
    expect(screen.getByText(/容量 12 位/u)).toBeInTheDocument();
    expect(container).not.toHaveTextContent("順位");
    expect(screen.getByText("備註：靠近出口")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "備用空桌" })).toBeInTheDocument();
    expect(screen.getByText("無備註")).toBeInTheDocument();
    expect(
      screen.getByText("合計受影響 3 組、7 位賓客。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("仍有賓客的桌次不能移除，請先移動賓客。"),
    ).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/移回未安排/u)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消並放棄確認" }),
    ).toHaveAttribute("type", "button");
    expect(
      screen.getByRole("button", { name: "取消並放棄確認" }),
    ).toBeDisabled();
    expect(container.querySelector('[name="snapshotFingerprint"]')).toHaveValue(
      `vowbook-seating-removal-v1:${"a".repeat(64)}`,
    );
    expect(
      container.querySelector('[name="confirmedTargetTableCount"]'),
    ).toBeNull();
  });

  it("announces a stale destructive preview as an alert", () => {
    render(
      <SeatingTableActionFeedback
        state={{
          status: "confirmation",
          stale: true,
          message: "桌次或賓客安排已變更，請重新確認最新影響。",
          confirmation: {
            operation: "delete-table",
            targetTableCount: 0,
            removedTableCount: 1,
            affectedGuestGroupCount: 0,
            affectedGuestPartySize: 0,
            canConfirm: true,
            fingerprint: `vowbook-seating-removal-v1:${"b".repeat(64)}`,
            tables: [],
          },
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "桌次或賓客安排已變更，請重新確認最新影響。",
    );
  });

  it("shows only table fields and does not render internal id inputs", () => {
    const { container } = render(
      <CreateSeatingTableForm workspaceId="workspace_internal" />,
    );

    expect(screen.getByLabelText("桌名")).toBeInTheDocument();
    expect(screen.getByLabelText("容量")).toHaveAttribute("max", "100");
    expect(screen.getByLabelText("桌名")).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText(/備註/)).not.toHaveAttribute("maxlength");
    expect(container.querySelector("form")).not.toHaveAttribute("novalidate");
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container.querySelector('[name="tableId"]')).toBeNull();
    expect(container.querySelector('[name="userId"]')).toBeNull();
    expect(container).not.toHaveTextContent("workspace_internal");
  });

  it("closes the create dialog without taking focus from the persistent success status", async () => {
    actions.createSeatingTableAction.mockResolvedValueOnce({
      status: "success",
      message: "已新增桌次。",
    });
    const { container } = render(
      <CreateSeatingTableForm workspaceId="workspace_internal" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新增桌次" }));
    const dialog = container.querySelector("dialog");
    expect(dialog).toHaveAttribute("open");

    fireEvent.change(screen.getByLabelText("桌名"), {
      target: { value: "主桌" },
    });
    fireEvent.click(
      within(dialog as HTMLDialogElement).getByRole("button", {
        name: "新增桌次",
      }),
    );

    const status = await screen.findByRole("status");
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(status).toHaveTextContent("已新增桌次。");
    expect(status).toBeVisible();
    await waitFor(() => expect(status).toHaveFocus());
  });

  it("closes the edit dialog without taking focus from the persistent success status", async () => {
    actions.updateSeatingTableAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新桌次。",
    });
    const { container } = render(
      <EditSeatingTableForm
        workspaceId="workspace_internal"
        tableId="table_internal"
        tableLabel="5 號桌 測試桌"
        name="原始桌名"
        capacity={8}
        notes={null}
        version={3}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "編輯 5 號桌 測試桌" }),
    );
    const dialog = container.querySelector("dialog");
    expect(dialog).toHaveAttribute("open");

    fireEvent.click(
      within(dialog as HTMLDialogElement).getByRole("button", {
        name: "儲存桌次",
      }),
    );

    const status = await screen.findByRole("status");
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(status).toHaveTextContent("已更新桌次。");
    expect(status).toBeVisible();
    await waitFor(() => expect(status).toHaveFocus());
  });

  it("keeps the edit and delete triggers compact however long the table name is", () => {
    const longName = "很長的親友桌名稱".repeat(8);
    const longLabel = `5 號桌 ${longName}`;
    const { container } = render(
      <>
        <EditSeatingTableForm
          workspaceId="workspace_internal"
          tableId="table_internal"
          tableLabel={longLabel}
          name={longName}
          capacity={10}
          notes={null}
          version={3}
        />
        <DeleteSeatingTableForm
          workspaceId="workspace_internal"
          tableId="table_internal"
          tableLabel={longLabel}
        />
      </>,
    );

    // 觸發鈕只印動作名稱，桌號與桌名留在無障礙名稱裡：長桌名印在鈕上會把
    // 整張卡片的操作列撐開成好幾行。
    const editTrigger = screen.getByRole("button", { name: `編輯 ${longLabel}` });
    expect(editTrigger).toHaveClass("break-words", "min-h-11");
    expect(editTrigger).toHaveTextContent(/^編輯$/u);
    const deleteTrigger = screen.getByText("刪除", { selector: "summary" });
    expect(deleteTrigger).toHaveClass("break-words", "min-h-11");
    expect(deleteTrigger).toHaveAttribute("aria-label", `刪除 ${longLabel}`);
    expect(
      screen.getByRole("button", { name: `預覽刪除 ${longLabel}` }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/移回未安排/u)).not.toBeInTheDocument();
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue("3");
    expect(screen.queryByText("table_internal")).not.toBeInTheDocument();
  });

  it("keeps a dirty edit draft paired with its original CAS version", () => {
    const { container, rerender } = render(
      <EditSeatingTableForm
        workspaceId="workspace_internal"
        tableId="table_internal"
        tableLabel="5 號桌 測試桌"
        name="原始桌名"
        capacity={8}
        notes="原始備註"
        version={3}
      />,
    );

    fireEvent.change(screen.getByLabelText("桌名"), {
      target: { value: "尚未送出的桌名" },
    });
    fireEvent.change(screen.getByLabelText("容量"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText(/備註/u), {
      target: { value: "尚未送出的備註" },
    });

    rerender(
      <EditSeatingTableForm
        workspaceId="workspace_internal"
        tableId="table_internal"
        tableLabel="5 號桌 測試桌"
        name="伺服器新桌名"
        capacity={10}
        notes="伺服器新備註"
        version={4}
      />,
    );

    expect(screen.getByLabelText("桌名")).toHaveValue("尚未送出的桌名");
    expect(screen.getByLabelText("容量")).toHaveValue(12);
    expect(screen.getByLabelText(/備註/u)).toHaveValue("尚未送出的備註");
    expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
      "3",
    );
  });

  it("synchronizes a pristine edit form to the latest server snapshot", async () => {
    const { container, rerender } = render(
      <EditSeatingTableForm
        workspaceId="workspace_internal"
        tableId="table_internal"
        tableLabel="5 號桌 測試桌"
        name="原始桌名"
        capacity={8}
        notes="原始備註"
        version={3}
      />,
    );

    rerender(
      <EditSeatingTableForm
        workspaceId="workspace_internal"
        tableId="table_internal"
        tableLabel="5 號桌 測試桌"
        name="伺服器新桌名"
        capacity={10}
        notes="伺服器新備註"
        version={4}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("桌名")).toHaveValue("伺服器新桌名");
      expect(screen.getByLabelText("容量")).toHaveValue(10);
      expect(screen.getByLabelText(/備註/u)).toHaveValue("伺服器新備註");
      expect(container.querySelector('[name="expectedVersion"]')).toHaveValue(
        "4",
      );
    });
  });

  it("records delete intent only for the confirmed submit and locks cancellation while pending", async () => {
    const confirmation = {
      status: "confirmation" as const,
      message: "請確認刪除空桌。",
      confirmation: {
        operation: "delete-table" as const,
        targetTableCount: 0,
        removedTableCount: 1,
        affectedGuestGroupCount: 0,
        affectedGuestPartySize: 0,
        canConfirm: true,
        fingerprint: `vowbook-seating-removal-v1:${"c".repeat(64)}`,
        tables: [
          {
            position: 1,
            name: "待刪空桌",
            capacity: 10,
            notes: null,
            affectedGuestGroupCount: 0,
            affectedGuestPartySize: 0,
          },
        ],
      },
    };
    let resolveDelete:
      | ((state: { status: "error"; message: string }) => void)
      | undefined;
    actions.deleteSeatingTableAction
      .mockResolvedValueOnce(confirmation)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
      );
    const onDeleteIntent = vi.fn();
    const { container } = render(
      <DeleteSeatingTableForm
        workspaceId="workspace_internal"
        tableId="table_internal"
        tableLabel="5 號桌 測試桌"
        onDeleteIntent={onDeleteIntent}
      />,
    );

    const summary = screen.getByText("刪除", { selector: "summary" });
    const disclosure = container.querySelector("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");

    fireEvent.click(
      screen.getByRole("button", { name: "預覽刪除 5 號桌 測試桌" }),
    );
    await screen.findByRole("heading", { name: "確認刪除桌次" });
    expect(onDeleteIntent).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "確認刪除空桌 5 號桌 測試桌" }),
    );
    expect(onDeleteIntent).toHaveBeenCalledWith({
      tableId: "table_internal",
      tableName: "5 號桌 測試桌",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "取消並放棄確認" }),
      ).toBeDisabled(),
    );
    expect(summary).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");

    resolveDelete?.({ status: "error", message: "刪除失敗。" });
    const feedback = await screen.findByRole("alert");
    await waitFor(() => expect(feedback).toHaveFocus());
    expect(feedback).toBeVisible();
    expect(disclosure).toHaveAttribute("open");
    expect(summary).not.toHaveAttribute("aria-disabled");

    fireEvent.click(summary);
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("binds assignment ids without displaying them as user-facing copy", () => {
    const { container } = render(
      <>
        <AssignGuestForm
          workspaceId="workspace_internal"
          guestId="guest_internal"
          guestName="王小明"
          guestPartySize={2}
          tables={[
            { id: "table_internal", name: "主桌", remainingCapacity: 6 },
            { id: "table_full", name: "已滿親友桌", remainingCapacity: 1 },
          ]}
        />
        <UnassignGuestForm
          workspaceId="workspace_internal"
          guestId="guest_internal"
          guestName="王小明"
        />
      </>,
    );

    expect(screen.getByLabelText("為王小明選擇桌次")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "主桌（剩餘 6 位）" })).toHaveValue(
      "table_internal",
    );
    expect(
      screen.getByRole("option", { name: "已滿親友桌（剩餘 1 位）" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "安排王小明" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "將王小明移出桌次" })).toHaveClass(
      "min-h-11",
    );
    expect(screen.getByLabelText("為王小明選擇桌次").closest("form")).not.toHaveAttribute(
      "novalidate",
    );
    expect(container.querySelector('[name="guestId"]')).toBeNull();
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
  });
});
