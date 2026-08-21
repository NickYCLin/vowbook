import {
  BudgetAttachmentValidationError,
} from "@/domain/budget-attachment";
import {
  BudgetAttachmentPreviewBusyError,
  BudgetAttachmentPreviewUnavailableError,
} from "@/lib/budget-attachment-preview";
import {
  BudgetAttachmentDataError,
  BudgetAttachmentLimitError,
  BudgetAttachmentPermissionError,
  BudgetAttachmentTargetError,
} from "@/lib/budget-attachments";
import { SerializationConflictError } from "@/lib/serializable-transaction";

export function attachmentJson(
  body: unknown,
  status: number,
  additionalHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-security-policy":
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...additionalHeaders,
    },
  });
}

export function budgetAttachmentErrorResponse(error: unknown): Response {
  if (error instanceof BudgetAttachmentPreviewUnavailableError) {
    return attachmentJson({ error: error.message }, 422);
  }
  if (error instanceof BudgetAttachmentPreviewBusyError) {
    return attachmentJson(
      { error: error.message },
      429,
      { "retry-after": "5" },
    );
  }
  if (error instanceof BudgetAttachmentValidationError) {
    return attachmentJson({ error: error.message }, 400);
  }
  if (error instanceof BudgetAttachmentPermissionError) {
    return attachmentJson({ error: error.message }, 403);
  }
  if (error instanceof BudgetAttachmentTargetError) {
    return attachmentJson({ error: error.message }, 404);
  }
  if (error instanceof BudgetAttachmentLimitError) {
    return attachmentJson({ error: error.message }, 409);
  }
  if (error instanceof SerializationConflictError) {
    return attachmentJson(
      { error: "同時有其他附件變更，請重新確認後再試。" },
      409,
    );
  }
  if (error instanceof BudgetAttachmentDataError) {
    return attachmentJson({ error: error.message }, 500);
  }
  return attachmentJson(
    { error: "目前無法處理附件，請稍後再試。" },
    500,
  );
}
