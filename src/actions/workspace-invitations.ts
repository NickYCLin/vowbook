"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeInvitationEmail,
  normalizeInvitationOperationKey,
  normalizeInvitationRole,
  normalizeInvitationVersion,
  WorkspaceInvitationValidationError,
} from "@/domain/workspace-invitation";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  createWorkspaceInvitation,
  reinviteWorkspaceInvitation,
  removeWorkspaceMember,
  revokePendingWorkspaceInvitation,
  updateWorkspaceMemberRole,
  WorkspaceMemberValidationError,
} from "@/lib/workspace-invitations";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export type WorkspaceInvitationMutationCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "ALREADY_PENDING"
  | "REINVITE_REQUIRED"
  | "STALE"
  | "UNAVAILABLE";

export type WorkspaceInvitationMutationState = {
  status: "idle" | "success" | "error";
  code?: WorkspaceInvitationMutationCode;
  field?: "email" | "role" | "operationKey";
  message?: string;
  membershipId?: string;
  role?: "PARTNER" | "PLANNER" | "VIEWER";
  updatedAt?: string;
};

const INVITATION_DELIVERY_GUIDANCE =
  "請將 VowBook 網址傳給對方。";

type AuthorizedUser =
  | { currentUserId: string; error?: never }
  | { currentUserId?: never; error: WorkspaceInvitationMutationState };

async function authorizeOwner(workspaceId: string): Promise<AuthorizedUser> {
  const currentUser = await requireCurrentUser();
  try {
    await requireWorkspaceAccess(
      workspaceId,
      currentUser.id,
      "manageMembers",
    );
    return { currentUserId: currentUser.id };
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return {
        error: {
          status: "error",
          code: "FORBIDDEN",
          message: error.message,
        },
      };
    }
    return {
      error: {
        status: "error",
        code: "UNAVAILABLE",
        message: "目前無法確認工作區權限，請稍後再試。",
      },
    };
  }
}

function validationError(
  error: unknown,
  field: "email" | "role" | "operationKey",
): WorkspaceInvitationMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    field,
    message:
      error instanceof WorkspaceInvitationValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

function staleError(message: string): WorkspaceInvitationMutationState {
  return {
    status: "error",
    code: "STALE",
    message,
  };
}

function revalidateMembersPage(workspaceId: string): boolean {
  try {
    revalidatePath(`/workspaces/${workspaceId}/members`);
    revalidatePath("/dashboard");
    return true;
  } catch {
    console.error("協作頁面重新驗證失敗。");
    return false;
  }
}

export async function createWorkspaceInvitationAction(
  workspaceId: string,
  _previousState: WorkspaceInvitationMutationState,
  formData: FormData,
): Promise<WorkspaceInvitationMutationState> {
  void _previousState;
  const authorization = await authorizeOwner(workspaceId);
  if (authorization.error) return authorization.error;

  let email: string;
  try {
    email = normalizeInvitationEmail(formData.get("email"));
  } catch (error) {
    return validationError(error, "email");
  }

  let role: "PARTNER" | "PLANNER" | "VIEWER";
  try {
    role = normalizeInvitationRole(formData.get("role"));
  } catch (error) {
    return validationError(error, "role");
  }

  let operationKey: string;
  try {
    operationKey = normalizeInvitationOperationKey(formData.get("operationKey"));
  } catch (error) {
    return validationError(error, "operationKey");
  }

  let result;
  try {
    result = await createWorkspaceInvitation({
      workspaceId,
      currentUserId: authorization.currentUserId,
      operationKey,
      email,
      role,
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return {
        status: "error",
        code: "FORBIDDEN",
        message: error.message,
      };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法建立協作邀請，請稍後再試。",
    };
  }

  if (result.outcome === "ALREADY_PENDING") {
    return {
      status: "success",
      code: "ALREADY_PENDING",
      message: "這個 Email 已有等待接受的邀請；角色與期限都沒有變更。",
    };
  }
  if (result.outcome === "REINVITE_REQUIRED") {
    return {
      status: "error",
      code: "REINVITE_REQUIRED",
      message: "這個 Email 的舊邀請已失效，請在「需重新邀請」選擇角色。",
    };
  }
  if (result.outcome === "REPLAYED") {
    const message = "這次邀請操作已處理，沒有新增或修改邀請。";
    return {
      status: "success",
      message: revalidateMembersPage(workspaceId)
        ? message
        : `${message}；畫面未自動更新，請重新整理。`,
    };
  }

  const message = `已建立協作邀請。${INVITATION_DELIVERY_GUIDANCE}`;
  return {
    status: "success",
    message: revalidateMembersPage(workspaceId)
      ? message
      : `${message}；畫面未自動更新，請重新整理。`,
  };
}

function lifecycleIdentity(formData: FormData):
  | { invitationId: string; version: number }
  | null {
  const invitationId = formData.get("invitationId");
  if (typeof invitationId !== "string" || !invitationId) return null;
  try {
    return {
      invitationId,
      version: normalizeInvitationVersion(formData.get("version")),
    };
  } catch {
    return null;
  }
}

export async function revokeWorkspaceInvitationAction(
  workspaceId: string,
  _previousState: WorkspaceInvitationMutationState,
  formData: FormData,
): Promise<WorkspaceInvitationMutationState> {
  void _previousState;
  const authorization = await authorizeOwner(workspaceId);
  if (authorization.error) return authorization.error;

  const identity = lifecycleIdentity(formData);
  if (!identity) {
    return staleError("邀請已變更、過期或無法撤銷，請重新整理。");
  }

  let result;
  try {
    result = await revokePendingWorkspaceInvitation({
      workspaceId,
      currentUserId: authorization.currentUserId,
      ...identity,
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return {
        status: "error",
        code: "FORBIDDEN",
        message: error.message,
      };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法撤銷邀請，請稍後再試。",
    };
  }

  if (result.outcome === "NOT_REVOCABLE") {
    return staleError("邀請已變更、過期或無法撤銷，請重新整理。");
  }

  return {
    status: "success",
    message: revalidateMembersPage(workspaceId)
      ? "已撤銷邀請。"
      : "已撤銷邀請；畫面未自動更新，請重新整理。",
  };
}

export async function reinviteWorkspaceInvitationAction(
  workspaceId: string,
  _previousState: WorkspaceInvitationMutationState,
  formData: FormData,
): Promise<WorkspaceInvitationMutationState> {
  void _previousState;
  const authorization = await authorizeOwner(workspaceId);
  if (authorization.error) return authorization.error;

  const identity = lifecycleIdentity(formData);
  if (!identity) {
    return staleError("邀請已被更新或無法重新邀請，請重新整理。");
  }

  let role: "PARTNER" | "PLANNER" | "VIEWER";
  try {
    role = normalizeInvitationRole(formData.get("role"));
  } catch (error) {
    return validationError(error, "role");
  }

  let result;
  try {
    result = await reinviteWorkspaceInvitation({
      workspaceId,
      currentUserId: authorization.currentUserId,
      ...identity,
      role,
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return {
        status: "error",
        code: "FORBIDDEN",
        message: error.message,
      };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法重新邀請，請稍後再試。",
    };
  }

  if (result.outcome === "NOT_REINVITABLE") {
    return staleError("邀請已被更新或無法重新邀請，請重新整理。");
  }

  const message = `已重新邀請，新的七天期限已開始。${INVITATION_DELIVERY_GUIDANCE}`;
  return {
    status: "success",
    message: revalidateMembersPage(workspaceId)
      ? message
      : `${message}；畫面未自動更新，請重新整理。`,
  };
}

function memberIdentity(formData: FormData):
  | { targetMembershipId: string; expectedUpdatedAt: Date }
  | null {
  const targetMembershipId = formData.get("membershipId");
  const rawUpdatedAt = formData.get("expectedUpdatedAt");
  if (
    typeof targetMembershipId !== "string" ||
    targetMembershipId.length === 0 ||
    targetMembershipId.length > 191 ||
    targetMembershipId.trim() !== targetMembershipId ||
    typeof rawUpdatedAt !== "string"
  ) {
    return null;
  }
  const expectedUpdatedAt = new Date(rawUpdatedAt);
  if (
    !Number.isFinite(expectedUpdatedAt.getTime()) ||
    expectedUpdatedAt.toISOString() !== rawUpdatedAt
  ) {
    return null;
  }
  return { targetMembershipId, expectedUpdatedAt };
}

function memberMutationUnavailable(
  message: string,
): WorkspaceInvitationMutationState {
  return { status: "error", code: "UNAVAILABLE", message };
}

export async function updateWorkspaceMemberRoleAction(
  workspaceId: string,
  _previousState: WorkspaceInvitationMutationState,
  formData: FormData,
): Promise<WorkspaceInvitationMutationState> {
  void _previousState;
  const authorization = await authorizeOwner(workspaceId);
  if (authorization.error) return authorization.error;

  const identity = memberIdentity(formData);
  if (!identity) {
    return staleError("成員資料已變更或無法操作，請重新整理。");
  }

  let role: "PARTNER" | "PLANNER" | "VIEWER";
  try {
    role = normalizeInvitationRole(formData.get("role"));
  } catch (error) {
    return validationError(error, "role");
  }

  let result;
  try {
    result = await updateWorkspaceMemberRole({
      workspaceId,
      currentUserId: authorization.currentUserId,
      ...identity,
      role,
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    if (error instanceof WorkspaceMemberValidationError) {
      return validationError(error, "role");
    }
    return memberMutationUnavailable(
      "目前無法更新協作者角色，請稍後再試。",
    );
  }

  if (result.outcome === "NOT_MUTABLE") {
    return staleError("成員資料已變更或無法操作，請重新整理。");
  }

  const message = "已更新協作者角色。";
  return {
    status: "success",
    message: revalidateMembersPage(workspaceId)
      ? message
      : `${message}畫面未自動更新，請重新整理。`,
    membershipId: identity.targetMembershipId,
    role,
    updatedAt: result.updatedAt.toISOString(),
  };
}

export async function removeWorkspaceMemberAction(
  workspaceId: string,
  _previousState: WorkspaceInvitationMutationState,
  formData: FormData,
): Promise<WorkspaceInvitationMutationState> {
  void _previousState;
  const authorization = await authorizeOwner(workspaceId);
  if (authorization.error) return authorization.error;

  const identity = memberIdentity(formData);
  if (!identity) {
    return staleError("成員資料已變更或無法操作，請重新整理。");
  }

  let result;
  try {
    result = await removeWorkspaceMember({
      workspaceId,
      currentUserId: authorization.currentUserId,
      ...identity,
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    return memberMutationUnavailable("目前無法移除協作者，請稍後再試。");
  }

  if (result.outcome === "NOT_MUTABLE") {
    return staleError("成員資料已變更或無法操作，請重新整理。");
  }

  const message = "已移除協作者。";
  return {
    status: "success",
    message: revalidateMembersPage(workspaceId)
      ? message
      : `${message}畫面未自動更新，請重新整理。`,
    membershipId: identity.targetMembershipId,
  };
}
