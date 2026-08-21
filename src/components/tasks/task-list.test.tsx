import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./task-forms", () => ({
  CreateWeddingTaskDialog: () => <button>新增任務表單</button>,
  EditWeddingTaskForm: ({
    title,
    expectedVersion,
  }: {
    title: string;
    expectedVersion: number;
  }) => (
    <label>
      編輯 {title}
      <input aria-label={`編輯內容 ${title}`} defaultValue={title} />
      <input
        type="hidden"
        name="expectedVersion"
        value={expectedVersion}
        readOnly
      />
    </label>
  ),
  DeleteWeddingTaskForm: ({ title }: { title: string }) => (
    <button>刪除 {title}</button>
  ),
  ChangeWeddingTaskStatusForm: ({ label }: { label: string }) => (
    <button>{label}</button>
  ),
}));

import { WeddingTaskList, type WeddingTaskListItem } from "./task-list";

const tasks: WeddingTaskListItem[] = [
  {
    id: "task_todo_internal",
    title: "確認婚宴流程",
    description: "與主持人逐項確認",
    dueDate: "2027-04-01",
    status: "TODO",
    completedAt: null,
    version: 1,
  },
  {
    id: "task_progress_internal",
    title: "確認場地動線",
    description: null,
    dueDate: null,
    status: "IN_PROGRESS",
    completedAt: null,
    version: 2,
  },
  {
    id: "task_done_internal",
    title: "預訂場地",
    description: "訂金已付款",
    dueDate: "2027-03-01",
    status: "DONE",
    completedAt: "2027-02-15T08:09:10.000Z",
    version: 3,
  },
];

describe("WeddingTaskList", () => {
  it("shows one useful empty state instead of duplicate active and completed panels", () => {
    render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={[]}
        canEdit={false}
      />,
    );

    expect(screen.getByText("尚未建立婚宴任務。")).toBeInTheDocument();
    expect(
      screen.getByText("可以編輯此工作區的成員尚未加入任務。"),
    ).toHaveClass("text-ink-soft");
    expect(
      screen.queryByRole("region", { name: "婚宴任務清單" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the direct create path without redundant empty sections to editors", () => {
    const { container } = render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={[]}
        canEdit
      />,
    );

    expect(screen.getByText("尚未建立婚宴任務。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增任務表單" })).toBeInTheDocument();
    expect(screen.queryByText("這一區目前沒有任務。")).not.toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("omits a large completed empty panel while active work exists", () => {
    render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={[tasks[0]]}
        canEdit={false}
      />,
    );

    expect(
      screen.getByRole("region", { name: "婚宴任務清單" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("這一區目前沒有任務。")).not.toBeInTheDocument();
  });

  it("narrows the list by keyword and by status without losing the others", () => {
    render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={tasks}
        canEdit={false}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "搜尋任務" }), {
      target: { value: "動線" },
    });
    expect(
      screen.getByRole("heading", { name: "確認場地動線" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "預訂場地" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜尋任務" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /已完成/u }));
    expect(
      screen.getByRole("heading", { name: "預訂場地" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "確認婚宴流程" }),
    ).not.toBeInTheDocument();
  });

  it("flags an unfinished task whose due date has already passed", () => {
    render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={tasks}
        canEdit={false}
        today="2027-06-01"
      />,
    );

    // 已完成的「預訂場地」到期日雖然更早，但不應標記逾期。
    expect(screen.getByText("到期日：2027-04-01（已逾期）")).toBeInTheDocument();
    expect(screen.getByText("到期日：2027-03-01")).toBeInTheDocument();
  });

  it("renders labels, dates, descriptions, and long text safely for VIEWER", () => {
    const longTitle = "這是一項很長而且需要完整換行的婚宴任務".repeat(8);
    const longDescription = "這段說明也需要在窄畫面安全換行".repeat(20);
    const { container } = render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={[
          ...tasks,
          {
            ...tasks[0],
            id: "task_long_internal",
            title: longTitle,
            description: longDescription,
          },
        ]}
        canEdit={false}
      />,
    );

    expect(screen.getAllByText("到期日：2027-04-01")).toHaveLength(2);
    expect(screen.getByText("未設定到期日")).toBeInTheDocument();
    expect(screen.getByText(/完成於/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: longTitle })).toHaveClass(
      "break-words",
    );
    expect(screen.getByText(longDescription)).toHaveClass("break-words");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // 狀態徽章只計算清單內的，避免把工具列的篩選籤也算進去。
    const list = screen.getByRole("region", { name: "婚宴任務清單" });
    expect(within(list).getAllByText("待辦")).toHaveLength(2);
    expect(within(list).getByText("進行中")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("workspace_internal");
    expect(container).not.toHaveTextContent("task_todo_internal");
  });

  it("renders untrusted title and description only as text nodes", () => {
    const malicious = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={[
          {
            ...tasks[0],
            title: malicious,
            description: `<script>${malicious}</script>`,
          },
        ]}
        canEdit={false}
      />,
    );

    expect(screen.getByRole("heading", { name: malicious })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("keeps every editor action on the record without an inline create disclosure", () => {
    const { container } = render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={tasks}
        canEdit
      />,
    );

    expect(screen.getByText("編輯 確認婚宴流程")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "標記完成" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "移回待辦" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "重新進行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刪除 預訂場地" })).toBeInTheDocument();

    // 新增入口已移到頁面標題列，清單內不再有展開式表單。
    expect(container.querySelector("details")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "新增任務表單" }),
    ).not.toBeInTheDocument();
  });

  it("preserves a stale attempted edit while rebasing its version token", () => {
    const { rerender } = render(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={[tasks[0]]}
        canEdit
      />,
    );
    const editor = screen.getByLabelText("編輯內容 確認婚宴流程");
    fireEvent.change(editor, { target: { value: "瀏覽器中的舊內容" } });

    rerender(
      <WeddingTaskList
        workspaceId="workspace_internal"
        tasks={[{ ...tasks[0], title: "伺服器的新內容", version: 2 }]}
        canEdit
      />,
    );

    expect(screen.getByLabelText("編輯內容 伺服器的新內容")).toHaveValue(
      "瀏覽器中的舊內容",
    );
    expect(
      document.querySelector('[name="expectedVersion"]'),
    ).toHaveAttribute("value", "2");
  });
});
