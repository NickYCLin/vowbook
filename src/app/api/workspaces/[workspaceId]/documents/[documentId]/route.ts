import {
  buildWorkspaceDocumentContentDisposition,
  canViewWorkspaceDocumentInline,
  parseSingleByteRange,
} from "@/domain/workspace-document";
import { getApiCurrentUser } from "@/lib/api-current-user";
import { isSameOriginMutationRequest } from "@/lib/http-request-security";
import {
  documentJson,
  workspaceDocumentErrorResponse,
  workspaceDocumentSecurityHeaders,
} from "@/lib/workspace-document-route";
import {
  deleteWorkspaceDocument,
  getWorkspaceDocumentContent,
} from "@/lib/workspace-documents";

type RouteContext = {
  params: Promise<{ workspaceId: string; documentId: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const currentUser = await getApiCurrentUser();
  if (!currentUser) {
    return documentJson({ error: "請先登入後再試。" }, 401);
  }

  try {
    const { workspaceId, documentId } = await context.params;
    const document = await getWorkspaceDocumentContent({
      workspaceId,
      documentId,
      currentUserId: currentUser.id,
    });
    const inline =
      new URL(request.url).searchParams.get("disposition") === "inline" &&
      canViewWorkspaceDocumentInline(document.mediaType);
    const etag = `"${document.sha256}"`;
    const headers: Record<string, string> = {
      ...workspaceDocumentSecurityHeaders,
      "content-type": document.mediaType,
      "content-disposition": buildWorkspaceDocumentContentDisposition(
        document.originalName,
        document.mediaType,
        inline ? "inline" : "attachment",
      ),
      // PDF 在沙箱內會被 Chromium 的檢視器拒絕顯示，其餘格式一律沙箱化。
      "content-security-policy":
        document.mediaType === "application/pdf"
          ? "default-src 'none'; frame-ancestors 'none'"
          : "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "accept-ranges": "bytes",
      etag,
    };

    const ifRange = request.headers.get("if-range");
    const range =
      ifRange !== null && ifRange !== etag
        ? ({ kind: "none" } as const)
        : parseSingleByteRange(request.headers.get("range"), document.byteSize);

    if (range.kind === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-length": "0", "content-range": `bytes */${document.byteSize}` },
      });
    }
    if (range.kind === "range") {
      const body = document.data.subarray(range.start, range.end + 1);
      return new Response(new Uint8Array(body), {
        status: 206,
        headers: {
          ...headers,
          "content-length": String(body.byteLength),
          "content-range": `bytes ${range.start}-${range.end}/${document.byteSize}`,
        },
      });
    }
    return new Response(new Uint8Array(document.data), {
      status: 200,
      headers: { ...headers, "content-length": String(document.byteSize) },
    });
  } catch (error) {
    return workspaceDocumentErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!isSameOriginMutationRequest(request)) {
    return documentJson({ error: "拒絕跨來源請求。" }, 403);
  }
  const currentUser = await getApiCurrentUser();
  if (!currentUser) {
    return documentJson({ error: "請先登入後再試。" }, 401);
  }
  try {
    const { workspaceId, documentId } = await context.params;
    await deleteWorkspaceDocument({ workspaceId, documentId, currentUserId: currentUser.id });
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return workspaceDocumentErrorResponse(error);
  }
}
