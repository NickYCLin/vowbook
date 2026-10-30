import "server-only";
import { findWeddingTaskTemplate } from "@/domain/wedding-task-templates";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction, SerializationConflictError } from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";
import { MobileRequestError } from "@/lib/mobile/protocol";

export async function applyWeddingTaskTemplate(workspaceId: string, userId: string, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "templateKey")) {
    throw new MobileRequestError(400, "VALIDATION", "任務範本輸入格式有誤。");
  }
  const template = findWeddingTaskTemplate((body as Record<string, unknown>).templateKey);
  if (!template) throw new MobileRequestError(400, "VALIDATION", "請選擇文定或宴客任務範本。");
  try {
    return await runSerializableTransaction(async (tx) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
      const existing = await tx.weddingTask.findMany({ where: { workspaceId }, select: { title: true, templateKey: true } });
      const keys = new Set(existing.map((task) => task.templateKey));
      const titles = new Set(existing.map((task) => task.title));
      const missing = template.tasks.filter((task) => !keys.has(task.key) && !titles.has(task.title));
      const result = missing.length === 0 ? { count: 0 } : await tx.weddingTask.createMany({
        data: missing.map((task) => ({ workspaceId, templateKey: task.key, title: task.title, description: task.description,
          dueDate: null, side: "SHARED", status: "TODO" })), skipDuplicates: true,
      });
      return { createdCount: result.count, skippedCount: template.tasks.length - result.count };
    }, prisma);
  } catch (error) {
    if (error instanceof SerializationConflictError) throw new MobileRequestError(409, "CONFLICT", "任務剛剛有其他變更，請再試一次。");
    throw error;
  }
}
