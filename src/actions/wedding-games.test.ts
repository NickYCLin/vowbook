import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  transaction,
  findMany,
  createMany,
  updateMany,
  deleteMany,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  createMany: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

const client = {
  weddingGameParticipant: { findMany, createMany, updateMany, deleteMany },
};

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  addWeddingGameParticipantsAction,
  deleteWeddingGameParticipantAction,
  updateWeddingGameParticipantAction,
} from "./wedding-games";

const idle = { status: "idle" as const };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("wedding game actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({ role: "PLANNER" });
    requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    findMany.mockResolvedValue([{ sortOrder: 0 }, { sortOrder: 4 }]);
    createMany.mockResolvedValue({ count: 2 });
    updateMany.mockResolvedValue({ count: 1 });
    deleteMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(
      async (callback: (value: unknown) => Promise<unknown>) => callback(client),
    );
  });

  it("appends pasted names after the current last position in the same workspace", async () => {
    await expect(
      addWeddingGameParticipantsAction(
        "workspace_1",
        idle,
        form({ game: "BOUQUET", names: "小美、阿華" }),
      ),
    ).resolves.toEqual({ status: "success", message: "已加入 2 位。" });
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      client,
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", game: "BOUQUET" },
      select: { sortOrder: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { workspaceId: "workspace_1", game: "BOUQUET", name: "小美", note: null, sortOrder: 5 },
        { workspaceId: "workspace_1", game: "BOUQUET", name: "阿華", note: null, sortOrder: 6 },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces/workspace_1/timeline");
  });

  it("refuses to go past the per-game limit", async () => {
    findMany.mockResolvedValue(
      Array.from({ length: 39 }, (_, sortOrder) => ({ sortOrder })),
    );
    await expect(
      addWeddingGameParticipantsAction(
        "workspace_1",
        idle,
        form({ game: "BROCCOLI", names: "甲、乙" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("rejects unknown games before opening a transaction", async () => {
    await expect(
      addWeddingGameParticipantsAction(
        "workspace_1",
        idle,
        form({ game: "CAKE", names: "甲" }),
      ),
    ).resolves.toMatchObject({ code: "VALIDATION" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN for viewers and for access revoked inside the transaction", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(new WorkspaceAccessDeniedError());
    await expect(
      addWeddingGameParticipantsAction(
        "workspace_1",
        idle,
        form({ game: "BOUQUET", names: "甲" }),
      ),
    ).resolves.toMatchObject({ code: "FORBIDDEN" });
    expect(transaction).not.toHaveBeenCalled();

    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      deleteWeddingGameParticipantAction(
        "workspace_1",
        "participant_1",
        idle,
        form({ expectedVersion: "0" }),
      ),
    ).resolves.toMatchObject({ code: "FORBIDDEN" });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("updates only the expected version inside the workspace", async () => {
    await expect(
      updateWeddingGameParticipantAction(
        "workspace_1",
        "participant_1",
        idle,
        form({ name: " 小美 ", note: " 大學室友 ", expectedVersion: "2" }),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "participant_1", workspaceId: "workspace_1", version: 2 },
      data: { name: "小美", note: "大學室友", version: { increment: 1 } },
    });

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      updateWeddingGameParticipantAction(
        "workspace_1",
        "participant_1",
        idle,
        form({ name: "小美", note: "", expectedVersion: "2" }),
      ),
    ).resolves.toMatchObject({ code: "STALE" });
  });

  it("reports a stale delete and hides infrastructure errors", async () => {
    deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      deleteWeddingGameParticipantAction(
        "workspace_1",
        "participant_1",
        idle,
        form({ expectedVersion: "1" }),
      ),
    ).resolves.toMatchObject({ code: "STALE" });

    transaction.mockRejectedValueOnce(new Error("connection reset host=db"));
    await expect(
      deleteWeddingGameParticipantAction(
        "workspace_1",
        "participant_1",
        idle,
        form({ expectedVersion: "1" }),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法移除名單，請稍後再試。",
    });
  });
});
