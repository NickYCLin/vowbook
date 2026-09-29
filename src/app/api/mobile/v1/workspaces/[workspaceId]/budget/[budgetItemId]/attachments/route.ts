import { MAX_BUDGET_ATTACHMENT_BYTES } from "@/domain/budget-attachment";
import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileAttachmentError } from "@/lib/mobile/budget-attachments";
import {
  assertBudgetAttachmentUploadAccess,
  createBudgetAttachment,
} from "@/lib/budget-attachments";
import { hasBoundedContentLength } from "@/lib/http-request-security";

export const runtime = "nodejs";

const MAX_MULTIPART_REQUEST_BYTES = MAX_BUDGET_ATTACHMENT_BYTES + 1024 * 1024;

/**
 * 上傳收據。身分只認 Bearer token，不吃 cookie，所以不需要同源檢查；
 * 權限、格式、容量上限全部沿用網站那份 lib，不另外放寬。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; budgetItemId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    if (!hasBoundedContentLength(request, MAX_MULTIPART_REQUEST_BYTES)) {
      throw new MobileRequestError(413, "TOO_LARGE", "上傳內容缺少有效大小，或已超過 10 MiB 附件上限。");
    }
    const { workspaceId, budgetItemId } = await context.params;
    await assertBudgetAttachmentUploadAccess({
      workspaceId,
      budgetItemId,
      currentUserId: user.id,
    });
    const file = (await request.formData()).get("file");
    if (
      typeof file !== "object" || file === null ||
      !("name" in file) || typeof file.name !== "string" ||
      !("type" in file) || typeof file.type !== "string" ||
      !("arrayBuffer" in file) || typeof file.arrayBuffer !== "function"
    ) {
      throw new MobileRequestError(400, "VALIDATION", "請選擇一個有效附件。");
    }
    const attachment = await createBudgetAttachment({
      workspaceId,
      budgetItemId,
      currentUserId: user.id,
      originalName: file.name,
      mediaType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });
    return mobileJSON({ attachment }, 201);
  } catch (error) {
    return mobileError(mobileAttachmentError(error));
  }
}
