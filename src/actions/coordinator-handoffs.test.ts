import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), access: vi.fn(), locked: vi.fn(), transaction: vi.fn(),
  create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), staff: vi.fn(), timeline: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireCurrentUser: mocks.user }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveHandoffAction, setHandoffStatusAction, deleteHandoffAction } from "./coordinator-handoffs";
const tx = { coordinatorHandoff: { create: mocks.create, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany }, weddingStaffAssignment: { findFirst: mocks.staff }, weddingTimelineItem: { findFirst: mocks.timeline } };
const idle = { status: "idle" as const };
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ title: "核對餐點", details: "與領班確認", phase: "EVENT_DAY", status: "PENDING", expectedVersion: "2", ...values })) data.set(key, value);
  return data;
}
describe("coordinator handoff actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "session-user" });
    mocks.access.mockResolvedValue({ role: "OWNER" });
    mocks.locked.mockResolvedValue("OWNER");
    mocks.transaction.mockImplementation(async (fn) => fn(tx));
    mocks.create.mockResolvedValue({});
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.staff.mockResolvedValue({ id: "staff" });
    mocks.timeline.mockResolvedValue({ id: "flow" });
  });
  it("scopes both references and creation to the authorized workspace", async () => {
    expect(await saveHandoffAction("ws", null, idle, form({ staffId: "staff", timelineItemId: "flow", workspaceId: "forged" }))).toMatchObject({ status: "success" });
    expect(mocks.staff).toHaveBeenCalledWith({ where: { id: "staff", workspaceId: "ws" }, select: { id: true } });
    expect(mocks.timeline).toHaveBeenCalledWith({ where: { id: "flow", workspaceId: "ws" }, select: { id: true } });
    expect(mocks.create.mock.calls[0][0].data.workspaceId).toBe("ws");
    expect(mocks.locked).toHaveBeenCalledWith("ws", "session-user", "edit", tx);
  });
  it.each(["staff", "timeline"] as const)("rejects another workspace's %s", async (relation) => {
    mocks[relation].mockResolvedValue(null);
    expect(await saveHandoffAction("ws", null, idle, form({ staffId: "staff", timelineItemId: "flow" }))).toMatchObject({ code: "VALIDATION" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("uses CAS for editing, status-only updates and deletion", async () => {
    await saveHandoffAction("ws", "item", idle, form());
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: "item", workspaceId: "ws", version: 2 });
    await setHandoffStatusAction("ws", "item", idle, form({ status: "DONE" }));
    expect(mocks.updateMany.mock.calls[1][0].data).toEqual({ status: "DONE", version: { increment: 1 } });
    await deleteHandoffAction("ws", "item", idle, form());
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "item", workspaceId: "ws", version: 2 } });
  });
  it("does not overwrite stale records", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect(await saveHandoffAction("ws", "item", idle, form())).toMatchObject({ code: "STALE" });
  });
  it("rejects viewers before any domain query", async () => {
    mocks.access.mockRejectedValue(new WorkspaceAccessDeniedError());
    expect(await saveHandoffAction("ws", null, idle, form())).toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rechecks membership inside the write transaction", async () => {
    mocks.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    expect(await deleteHandoffAction("ws", "item", idle, form())).toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
