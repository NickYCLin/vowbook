import { describe, expect, it } from "vitest";

import { BudgetAttachmentValidationError } from "@/domain/budget-attachment";
import {
  BudgetAttachmentDataError,
  BudgetAttachmentLimitError,
  BudgetAttachmentPermissionError,
  BudgetAttachmentTargetError,
} from "@/lib/budget-attachments";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { SerializationConflictError } from "@/lib/serializable-transaction";
import { mobileAttachmentError } from "./budget-attachments";

describe("收據附件的錯誤轉譯", () => {
  it("格式不合是 400", () => {
    const error = mobileAttachmentError(new BudgetAttachmentValidationError("附件格式不支援。"));
    expect(error.status).toBe(400);
    expect(error.message).toBe("附件格式不支援。");
  });

  it("沒權限是 403、找不到是 404、超過上限是 409", () => {
    expect(mobileAttachmentError(new BudgetAttachmentPermissionError()).status).toBe(403);
    expect(mobileAttachmentError(new BudgetAttachmentTargetError()).status).toBe(404);
    expect(mobileAttachmentError(new BudgetAttachmentLimitError("附件數量已達上限。")).status).toBe(409);
  });

  it("同時有人在改也是 409", () => {
    expect(mobileAttachmentError(new SerializationConflictError()).status).toBe(409);
  });

  it("檔案內容對不上是 500", () => {
    expect(mobileAttachmentError(new BudgetAttachmentDataError()).status).toBe(500);
  });

  it("已經是 App 錯誤就原樣傳回", () => {
    const original = new MobileRequestError(413, "TOO_LARGE", "太大了。");
    expect(mobileAttachmentError(original)).toBe(original);
  });

  it("其他狀況一律 503，不外洩內部訊息", () => {
    const error = mobileAttachmentError(new Error("connection string leaked"));
    expect(error.status).toBe(503);
    expect(error.message).not.toContain("leaked");
  });
});
