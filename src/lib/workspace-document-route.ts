import { WorkspaceDocumentValidationError } from "@/domain/workspace-document";
import {
  WorkspaceDocumentDataError,
  WorkspaceDocumentLimitError,
  WorkspaceDocumentPermissionError,
  WorkspaceDocumentTargetError,
} from "@/lib/workspace-documents";
import { SerializationConflictError } from "@/lib/serializable-transaction";

export const workspaceDocumentSecurityHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
} as const;

export function documentJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      ...workspaceDocumentSecurityHeaders,
      "content-security-policy":
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

export function workspaceDocumentErrorResponse(error: unknown): Response {
  if (error instanceof WorkspaceDocumentValidationError) {
    return documentJson({ error: error.message }, 400);
  }
  if (error instanceof WorkspaceDocumentPermissionError) {
    return documentJson({ error: error.message }, 403);
  }
  if (error instanceof WorkspaceDocumentTargetError) {
    return documentJson({ error: error.message }, 404);
  }
  if (error instanceof WorkspaceDocumentLimitError) {
    return documentJson({ error: error.message }, 409);
  }
  if (error instanceof SerializationConflictError) {
    return documentJson({ error: "同時有其他文件變更，請重新整理後再試。" }, 409);
  }
  if (error instanceof WorkspaceDocumentDataError) {
    return documentJson({ error: error.message }, 500);
  }
  return documentJson({ error: "目前無法處理文件，請稍後再試。" }, 500);
}
