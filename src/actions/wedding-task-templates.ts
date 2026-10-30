"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/current-user";
import { applyWeddingTaskTemplate } from "@/lib/wedding-task-templates";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
export type TaskTemplateState = { status: "idle" | "success" | "error"; message?: string };
export async function applyWeddingTaskTemplateAction(workspaceId: string, _previous: TaskTemplateState, form: FormData): Promise<TaskTemplateState> {
  const user = await requireCurrentUser();
  let result: { createdCount: number; skippedCount: number };
  try { result = await applyWeddingTaskTemplate(workspaceId, user.id, { templateKey: form.get("templateKey") }); }
  catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return { status: "error", message: "沒有這場婚宴的編輯權限。" };
    return { status: "error", message: error instanceof MobileRequestError ? error.message : "目前無法加入任務範本，請稍後再試。" };
  }
  const message = `已加入 ${result.createdCount} 項任務，略過 ${result.skippedCount} 項既有任務。`;
  try {
    for (const path of ["tasks", "overview"]) revalidatePath(`/workspaces/${workspaceId}/${path}`);
    revalidatePath("/dashboard");
  } catch { return { status: "success", message: `${message}請手動重新整理。` }; }
  return { status: "success", message };
}
