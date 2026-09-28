import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  access: vi.fn(),
  transaction: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  findMany: vi.fn(),
  staffFindFirst: vi.fn(),
  staffFindMany: vi.fn(),
  timelineFindFirst: vi.fn(),
  timelineFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  mobileCreateHandoff,
  mobileDeleteHandoff,
  mobileHandoffs,
  mobileSetHandoffStatus,
  mobileUpdateHandoff,
} from "./coordinator-handoffs";

const client = {
  coordinatorHandoff: { create: mocks.create, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany, findMany: mocks.findMany },
  weddingStaffAssignment: { findFirst: mocks.staffFindFirst, findMany: mocks.staffFindMany },
  weddingTimelineItem: { findFirst: mocks.timelineFindFirst, findMany: mocks.timelineFindMany },
};
const handoff = {
  title: " 帶捧花到新娘房 ",
  details: "儀式開始前十分鐘送到二樓",
  phase: "EVENT_DAY",
  status: "PENDING",
  dueAt: "",
  staffId: "",
  timelineItemId: "",
};

describe("手機交辦事項", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PLANNER");
    mocks.access.mockResolvedValue({ role: "PLANNER" });
    mocks.create.mockResolvedValue({ id: "handoff_1", version: 0 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.staffFindFirst.mockResolvedValue({ id: "staff_1" });
    mocks.timelineFindFirst.mockResolvedValue({ id: "item_1" });
    mocks.findMany.mockResolvedValue([]);
    mocks.staffFindMany.mockResolvedValue([]);
    mocks.timelineFindMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("新增前先在交易內確認編輯權限，空欄存成 null", async () => {
    await expect(mobileCreateHandoff("workspace_1", "user_1", handoff))
      .resolves.toEqual({ id: "handoff_1", title: "帶捧花到新娘房", version: 0 });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "edit", client);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1", title: "帶捧花到新娘房", details: "儀式開始前十分鐘送到二樓",
        phase: "EVENT_DAY", status: "PENDING", dueAt: null, staffId: null, timelineItemId: null,
      },
      select: { id: true, version: true },
    });
  });

  it("缺內容或時機無效就擋在交易之外", async () => {
    await expect(mobileCreateHandoff("workspace_1", "user_1", { ...handoff, details: " " }))
      .rejects.toMatchObject({ status: 400 });
    await expect(mobileCreateHandoff("workspace_1", "user_1", { ...handoff, phase: "SOMEDAY" }))
      .rejects.toMatchObject({ status: 400 });
    await expect(mobileCreateHandoff("workspace_1", "user_1", { ...handoff, dueAt: "2026-10-01" }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("負責人或流程不在同一場婚宴就不寫入", async () => {
    mocks.staffFindFirst.mockResolvedValue(null);
    await expect(mobileCreateHandoff("workspace_1", "user_1", { ...handoff, staffId: "staff_other" }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("修改鎖同一工作區的指定版本，版本不合回 409", async () => {
    await expect(mobileUpdateHandoff("workspace_1", "user_1", "handoff_1", { ...handoff, expectedVersion: 3 }))
      .resolves.toEqual({ id: "handoff_1", title: "帶捧花到新娘房", version: 4 });
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: "handoff_1", workspaceId: "workspace_1", version: 3 });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(mobileUpdateHandoff("workspace_1", "user_1", "handoff_1", { ...handoff, expectedVersion: 3 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("只改狀態時不動其他欄位，狀態無效則擋下", async () => {
    await expect(mobileSetHandoffStatus("workspace_1", "user_1", "handoff_1", "DONE", 2))
      .resolves.toEqual({ id: "handoff_1", status: "DONE", version: 3 });
    expect(mocks.updateMany.mock.calls[0][0].data).toEqual({ status: "DONE", version: { increment: 1 } });
    await expect(mobileSetHandoffStatus("workspace_1", "user_1", "handoff_1", "ALMOST", 2))
      .rejects.toMatchObject({ status: 400 });
  });

  it("刪除要帶版本，沒有權限就回 403", async () => {
    await expect(mobileDeleteHandoff("workspace_1", "user_1", "handoff_1", 1)).resolves.toEqual({ removed: true });
    await expect(mobileDeleteHandoff("workspace_1", "user_1", "handoff_1", "1")).rejects.toMatchObject({ status: 400 });
    mocks.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileDeleteHandoff("workspace_1", "user_1", "handoff_1", 1)).rejects.toMatchObject({ status: 403 });
  });

  it("清單附上台北時間與可選的負責人、流程", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "handoff_1", title: "送捧花", details: "二樓新娘房", phase: "EVENT_DAY", status: "PENDING",
      dueAt: new Date("2026-10-01T02:30:00.000Z"), staffId: "staff_1", timelineItemId: null, version: 2,
    }]);
    mocks.staffFindMany.mockResolvedValue([{ id: "staff_1", roleName: "主持", personName: "小美" }]);
    mocks.timelineFindMany.mockResolvedValue([{ id: "item_1", title: "迎賓", startMinute: 690 }]);

    const data = await mobileHandoffs("workspace_1", "user_1");

    expect(data.canEdit).toBe(true);
    expect(data.handoffs[0]).toMatchObject({ dueAt: "2026-10-01T10:30", version: 2 });
    expect(data.staff).toEqual([{ id: "staff_1", label: "主持 小美" }]);
    expect(data.timeline).toEqual([{ id: "item_1", label: "11:30 迎賓" }]);
    expect(data.statuses.map((item) => item.key)).toEqual(["PENDING", "CONFIRMED", "DONE"]);
  });

  it("只能看的人拿得到清單但不能編輯", async () => {
    mocks.access.mockResolvedValue({ role: "VIEWER" });
    await expect(mobileHandoffs("workspace_1", "user_1")).resolves.toMatchObject({ canEdit: false });
  });
});
