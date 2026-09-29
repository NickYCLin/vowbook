import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
  reinvite: vi.fn(),
  updateRole: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-invitations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-invitations")>(
    "@/lib/workspace-invitations",
  );
  return {
    WorkspaceMemberValidationError: actual.WorkspaceMemberValidationError,
    createWorkspaceInvitation: mocks.create,
    revokePendingWorkspaceInvitation: mocks.revoke,
    reinviteWorkspaceInvitation: mocks.reinvite,
    updateWorkspaceMemberRole: mocks.updateRole,
    removeWorkspaceMember: mocks.remove,
  };
});

import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { WorkspaceInvitationValidationError } from "@/domain/workspace-invitation";
import {
  INVITE_FIELDS,
  membersBody,
  mobileInviteMember,
  mobileRemoveMember,
  mobileReinviteInvitation,
  mobileRevokeInvitation,
  mobileUpdateMemberRole,
} from "./members";

const stamp = "2026-09-29T06:00:00.000Z";

describe("手機端的協作者管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ outcome: "CREATED" });
    mocks.revoke.mockResolvedValue({ outcome: "REVOKED" });
    mocks.reinvite.mockResolvedValue({ outcome: "REINVITED" });
    mocks.updateRole.mockResolvedValue({ outcome: "UPDATED", updatedAt: new Date(stamp) });
    mocks.remove.mockResolvedValue({ outcome: "REMOVED" });
  });

  it("邀請時身分只認 token 帶進來的使用者", async () => {
    await expect(
      mobileInviteMember("workspace_1", "user_1", {
        email: "a@example.com",
        role: "PLANNER",
        operationKey: "key_1",
      }),
    ).resolves.toMatchObject({ outcome: "CREATED" });
    expect(mocks.create).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      operationKey: "key_1",
      email: "a@example.com",
      role: "PLANNER",
    });
  });

  it("舊邀請已失效要改走重新邀請", async () => {
    mocks.create.mockResolvedValue({ outcome: "REINVITE_REQUIRED" });
    await expect(mobileInviteMember("workspace_1", "user_1", {})).rejects.toMatchObject({
      status: 409,
      code: "REINVITE_REQUIRED",
    });
  });

  it("重複送出同一次邀請不會再建一筆", async () => {
    mocks.create.mockResolvedValue({ outcome: "REPLAYED" });
    await expect(mobileInviteMember("workspace_1", "user_1", {})).resolves.toMatchObject({
      outcome: "REPLAYED",
    });
  });

  it("Email 或角色不合規回 400", async () => {
    mocks.create.mockRejectedValue(new WorkspaceInvitationValidationError("請輸入有效的 Email。"));
    await expect(mobileInviteMember("workspace_1", "user_1", {})).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION",
    });
  });

  it("不是擁有者就擋在 403", async () => {
    mocks.create.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileInviteMember("workspace_1", "user_1", {})).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("撤銷邀請要帶版本，版本不合就是衝突", async () => {
    await expect(
      mobileRevokeInvitation("workspace_1", "user_1", "invite_1", { version: 3 }),
    ).resolves.toMatchObject({ outcome: "REVOKED" });
    expect(mocks.revoke).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      invitationId: "invite_1",
      version: 3,
    });

    mocks.revoke.mockResolvedValue({ outcome: "NOT_REVOCABLE" });
    await expect(
      mobileRevokeInvitation("workspace_1", "user_1", "invite_1", { version: 3 }),
    ).rejects.toMatchObject({ status: 409, code: "STALE" });
  });

  it("重新邀請會一起帶新的角色", async () => {
    await expect(
      mobileReinviteInvitation("workspace_1", "user_1", "invite_1", { version: 2, role: "VIEWER" }),
    ).resolves.toMatchObject({ outcome: "REINVITED" });
    expect(mocks.reinvite).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      invitationId: "invite_1",
      version: 2,
      role: "VIEWER",
    });
  });

  it("改角色成功會回新的 updatedAt，讓下一次操作能接著比對", async () => {
    await expect(
      mobileUpdateMemberRole("workspace_1", "user_1", "member_1", {
        role: "PARTNER",
        expectedUpdatedAt: stamp,
      }),
    ).resolves.toEqual({ updatedAt: stamp });
  });

  it("成員在別處被改過，改角色與移除都回衝突", async () => {
    mocks.updateRole.mockResolvedValue({ outcome: "NOT_MUTABLE" });
    mocks.remove.mockResolvedValue({ outcome: "NOT_MUTABLE" });
    await expect(
      mobileUpdateMemberRole("workspace_1", "user_1", "member_1", { expectedUpdatedAt: stamp }),
    ).rejects.toMatchObject({ status: 409, code: "STALE" });
    await expect(
      mobileRemoveMember("workspace_1", "user_1", "member_1", { expectedUpdatedAt: stamp }),
    ).rejects.toMatchObject({ status: 409, code: "STALE" });
  });

  it("移除協作者成功", async () => {
    await expect(
      mobileRemoveMember("workspace_1", "user_1", "member_1", { expectedUpdatedAt: stamp }),
    ).resolves.toEqual({ removed: true });
    expect(mocks.remove).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      targetMembershipId: "member_1",
      expectedUpdatedAt: stamp,
    });
  });

  it("底層壞掉時回 503，不把原始錯誤丟給 App", async () => {
    mocks.remove.mockRejectedValue(new Error("boom"));
    await expect(
      mobileRemoveMember("workspace_1", "user_1", "member_1", {}),
    ).rejects.toMatchObject({ status: 503, code: "UNAVAILABLE" });
  });

  it("多帶沒列在白名單的欄位直接擋掉", () => {
    expect(() => membersBody({ email: "a@example.com", workspaceId: "x" }, INVITE_FIELDS, "格式有誤。"))
      .toThrowError();
    expect(membersBody({ email: "a@example.com" }, INVITE_FIELDS, "格式有誤。"))
      .toEqual({ email: "a@example.com" });
  });
});
