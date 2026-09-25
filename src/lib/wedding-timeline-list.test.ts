import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  timelineFindMany,
  staffFindMany,
  gameFindMany,
  speechFindMany,
  transaction,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  timelineFindMany: vi.fn(),
  staffFindMany: vi.fn(),
  gameFindMany: vi.fn(),
  speechFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import {
  getWeddingTimelinePageData,
  WeddingTimelineDataError,
} from "./wedding-timeline-list";

describe("getWeddingTimelinePageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    timelineFindMany.mockResolvedValue([]);
    staffFindMany.mockResolvedValue([]);
    gameFindMany.mockResolvedValue([]);
    speechFindMany.mockResolvedValue([]);
    transaction.mockImplementation(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback({
          membership: { findUnique: vi.fn() },
          weddingTimelineItem: { findMany: timelineFindMany },
          weddingStaffAssignment: { findMany: staffFindMany },
          weddingGameParticipant: { findMany: gameFindMany },
          weddingSpeech: { findMany: speechFindMany },
        }),
    );
  });

  it("reads timeline and staff in one tenant-scoped RepeatableRead snapshot", async () => {
    await expect(
      getWeddingTimelinePageData("workspace_1"),
    ).resolves.toEqual({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      items: [],
      staff: [],
      games: { BOUQUET: [], BROCCOLI: [] },
      speeches: { GROOM_PARENTS: null, BRIDE_PARENTS: null },
    });
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "read",
      expect.objectContaining({
        weddingTimelineItem: { findMany: timelineFindMany },
      }),
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(timelineFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "workspace_1" },
        select: expect.objectContaining({
          mediaCue: true,
          staffAssignments: expect.objectContaining({
            where: { workspaceId: "workspace_1" },
          }),
        }),
      }),
    );
    expect(staffFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "workspace_1" } }),
    );
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0],
    );
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      timelineFindMany.mock.invocationCallOrder[0],
    );
  });

  it("groups game participants by game in stored order", async () => {
    gameFindMany.mockResolvedValue([
      { id: "p1", game: "BROCCOLI", name: "阿華", note: null, version: 0 },
      { id: "p2", game: "BOUQUET", name: "小美", note: "室友", version: 1 },
      { id: "p3", game: "BOUQUET", name: "小安", note: null, version: 0 },
    ]);
    const data = await getWeddingTimelinePageData("workspace_1");
    expect(data.games).toEqual({
      BOUQUET: [
        { id: "p2", name: "小美", note: "室友", version: 1 },
        { id: "p3", name: "小安", note: null, version: 0 },
      ],
      BROCCOLI: [{ id: "p1", name: "阿華", note: null, version: 0 }],
    });
    expect(gameFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "workspace_1" } }),
    );
  });

  it("returns each speech by kind and leaves missing ones empty", async () => {
    speechFindMany.mockResolvedValue([
      { kind: "BRIDE_PARENTS", content: "爸、媽", version: 3 },
    ]);
    const data = await getWeddingTimelinePageData("workspace_1");
    expect(data.speeches).toEqual({
      GROOM_PARENTS: null,
      BRIDE_PARENTS: { content: "爸、媽", version: 3 },
    });
    expect(speechFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "workspace_1" } }),
    );
  });

  it("returns deterministic time labels and tenant-neutral assigned staff", async () => {
    timelineFindMany.mockResolvedValue([
      {
        id: "item_1",
        startMinute: 690,
        endMinute: 720,
        phase: "迎賓",
        title: "賓客入場",
        location: "宴會廳外",
        details: "依序引導",
        mediaCue: "迎賓音樂\n開場影片",
        notes: null,
        version: 2,
        staffAssignments: [
          {
            staffAssignment: {
              id: "staff_1",
              roleName: "招待",
              personName: "小安",
            },
          },
        ],
      },
    ]);
    staffFindMany.mockResolvedValue([
      { id: "staff_1", roleName: "招待", personName: "小安" },
    ]);
    const data = await getWeddingTimelinePageData("workspace_1");
    expect(data.items[0]).toEqual({
      id: "item_1",
      startTime: "11:30",
      endTime: "12:00",
      phase: "迎賓",
      title: "賓客入場",
      location: "宴會廳外",
      details: "依序引導",
      mediaCue: "迎賓音樂\n開場影片",
      notes: null,
      version: 2,
      assignedStaff: [
        { id: "staff_1", roleName: "招待", personName: "小安" },
      ],
    });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("denies a membership revoked at the transaction boundary before timeline PII is read", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      getWeddingTimelinePageData("workspace_secret"),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(transaction).toHaveBeenCalledOnce();
    expect(timelineFindMany).not.toHaveBeenCalled();
    expect(staffFindMany).not.toHaveBeenCalled();
  });

  it("sanitizes membership infrastructure and snapshot failures", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new Error("membership database secret"),
    );
    await expect(
      getWeddingTimelinePageData("workspace_1"),
    ).rejects.toEqual(
      new WeddingTimelineDataError("目前無法載入婚禮總流程，請稍後再試。"),
    );
    expect(timelineFindMany).not.toHaveBeenCalled();
    expect(staffFindMany).not.toHaveBeenCalled();

    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    transaction.mockRejectedValueOnce(new Error("secret"));
    await expect(
      getWeddingTimelinePageData("workspace_1"),
    ).rejects.toEqual(
      new WeddingTimelineDataError("目前無法載入婚禮總流程，請稍後再試。"),
    );
  });
});
