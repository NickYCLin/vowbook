import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  transaction: vi.fn(),
  itemCreate: vi.fn(),
  itemUpdateMany: vi.fn(),
  itemDeleteMany: vi.fn(),
  speechCreate: vi.fn(),
  speechUpdateMany: vi.fn(),
  speechDeleteMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  mobileCreateTimelineItem,
  mobileDeleteTimelineItem,
  mobileSaveWeddingSpeech,
  mobileUpdateTimelineItem,
} from "./wedding-timeline";

const client = {
  weddingTimelineItem: { create: mocks.itemCreate, updateMany: mocks.itemUpdateMany, deleteMany: mocks.itemDeleteMany },
  weddingSpeech: { create: mocks.speechCreate, updateMany: mocks.speechUpdateMany, deleteMany: mocks.speechDeleteMany },
};
const item = { startTime: "12:00", endTime: "12:20", phase: " 進場 ", title: "第一次進場", location: "", details: "花童先走", mediaCue: "", notes: "" };

describe("手機改當天流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.itemCreate.mockResolvedValue({ id: "item_1", version: 0 });
    mocks.itemUpdateMany.mockResolvedValue({ count: 1 });
    mocks.itemDeleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("在交易內確認編輯權限，時間換成分鐘、空欄存成 null", async () => {
    await expect(mobileCreateTimelineItem("workspace_1", "user_1", item))
      .resolves.toEqual({ id: "item_1", title: "第一次進場", version: 0 });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "edit", client);
    expect(mocks.itemCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1", startMinute: 720, endMinute: 740, phase: "進場", title: "第一次進場",
        location: null, details: "花童先走", mediaCue: null, notes: null,
      },
      select: { id: true, version: true },
    });
  });

  it("結束早於開始回 400，而且不開交易", async () => {
    await expect(mobileCreateTimelineItem("workspace_1", "user_1", { ...item, endTime: "11:00" }))
      .rejects.toMatchObject({ status: 400 });
    await expect(mobileCreateTimelineItem("workspace_1", "user_1", { ...item, title: " " }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("修改只動同一工作區的指定版本，不碰工作人員指派", async () => {
    await expect(mobileUpdateTimelineItem("workspace_1", "user_1", "item_1", { ...item, expectedVersion: 2 }))
      .resolves.toEqual({ id: "item_1", title: "第一次進場", version: 3 });
    const args = mocks.itemUpdateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "item_1", workspaceId: "workspace_1", version: 2 });
    expect(args.data).not.toHaveProperty("staffAssignments");
    mocks.itemUpdateMany.mockResolvedValue({ count: 0 });
    await expect(mobileUpdateTimelineItem("workspace_1", "user_1", "item_1", { ...item, expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("還掛著總召交辦的流程不能刪，講清楚原因", async () => {
    mocks.itemDeleteMany.mockRejectedValue({ code: "P2003" });
    await expect(mobileDeleteTimelineItem("workspace_1", "user_1", "item_1", 1))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("總召交辦") });
  });

  it("沒有編輯權限回 403", async () => {
    mocks.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileDeleteTimelineItem("workspace_1", "user_1", "item_1", 1)).rejects.toMatchObject({ status: 403 });
    expect(mocks.itemDeleteMany).not.toHaveBeenCalled();
  });
});

describe("手機寫謝親恩", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("OWNER");
    mocks.speechCreate.mockResolvedValue({ version: 0 });
    mocks.speechUpdateMany.mockResolvedValue({ count: 1 });
    mocks.speechDeleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("第一次寫是新增，之後照版本更新", async () => {
    await expect(mobileSaveWeddingSpeech("workspace_1", "user_1", "BRIDE_PARENTS", " 爸、媽 \n", null))
      .resolves.toEqual({ kind: "BRIDE_PARENTS", content: "爸、媽", version: 0 });
    expect(mocks.speechCreate).toHaveBeenCalledWith({
      data: { workspaceId: "workspace_1", kind: "BRIDE_PARENTS", content: "爸、媽" },
      select: { version: true },
    });
    await expect(mobileSaveWeddingSpeech("workspace_1", "user_1", "BRIDE_PARENTS", "爸、媽，謝謝", 4))
      .resolves.toEqual({ kind: "BRIDE_PARENTS", content: "爸、媽，謝謝", version: 5 });
    expect(mocks.speechUpdateMany.mock.calls[0][0].where).toEqual({ workspaceId: "workspace_1", kind: "BRIDE_PARENTS", version: 4 });
  });

  it("清空等於刪掉；沒有稿子時清空什麼都不做", async () => {
    await expect(mobileSaveWeddingSpeech("workspace_1", "user_1", "GROOM_PARENTS", "  ", 2))
      .resolves.toEqual({ kind: "GROOM_PARENTS", content: null, version: null });
    expect(mocks.speechDeleteMany).toHaveBeenCalled();
    await mobileSaveWeddingSpeech("workspace_1", "user_1", "GROOM_PARENTS", "", null);
    expect(mocks.speechCreate).not.toHaveBeenCalled();
  });

  it("別人先改過回 409，同時新增撞到唯一鍵也一樣", async () => {
    mocks.speechUpdateMany.mockResolvedValue({ count: 0 });
    await expect(mobileSaveWeddingSpeech("workspace_1", "user_1", "GROOM_PARENTS", "爸", 1))
      .rejects.toMatchObject({ status: 409 });
    mocks.speechCreate.mockRejectedValue({ code: "P2002" });
    await expect(mobileSaveWeddingSpeech("workspace_1", "user_1", "GROOM_PARENTS", "爸", null))
      .rejects.toMatchObject({ status: 409 });
  });

  it("類型或內容格式不對回 400，而且不開交易", async () => {
    await expect(mobileSaveWeddingSpeech("workspace_1", "user_1", "PASTOR", "爸", null)).rejects.toMatchObject({ status: 400 });
    await expect(mobileSaveWeddingSpeech("workspace_1", "user_1", "GROOM_PARENTS", 5, null)).rejects.toMatchObject({ status: 400 });
    await expect(mobileSaveWeddingSpeech("workspace_1", "user_1", "GROOM_PARENTS", "爸".repeat(3001), null)).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
