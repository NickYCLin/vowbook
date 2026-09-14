"use server";

import { revalidatePath } from "next/cache";
import { normalizeHandoff, handoffVersion, HandoffValidationError, HANDOFF_STATUS_LABELS } from "@/domain/coordinator-handoff";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";
import { runSerializableTransaction, SerializationConflictError } from "@/lib/serializable-transaction";

export type HandoffMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  code?: "VALIDATION" | "FORBIDDEN" | "STALE" | "UNAVAILABLE";
  revision?: number;
};
class StaleHandoffError extends Error {}
async function mutate(workspaceId: string, id: string | null, data: FormData, operation: "SAVE" | "STATUS" | "DELETE"): Promise<HandoffMutationState> {
  const user = await requireCurrentUser();
  try {
    await requireWorkspaceAccess(workspaceId, user.id, "edit");
    const version = id ? handoffVersion(data) : null;
    const details = operation === "SAVE" ? normalizeHandoff(data) : null;
    const status = data.get("status");
    if (operation === "STATUS" && (typeof status !== "string" || !Object.hasOwn(HANDOFF_STATUS_LABELS, status))) throw new HandoffValidationError("請選擇有效的處理狀態。");
    await runSerializableTransaction(async (tx) => {
      await requireLockedWorkspaceAccess(workspaceId, user.id, "edit", tx);
      if (details?.staffId && !await tx.weddingStaffAssignment.findFirst({ where: { id: details.staffId, workspaceId }, select: { id: true } })) throw new HandoffValidationError("負責人已不存在，請重新選擇。");
      if (details?.timelineItemId && !await tx.weddingTimelineItem.findFirst({ where: { id: details.timelineItemId, workspaceId }, select: { id: true } })) throw new HandoffValidationError("流程已不存在，請重新選擇。");
      if (!id && details) {
        await tx.coordinatorHandoff.create({ data: { ...details, workspaceId } });
        return;
      }
      if (!id || version === null) throw new HandoffValidationError("交辦事項無效。");
      const where = { id, workspaceId, version };
      const result = operation === "DELETE"
        ? await tx.coordinatorHandoff.deleteMany({ where })
        : await tx.coordinatorHandoff.updateMany({
          where,
          data: { ...(details ?? { status: status as string }), version: { increment: 1 } },
        });
      if (result.count !== 1) throw new StaleHandoffError();
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return { status: "error", code: "FORBIDDEN", message: error.message };
    if (error instanceof HandoffValidationError) return { status: "error", code: "VALIDATION", message: error.message };
    if (error instanceof StaleHandoffError || error instanceof SerializationConflictError || (typeof error === "object" && error !== null && "code" in error && error.code === "P2003")) return { status: "error", code: "STALE", message: "資料已被更新或移除，請重新整理後再試；尚未覆寫你的修改。" };
    return { status: "error", code: "UNAVAILABLE", message: "目前無法儲存交辦事項，請稍後再試。" };
  }
  let refreshed = true;
  for (const page of ["staff/handoffs", "timeline"]) {
    try { revalidatePath(`/workspaces/${workspaceId}/${page}`); } catch { refreshed = false; }
  }
  return { status: "success", message: (operation === "DELETE" ? "已移除交辦事項。" : "已儲存交辦事項。") + (refreshed ? "" : "請重新整理以取得最新清單。"), revision: Date.now() };
}
export async function saveHandoffAction(workspaceId: string, id: string | null, _state: HandoffMutationState, data: FormData) {
  return mutate(workspaceId, id, data, "SAVE");
}
export async function setHandoffStatusAction(workspaceId: string, id: string, _state: HandoffMutationState, data: FormData) {
  return mutate(workspaceId, id, data, "STATUS");
}
export async function deleteHandoffAction(workspaceId: string, id: string, _state: HandoffMutationState, data: FormData) {
  return mutate(workspaceId, id, data, "DELETE");
}
