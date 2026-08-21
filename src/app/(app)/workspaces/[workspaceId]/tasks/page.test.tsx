import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { getWeddingTaskList, notFound, WeddingTaskDataError } = vi.hoisted(
  () => ({
    getWeddingTaskList: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    WeddingTaskDataError: class WeddingTaskDataError extends Error {},
  }),
);

vi.mock("@/lib/wedding-task-list", () => ({
  getWeddingTaskList,
  WeddingTaskDataError,
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/tasks/task-list", () => ({
  WeddingTaskList: ({ canEdit }: { canEdit: boolean }) => (
    <div>{canEdit ? "可編輯任務" : "唯讀任務"}</div>
  ),
}));

import TasksPage from "./page";

describe("TasksPage", () => {
  it("uses Next 16 async params and renders workspace-scoped tasks", async () => {
    getWeddingTaskList.mockResolvedValue({
      role: "PARTNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      tasks: [],
    });

    render(
      await TasksPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(getWeddingTaskList).toHaveBeenCalledWith("workspace_1");
    expect(
      screen.getByRole("heading", { name: "我們的婚宴・婚宴任務" }),
    ).toBeInTheDocument();
    expect(screen.getByText("可編輯任務")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回我的婚宴" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    const navigation = screen.getByRole("navigation", { name: "工作區功能" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(7);
    expect(within(navigation).getByRole("link", { name: "任務" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("translates membership denial to a generic not found response", async () => {
    getWeddingTaskList.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      TasksPage({
        params: Promise.resolve({ workspaceId: "workspace_secret" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("shows a sanitized inline retry state for task read failures", async () => {
    getWeddingTaskList.mockRejectedValue(
      new WeddingTaskDataError("目前無法載入婚宴任務，請稍後再試。"),
    );

    render(
      await TasksPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "婚宴任務暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(screen.getByText("目前無法載入婚宴任務，請稍後再試。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "再試一次" })).toHaveAttribute(
      "href",
      "/workspaces/workspace_1/tasks",
    );
  });

  it("keeps VIEWER visibly read-only", async () => {
    getWeddingTaskList.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      tasks: [],
    });

    render(
      await TasksPage({
        params: Promise.resolve({ workspaceId: "workspace_1" }),
      }),
    );

    expect(screen.getByText("唯讀任務")).toBeInTheDocument();
    expect(screen.getByText(/你目前是唯讀成員/)).toBeInTheDocument();
  });
});
