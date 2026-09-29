import "server-only";

import { BudgetAttachmentValidationError } from "@/domain/budget-attachment";
import {
  BudgetAttachmentDataError,
  BudgetAttachmentLimitError,
  BudgetAttachmentPermissionError,
  BudgetAttachmentTargetError,
} from "@/lib/budget-attachments";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { SerializationConflictError } from "@/lib/serializable-transaction";

/**
 * 把網站那套附件錯誤翻成 App 認得的代碼。訊息沿用原本那句，
 * 不另外造詞，才不會同一件事在網站和 App 講法不一樣。
 */
export function mobileAttachmentError(error: unknown): MobileRequestError {
  if (error instanceof MobileRequestError) return error;
  if (error instanceof BudgetAttachmentValidationError) {
    return new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof BudgetAttachmentPermissionError) {
    return new MobileRequestError(403, "FORBIDDEN", error.message);
  }
  if (error instanceof BudgetAttachmentTargetError) {
    return new MobileRequestError(404, "NOT_FOUND", error.message);
  }
  if (error instanceof BudgetAttachmentLimitError) {
    return new MobileRequestError(409, "LIMIT", error.message);
  }
  if (error instanceof SerializationConflictError) {
    return new MobileRequestError(409, "CONFLICT", "同時有其他附件變更，請重新確認後再試。");
  }
  if (error instanceof BudgetAttachmentDataError) {
    return new MobileRequestError(500, "DATA", error.message);
  }
  return new MobileRequestError(503, "UNAVAILABLE", "目前無法處理附件，請稍後再試。");
}
