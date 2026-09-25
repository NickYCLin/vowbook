import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  transaction,
  create,
  updateMany,
  deleteMany,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  transaction: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

const client = { weddingSpeech: { create, updateMany, deleteMany } };

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { saveWeddingSpeechAction } from "./wedding-speeches";

const idle = { status: "idle" as const };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("saveWeddingSpeechAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({ role: "OWNER" });
    requireLockedWorkspaceAccess.mockResolvedValue("OWNER");
    create.mockResolvedValue({});
    updateMany.mockResolvedValue({ count: 1 });
    deleteMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(
      async (callback: (value: unknown) => Promise<unknown>) => callback(client),
    );
  });

  it("creates the first draft inside the checked workspace", async () => {
    await expect(
      saveWeddingSpeechAction(
        "workspace_1",
        idle,
        form({ kind: "GROOM_PARENTS", content: " 爸、媽 \n謝謝你們", expectedVersion: "" }),
      ),
    ).resolves.toEqual({ status: "success", message: "已儲存致詞稿。" });
    expect(requireWorkspaceAccess).toHaveBeenCalledWith("workspace_1", "session_user", "edit");
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      client,
    );
    expect(create).toHaveBeenCalledWith({
      data: { workspaceId: "workspace_1", kind: "GROOM_PARENTS", content: "爸、媽\n謝謝你們" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces/workspace_1/timeline");
  });

  it("updates with the expected version and reports stale edits with the draft", async () => {
    await saveWeddingSpeechAction(
      "workspace_1",
      idle,
      form({ kind: "BRIDE_PARENTS", content: "新稿", expectedVersion: "2" }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", kind: "BRIDE_PARENTS", version: 2 },
      data: { content: "新稿", version: { increment: 1 } },
    });

    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      saveWeddingSpeechAction(
        "workspace_1",
        idle,
        form({ kind: "BRIDE_PARENTS", content: "新稿", expectedVersion: "2" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE", draft: "新稿" });
  });

  it("deletes the row when the speech is cleared", async () => {
    await expect(
      saveWeddingSpeechAction(
        "workspace_1",
        idle,
        form({ kind: "GROOM_PARENTS", content: "  ", expectedVersion: "0" }),
      ),
    ).resolves.toEqual({ status: "success", message: "已清空致詞稿。" });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", kind: "GROOM_PARENTS", version: 0 },
    });
  });

  it("rejects read-only members before touching the database", async () => {
    requireWorkspaceAccess.mockRejectedValue(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      saveWeddingSpeechAction(
        "workspace_1",
        idle,
        form({ kind: "GROOM_PARENTS", content: "稿", expectedVersion: "" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN", draft: "稿" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown speech kinds", async () => {
    await expect(
      saveWeddingSpeechAction(
        "workspace_1",
        idle,
        form({ kind: "HOST", content: "稿", expectedVersion: "" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
