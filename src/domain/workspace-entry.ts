export const RECENT_WORKSPACE_COOKIE = "vowbook.recent-workspace";

export function recentWorkspaceValue(userId: string, workspaceId: string): string {
  return JSON.stringify({ userId, workspaceId });
}

/** A navigation preference is valid only within the current user's live membership list. */
export function workspaceEntryId(userId: string, workspaceIds: readonly string[], raw?: string): string | null {
  if (workspaceIds.length === 1) return workspaceIds[0];
  if (!raw || raw.length > 1024) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw));
    return value?.userId === userId && typeof value.workspaceId === "string" && workspaceIds.includes(value.workspaceId)
      ? value.workspaceId : null;
  } catch { return null; }
}

/**
 * 商標／返回連結該指到哪裡。沒有工作區時交回 `/dashboard`，
 * 讓它自己決定要帶去 onboarding 還是待確認的邀請。
 */
export function workspaceEntryPath(userId: string, workspaceIds: readonly string[], raw?: string): string {
  if (workspaceIds.length === 0) return "/dashboard";
  const target = workspaceEntryId(userId, workspaceIds, raw);
  return target ? `/workspaces/${target}/overview` : "/dashboard?view=all";
}
