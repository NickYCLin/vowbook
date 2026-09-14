import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), status: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock("@/actions/coordinator-handoffs", () => ({ saveHandoffAction: mocks.save, setHandoffStatusAction: mocks.status, deleteHandoffAction: mocks.remove }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { HandoffBoard } from "./handoff-board";
import type { HandoffListData } from "@/lib/coordinator-handoffs";
const data: HandoffListData = { role: "OWNER", workspace: { id: "ws", name: "測試婚宴" }, staff: [], timeline: [],
  items: [{ id: "item", title: "核對餐點", details: "與領班確認", phase: "EVENT_DAY", status: "PENDING", dueAt: null, staffId: null, timelineItemId: null, version: 2 }] };
describe("handoff board", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ status: "success", message: "已儲存。" }); });
  it("allows read-only members to see details without editing", () => {
    render(<HandoffBoard workspaceId="ws" data={data} canEdit={false} />);
    expect(screen.getByText("與領班確認")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /新增/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("creates an unassigned item and refreshes only after success", async () => {
    render(<HandoffBoard workspaceId="ws" data={data} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /新增交辦事項/ }));
    fireEvent.change(screen.getByLabelText("需要協助什麼？"), { target: { value: "安排喜餅" } });
    fireEvent.change(screen.getByLabelText("交代內容"), { target: { value: "核對名單" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存交辦事項" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][1]).toBeNull();
    expect(mocks.save.mock.calls[0][3].get("staffId")).toBe("");
    expect(screen.queryByLabelText("需要協助什麼？")).not.toBeInTheDocument();
  });
  it("keeps edits after errors and blocks stale snapshots", async () => {
    mocks.save.mockResolvedValue({ status: "error", message: "無法儲存。" });
    const { rerender } = render(<HandoffBoard workspaceId="ws" data={data} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "編輯 核對餐點" }));
    fireEvent.change(screen.getByLabelText("交代內容"), { target: { value: "保留這段修改" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存交辦事項" }));
    await screen.findByText("無法儲存。");
    expect(screen.getByLabelText("交代內容")).toHaveValue("保留這段修改");
    rerender(<HandoffBoard workspaceId="ws" data={{ ...data, items: [{ ...data.items[0], version: 3 }] }} canEdit />);
    expect(screen.getByRole("button", { name: "儲存交辦事項" })).toBeDisabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("shows a confirmation before removal", () => {
    render(<HandoffBoard workspaceId="ws" data={data} canEdit />);
    expect(screen.getByText("移除事項").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("移除事項"));
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
