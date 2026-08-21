import { MAX_BUDGET_ATTACHMENT_BYTES } from "@/domain/budget-attachment";
import { getApiCurrentUser } from "@/lib/api-current-user";
import {
  attachmentJson,
  budgetAttachmentErrorResponse,
} from "@/lib/budget-attachment-route";
import {
  assertBudgetAttachmentUploadAccess,
  createBudgetAttachment,
} from "@/lib/budget-attachments";
import {
  hasBoundedContentLength,
  isSameOriginMutationRequest,
} from "@/lib/http-request-security";

const MAX_MULTIPART_REQUEST_BYTES =
  MAX_BUDGET_ATTACHMENT_BYTES + 1024 * 1024;

type RouteContext = {
  params: Promise<{ workspaceId: string; budgetItemId: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!isSameOriginMutationRequest(request)) {
    return attachmentJson({ error: "拒絕跨來源請求。" }, 403);
  }

  const currentUser = await getApiCurrentUser();
  if (!currentUser) {
    return attachmentJson({ error: "請先登入後再試。" }, 401);
  }

  if (!hasBoundedContentLength(request, MAX_MULTIPART_REQUEST_BYTES)) {
    return attachmentJson(
      { error: "上傳內容缺少有效大小，或已超過 10 MiB 附件上限。" },
      413,
    );
  }

  try {
    const { workspaceId, budgetItemId } = await context.params;
    await assertBudgetAttachmentUploadAccess({
      workspaceId,
      budgetItemId,
      currentUserId: currentUser.id,
    });
    const formData = await request.formData();
    const file = formData.get("file");
    if (
      typeof file !== "object" ||
      file === null ||
      !("name" in file) ||
      typeof file.name !== "string" ||
      !("type" in file) ||
      typeof file.type !== "string" ||
      !("arrayBuffer" in file) ||
      typeof file.arrayBuffer !== "function"
    ) {
      return attachmentJson({ error: "請選擇一個有效附件。" }, 400);
    }

    const attachment = await createBudgetAttachment({
      workspaceId,
      budgetItemId,
      currentUserId: currentUser.id,
      originalName: file.name,
      mediaType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });

    return attachmentJson({ attachment }, 201);
  } catch (error) {
    return budgetAttachmentErrorResponse(error);
  }
}
