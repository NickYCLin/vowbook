import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  createWorkspaceInvitation,
  reinviteWorkspaceInvitation,
  removeWorkspaceMember,
  requireCurrentUser,
  requireWorkspaceAccess,
  revalidatePath,
  revokePendingWorkspaceInvitation,
  updateWorkspaceMemberRole,
} = vi.hoisted(() => ({
  createWorkspaceInvitation: vi.fn(),
  reinviteWorkspaceInvitation: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  revalidatePath: vi.fn(),
  revokePendingWorkspaceInvitation: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-invitations", () => ({
  createWorkspaceInvitation,
  reinviteWorkspaceInvitation,
  removeWorkspaceMember,
  revokePendingWorkspaceInvitation,
  updateWorkspaceMemberRole,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createWorkspaceInvitationAction,
  reinviteWorkspaceInvitationAction,
  removeWorkspaceMemberAction,
  revokeWorkspaceInvitationAction,
  updateWorkspaceMemberRoleAction,
} from "./workspace-invitations";

const idleState = { status: "idle" as const };

const operationKey = "8d7fcdcf-2bea-4aa4-89b3-47158efcb40d";

function createForm(
  email: string,
  role: string,
  submittedOperationKey = operationKey,
) {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("role", role);
  formData.set("operationKey", submittedOperationKey);
  formData.set("userId", "forged");
  return formData;
}

function lifecycleForm(
  invitationId: string,
  version: string,
  role?: string,
) {
  const formData = new FormData();
  formData.set("invitationId", invitationId);
  formData.set("version", version);
  if (role) formData.set("role", role);
  return formData;
}

function memberForm(role?: string) {
  const formData = new FormData();
  formData.set("membershipId", "membership_target");
  formData.set("expectedUpdatedAt", "2026-07-29T02:03:04.567Z");
  if (role !== undefined) formData.set("role", role);
  formData.set("currentUserId", "forged_user");
  formData.set("workspaceId", "forged_workspace");
  formData.set("actorRole", "OWNER");
  return formData;
}

describe("workspace invitation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_owner" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1" },
    });
    createWorkspaceInvitation.mockResolvedValue({ outcome: "CREATED" });
    revokePendingWorkspaceInvitation.mockResolvedValue({
      outcome: "REVOKED",
    });
    reinviteWorkspaceInvitation.mockResolvedValue({
      outcome: "REINVITED",
    });
    updateWorkspaceMemberRole.mockResolvedValue({
      outcome: "UPDATED",
      updatedAt: new Date("2026-07-29T02:04:05.678Z"),
    });
    removeWorkspaceMember.mockResolvedValue({ outcome: "REMOVED" });
  });

  it("authorizes before validation and reports the first invalid field", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      createWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        createForm("invalid", "OWNER"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(createWorkspaceInvitation).not.toHaveBeenCalled();

    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1" },
    });
    await expect(
      createWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        createForm("invalid", "OWNER"),
      ),
    ).resolves.toMatchObject({
      status: "error",
      code: "VALIDATION",
      field: "email",
    });

    await expect(
      createWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        createForm("person@example.com", "OWNER"),
      ),
    ).resolves.toMatchObject({
      status: "error",
      code: "VALIDATION",
      field: "role",
    });

    await expect(
      createWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        createForm("person@example.com", "PARTNER", "forged"),
      ),
    ).resolves.toMatchObject({
      status: "error",
      code: "VALIDATION",
      field: "operationKey",
    });
  });

  it("normalizes valid create fields and never trusts forged identity", async () => {
    await expect(
      createWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        createForm(" Partner@Example.COM ", "PARTNER"),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已建立協作邀請。請將 VowBook 網址傳給對方。",
    });
    expect(createWorkspaceInvitation).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "session_owner",
      operationKey,
      email: "partner@example.com",
      role: "PARTNER",
    });
  });

  it("treats already-pending and same-operation replay as successful no-op", async () => {
    createWorkspaceInvitation.mockResolvedValueOnce({
      outcome: "ALREADY_PENDING",
    });
    await expect(
      createWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        createForm("pending@example.com", "VIEWER"),
      ),
    ).resolves.toEqual({
      status: "success",
      code: "ALREADY_PENDING",
      message: "這個 Email 已有等待接受的邀請；角色與期限都沒有變更。",
    });

    createWorkspaceInvitation.mockResolvedValueOnce({
      outcome: "REPLAYED",
    });
    await expect(
      createWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        createForm("replay@example.com", "PARTNER"),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "這次邀請操作已處理，沒有新增或修改邀請。",
    });
    expect(revalidatePath).toHaveBeenNthCalledWith(
      1,
      "/workspaces/workspace_1/members",
    );
    expect(revalidatePath).toHaveBeenNthCalledWith(2, "/dashboard");
  });

  it("requires explicit reinvite for an expired pending generation", async () => {
    createWorkspaceInvitation.mockResolvedValueOnce({
      outcome: "REINVITE_REQUIRED",
    });
    await expect(
      createWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        createForm("renew@example.com", "PLANNER"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "REINVITE_REQUIRED",
      message: "這個 Email 的舊邀請已失效，請在「需重新邀請」選擇角色。",
    });
  });

  it("passes id plus positive version to revoke and reports stale replay safely", async () => {
    await revokeWorkspaceInvitationAction(
      "workspace_1",
      idleState,
      lifecycleForm("invitation_1", "4"),
    );
    expect(revokePendingWorkspaceInvitation).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "session_owner",
      invitationId: "invitation_1",
      version: 4,
    });

    revokePendingWorkspaceInvitation.mockResolvedValueOnce({
      outcome: "NOT_REVOCABLE",
    });
    await expect(
      revokeWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        lifecycleForm("invitation_1", "4"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "邀請已變更、過期或無法撤銷，請重新整理。",
    });
  });

  it("uses a separate id/version/role reinvite action and maps stale generations to NOOP", async () => {
    await expect(
      reinviteWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        lifecycleForm("invitation_1", "5", "PLANNER"),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已重新邀請，新的七天期限已開始。請將 VowBook 網址傳給對方。",
    });
    expect(reinviteWorkspaceInvitation).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "session_owner",
      invitationId: "invitation_1",
      version: 5,
      role: "PLANNER",
    });

    reinviteWorkspaceInvitation.mockResolvedValueOnce({
      outcome: "NOT_REINVITABLE",
    });
    await expect(
      reinviteWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        lifecycleForm("invitation_1", "5", "VIEWER"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "STALE",
      message: "邀請已被更新或無法重新邀請，請重新整理。",
    });
  });

  it("does not revalidate failed mutations and keeps committed success explicit", async () => {
    reinviteWorkspaceInvitation.mockResolvedValueOnce({
      outcome: "NOT_REINVITABLE",
    });
    await reinviteWorkspaceInvitationAction(
      "workspace_1",
      idleState,
      lifecycleForm("invitation_1", "2", "PARTNER"),
    );
    expect(revalidatePath).not.toHaveBeenCalled();

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("cache internals");
    });
    await expect(
      revokeWorkspaceInvitationAction(
        "workspace_1",
        idleState,
        lifecycleForm("invitation_1", "3"),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已撤銷邀請；畫面未自動更新，請重新整理。",
    });
    expect(log).toHaveBeenCalledWith("協作頁面重新驗證失敗。");
  });
});

describe("accepted workspace member actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_owner" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1" },
    });
    updateWorkspaceMemberRole.mockResolvedValue({
      outcome: "UPDATED",
      updatedAt: new Date("2026-07-29T02:04:05.678Z"),
    });
    removeWorkspaceMember.mockResolvedValue({ outcome: "REMOVED" });
  });

  it("derives the actor, normalizes FormData, updates the role, and revalidates members", async () => {
    await expect(
      updateWorkspaceMemberRoleAction(
        "workspace_1",
        idleState,
        memberForm("PLANNER"),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已更新協作者角色。",
      membershipId: "membership_target",
      role: "PLANNER",
      updatedAt: "2026-07-29T02:04:05.678Z",
    });

    expect(updateWorkspaceMemberRole).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "session_owner",
      targetMembershipId: "membership_target",
      expectedUpdatedAt: new Date("2026-07-29T02:03:04.567Z"),
      role: "PLANNER",
    });
    expect(revalidatePath).toHaveBeenNthCalledWith(
      1,
      "/workspaces/workspace_1/members",
    );
  });

  it.each(["OWNER", "owner", "EDITOR", ""])(
    "rejects the non-allowlisted member role %s without calling the service",
    async (role) => {
      await expect(
        updateWorkspaceMemberRoleAction(
          "workspace_1",
          idleState,
          memberForm(role),
        ),
      ).resolves.toEqual({
        status: "error",
        code: "VALIDATION",
        field: "role",
        message: "請選擇伴侶、婚顧或檢視者角色。",
      });
      expect(updateWorkspaceMemberRole).not.toHaveBeenCalled();
    },
  );

  it("denies a non-owner before malformed target metadata is normalized", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      updateWorkspaceMemberRoleAction("workspace_1", idleState, new FormData()),
    ).resolves.toEqual({
      status: "error",
      code: "FORBIDDEN",
      message: "無權存取此婚宴工作區。",
    });
    expect(updateWorkspaceMemberRole).not.toHaveBeenCalled();
  });

  it.each(["missing", "cross-workspace", "stale", "owner-target"])(
    "maps a %s update to the same safe state without revalidation",
    async () => {
      updateWorkspaceMemberRole.mockResolvedValueOnce({
        outcome: "NOT_MUTABLE",
      });

      await expect(
        updateWorkspaceMemberRoleAction(
          "workspace_1",
          idleState,
          memberForm("VIEWER"),
        ),
      ).resolves.toEqual({
        status: "error",
        code: "STALE",
        message: "成員資料已變更或無法操作，請重新整理。",
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("removes the scoped member with the original token and returns stable success copy", async () => {
    await expect(
      removeWorkspaceMemberAction("workspace_1", idleState, memberForm()),
    ).resolves.toEqual({
      status: "success",
      message: "已移除協作者。",
      membershipId: "membership_target",
    });
    expect(removeWorkspaceMember).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "session_owner",
      targetMembershipId: "membership_target",
      expectedUpdatedAt: new Date("2026-07-29T02:03:04.567Z"),
    });
  });

  it.each(["missing", "cross-workspace", "stale", "owner-target"])(
    "maps a %s removal to the same safe state",
    async () => {
      removeWorkspaceMember.mockResolvedValueOnce({ outcome: "NOT_MUTABLE" });
      await expect(
        removeWorkspaceMemberAction("workspace_1", idleState, memberForm()),
      ).resolves.toEqual({
        status: "error",
        code: "STALE",
        message: "成員資料已變更或無法操作，請重新整理。",
      });
    },
  );
});
