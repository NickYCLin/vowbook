import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  runSerializableTransaction,
  updateMany,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  runSerializableTransaction: vi.fn(),
  updateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/serializable-transaction", () => ({
  runSerializableTransaction,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { updateWeddingPlanningPreferencesAction } from "./wedding-planning-preferences";

const idleState = { status: "idle" as const };

function formData({
  engagement = false,
  procession = false,
  version = "2",
}: {
  engagement?: boolean;
  procession?: boolean;
  version?: string;
} = {}) {
  const data = new FormData();
  data.set("expectedVersion", version);
  if (engagement) data.set("hasEngagementCeremony", "on");
  if (procession) data.set("hasProcessionCeremony", "on");
  return data;
}

describe("updateWeddingPlanningPreferencesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    updateMany.mockResolvedValue({ count: 1 });
    runSerializableTransaction.mockImplementation(async (operation) =>
      operation({
        weddingWorkspace: { updateMany },
        $queryRaw: vi.fn(),
      }),
    );
  });

  it("binds identity to the route workspace and returns the next CAS snapshot", async () => {
    const data = formData({ engagement: true, procession: false });
    data.set("workspaceId", "workspace_attacker");
    data.set("userId", "user_attacker");

    await expect(
      updateWeddingPlanningPreferencesAction("workspace_1", idleState, data),
    ).resolves.toEqual({
      status: "success",
      message: "已更新中式儀式設定。",
      preferences: {
        hasEngagementCeremony: true,
        hasProcessionCeremony: false,
        version: 3,
      },
    });

    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      expect.anything(),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "workspace_1",
        ceremonyPreferencesVersion: 2,
      },
      data: {
        hasEngagementCeremony: true,
        hasProcessionCeremony: false,
        ceremonyPreferencesVersion: { increment: 1 },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/budget",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it.each([
    ["negative version", "-1"],
    ["decimal version", "1.5"],
    ["maximum version", "2147483647"],
    ["oversized version", "2147483648"],
  ])("rejects %s before opening a transaction", async (_label, version) => {
    await expect(
      updateWeddingPlanningPreferencesAction(
        "workspace_1",
        idleState,
        formData({ version }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(runSerializableTransaction).not.toHaveBeenCalled();
  });

  it("accepts the final version that can be incremented inside a PostgreSQL Int", async () => {
    await expect(
      updateWeddingPlanningPreferencesAction(
        "workspace_1",
        idleState,
        formData({ version: "2147483646" }),
      ),
    ).resolves.toMatchObject({
      status: "success",
      preferences: { version: 2_147_483_647 },
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ceremonyPreferencesVersion: 2_147_483_646,
        }),
      }),
    );
  });

  it("rejects forged checkbox values before opening a transaction", async () => {
    const data = formData();
    data.set("hasProcessionCeremony", "true");
    await expect(
      updateWeddingPlanningPreferencesAction("workspace_1", idleState, data),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(runSerializableTransaction).not.toHaveBeenCalled();
  });

  it("returns stale when another collaborator already changed the settings", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      updateWeddingPlanningPreferencesAction(
        "workspace_1",
        idleState,
        formData({ engagement: true, procession: true }),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "中式儀式設定已被更新，請重新整理後再試。",
    });
  });

  it("fails closed for a viewer before starting a transaction", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      updateWeddingPlanningPreferencesAction("workspace_1", idleState, formData()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(runSerializableTransaction).not.toHaveBeenCalled();
  });

  it("keeps a successful write successful when cache refresh fails", async () => {
    revalidatePath.mockRejectedValueOnce(new Error("cache unavailable"));
    await expect(
      updateWeddingPlanningPreferencesAction(
        "workspace_1",
        idleState,
        formData({ procession: true }),
      ),
    ).resolves.toMatchObject({
      status: "success",
      message: "已更新中式儀式設定；畫面未自動更新，請重新整理。",
      preferences: { version: 3 },
    });
    expect(revalidatePath).toHaveBeenNthCalledWith(
      1,
      "/workspaces/workspace_1/budget",
    );
    expect(revalidatePath).toHaveBeenNthCalledWith(2, "/dashboard");
  });

  it("keeps the refresh warning when only dashboard revalidation fails", async () => {
    revalidatePath
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("dashboard cache unavailable"));
    await expect(
      updateWeddingPlanningPreferencesAction(
        "workspace_1",
        idleState,
        formData({ engagement: true }),
      ),
    ).resolves.toMatchObject({
      status: "success",
      message: "已更新中式儀式設定；畫面未自動更新，請重新整理。",
    });
    expect(revalidatePath).toHaveBeenNthCalledWith(
      1,
      "/workspaces/workspace_1/budget",
    );
    expect(revalidatePath).toHaveBeenNthCalledWith(2, "/dashboard");
  });
});
