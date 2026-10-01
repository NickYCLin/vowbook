import { MAX_WORKSPACE_DOCUMENT_BYTES } from "@/domain/workspace-document";
import { getApiCurrentUser } from "@/lib/api-current-user";
import {
  hasBoundedContentLength,
  isSameOriginMutationRequest,
} from "@/lib/http-request-security";
import {
  documentJson,
  workspaceDocumentErrorResponse,
} from "@/lib/workspace-document-route";
import {
  assertWorkspaceDocumentUploadAccess,
  createWorkspaceDocument,
} from "@/lib/workspace-documents";

const MAX_MULTIPART_REQUEST_BYTES = MAX_WORKSPACE_DOCUMENT_BYTES + 1024 * 1024;

type RouteContext = { params: Promise<{ workspaceId: string }> };

function formText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!isSameOriginMutationRequest(request)) {
    return documentJson({ error: "拒絕跨來源請求。" }, 403);
  }
  const currentUser = await getApiCurrentUser();
  if (!currentUser) {
    return documentJson({ error: "請先登入後再試。" }, 401);
  }
  if (!hasBoundedContentLength(request, MAX_MULTIPART_REQUEST_BYTES)) {
    return documentJson({ error: "上傳內容缺少有效大小，或已超過單檔 25 MiB 上限。" }, 413);
  }

  try {
    const { workspaceId } = await context.params;
    await assertWorkspaceDocumentUploadAccess(workspaceId, currentUser.id);
    const formData = await request.formData();
    const file = formData.get("file");
    if (typeof file !== "object" || file === null || typeof file.name !== "string") {
      return documentJson({ error: "請選擇一個檔案。" }, 400);
    }
    const document = await createWorkspaceDocument({
      workspaceId,
      currentUserId: currentUser.id,
      originalName: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
      category: formText(formData, "category"),
      title: formText(formData, "title"),
      notes: formText(formData, "notes"),
    });
    return documentJson({ document }, 201);
  } catch (error) {
    return workspaceDocumentErrorResponse(error);
  }
}
