import "server-only";

import { WorkspaceInvitationValidationError } from "@/domain/workspace-invitation";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  createWorkspaceInvitation,
  reinviteWorkspaceInvitation,
  removeWorkspaceMember,
  revokePendingWorkspaceInvitation,
  updateWorkspaceMemberRole,
  WorkspaceMemberValidationError,
} from "@/lib/workspace-invitations";

export const INVITE_FIELDS = ["email", "role", "operationKey"];
export const INVITATION_ACTION_FIELDS = ["action", "version", "role"];
export const MEMBER_ROLE_FIELDS = ["role", "expectedUpdatedAt"];
export const MEMBER_REMOVE_FIELDS = ["expectedUpdatedAt"];

const STALE = "成員或邀請已被更新，請重新整理後再試。";

export function membersBody(
  body: unknown,
  allowed: string[],
  message: string,
): Record<string, unknown> {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    throw new MobileRequestError(400, "INVALID_REQUEST", message);
  }
  return body as Record<string, unknown>;
}

function failure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof WorkspaceInvitationValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof WorkspaceMemberValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "只有婚宴的擁有者能管理協作者。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
}

/** operationKey 讓同一次送出重按也只會建立一筆邀請。 */
export async function mobileInviteMember(
  workspaceId: string,
  userId: string,
  fields: Record<string, unknown>,
) {
  try {
    const result = await createWorkspaceInvitation({
      workspaceId,
      currentUserId: userId,
      operationKey: fields.operationKey,
      email: fields.email,
      role: fields.role,
    });
    if (result.outcome === "REINVITE_REQUIRED") {
      throw new MobileRequestError(
        409,
        "REINVITE_REQUIRED",
        "這個 Email 的舊邀請已失效，請在下面的邀請清單重新邀請。",
      );
    }
    if (result.outcome === "ALREADY_PENDING") {
      return { outcome: result.outcome, message: "這個 Email 已有等待接受的邀請，角色與期限都沒變。" };
    }
    if (result.outcome === "REPLAYED") {
      return { outcome: result.outcome, message: "這次邀請已處理過，沒有重複建立。" };
    }
    return { outcome: result.outcome, message: "已建立協作邀請，請把 VowBook 網址傳給對方。" };
  } catch (error) {
    return failure(error);
  }
}

export async function mobileRevokeInvitation(
  workspaceId: string,
  userId: string,
  invitationId: string,
  fields: Record<string, unknown>,
) {
  try {
    const result = await revokePendingWorkspaceInvitation({
      workspaceId,
      currentUserId: userId,
      invitationId,
      version: fields.version,
    });
    if (result.outcome === "NOT_REVOCABLE") {
      throw new MobileRequestError(409, "STALE", "邀請已變更、過期或無法撤銷，請重新整理。");
    }
    return { outcome: result.outcome, message: "已撤銷邀請。" };
  } catch (error) {
    return failure(error);
  }
}

export async function mobileReinviteInvitation(
  workspaceId: string,
  userId: string,
  invitationId: string,
  fields: Record<string, unknown>,
) {
  try {
    const result = await reinviteWorkspaceInvitation({
      workspaceId,
      currentUserId: userId,
      invitationId,
      version: fields.version,
      role: fields.role,
    });
    if (result.outcome === "NOT_REINVITABLE") {
      throw new MobileRequestError(409, "STALE", "邀請已被更新或無法重新邀請，請重新整理。");
    }
    return { outcome: result.outcome, message: "已重新邀請，新的七天期限開始計算。" };
  } catch (error) {
    return failure(error);
  }
}

export async function mobileUpdateMemberRole(
  workspaceId: string,
  userId: string,
  membershipId: string,
  fields: Record<string, unknown>,
) {
  try {
    const result = await updateWorkspaceMemberRole({
      workspaceId,
      currentUserId: userId,
      targetMembershipId: membershipId,
      expectedUpdatedAt: fields.expectedUpdatedAt,
      role: fields.role,
    });
    if (result.outcome === "NOT_MUTABLE") {
      throw new MobileRequestError(409, "STALE", STALE);
    }
    return { updatedAt: result.updatedAt.toISOString() };
  } catch (error) {
    return failure(error);
  }
}

export async function mobileRemoveMember(
  workspaceId: string,
  userId: string,
  membershipId: string,
  fields: Record<string, unknown>,
) {
  try {
    const result = await removeWorkspaceMember({
      workspaceId,
      currentUserId: userId,
      targetMembershipId: membershipId,
      expectedUpdatedAt: fields.expectedUpdatedAt,
    });
    if (result.outcome === "NOT_MUTABLE") {
      throw new MobileRequestError(409, "STALE", STALE);
    }
    return { removed: true };
  } catch (error) {
    return failure(error);
  }
}
