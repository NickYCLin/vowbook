"use server";

import { normalizeProductFeedback } from "@/domain/product-feedback";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type ProductFeedbackState = {
  status: "idle" | "success" | "error";
  message?: string;
  reference?: string;
};

export async function submitProductFeedbackAction(
  workspaceId: string,
  _previous: ProductFeedbackState,
  formData: FormData,
): Promise<ProductFeedbackState> {
  const user = await requireCurrentUser();
  let input;
  try {
    input = normalizeProductFeedback(formData);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "請檢查回饋內容。" };
  }
  const { requestId, ...details } = input;
  try {
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, user.id, "read", transaction);
      const existing = await transaction.productFeedback.findUnique({ where: { id: requestId } });
      if (existing) {
        if (existing.authorId !== user.id || existing.workspaceId !== workspaceId) {
          return { status: "error", message: "請重新開啟回饋表單後再試。" };
        }
        return { status: "success", reference: existing.id };
      }
      const count = await transaction.productFeedback.count({
        where: { authorId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      if (count >= 10) return { status: "error", message: "這一小時已送出多則回饋，請稍後再試。" };
      const record = await transaction.productFeedback.create({
        data: { id: requestId, workspaceId, authorId: user.id, ...details },
        select: { id: true },
      });
      return { status: "success", reference: record.id };
    });
  } catch (error) {
    return { status: "error", message: error instanceof WorkspaceAccessDeniedError
      ? "無權在此婚宴送出回饋。" : "目前無法保存回饋，內容仍保留，請稍後重試。" };
  }
}
