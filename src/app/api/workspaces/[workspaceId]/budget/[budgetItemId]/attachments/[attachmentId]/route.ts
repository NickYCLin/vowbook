import { createHash } from "node:crypto";
import {
  buildAttachmentContentDisposition,
  resolveBudgetAttachmentDisposition,
} from "@/domain/budget-attachment";
import { getApiCurrentUser } from "@/lib/api-current-user";
import {
  attachmentJson,
  budgetAttachmentErrorResponse,
} from "@/lib/budget-attachment-route";
import { createBudgetAttachmentPreview } from "@/lib/budget-attachment-preview";
import { runBudgetAttachmentPreviewRequest } from "@/lib/budget-attachment-preview-request-gate";
import { acquireBudgetAttachmentResponseSlot } from "@/lib/budget-attachment-response-gate";
import {
  assertBudgetAttachmentReadAccess,
  deleteBudgetAttachment,
  getBudgetAttachmentDownload,
} from "@/lib/budget-attachments";
import { isSameOriginMutationRequest } from "@/lib/http-request-security";

type RouteContext = {
  params: Promise<{
    workspaceId: string;
    budgetItemId: string;
    attachmentId: string;
  }>;
};

const ATTACHMENT_CSP =
  "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const INLINE_PDF_CSP =
  "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const INLINE_IMAGE_CSP =
  "sandbox; default-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const RESPONSE_CHUNK_BYTES = 64 * 1024;
const MAX_ATTACHMENT_RESPONSE_MS = 2 * 60 * 1000;

type ParsedRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "unsupported" }
  | { kind: "unsatisfiable" }
  | { end: number; kind: "range"; start: number };

function parseSingleByteRange(value: string | null, total: number): ParsedRange {
  if (value === null) return { kind: "none" };
  const unitMatch = /^([^=]+)=(.*)$/u.exec(value.trim());
  if (!unitMatch) return { kind: "invalid" };
  if (unitMatch[1].trim().toLowerCase() !== "bytes") {
    return { kind: "unsupported" };
  }
  if (unitMatch[2].includes(",")) return { kind: "unsupported" };
  const match = /^(\d*)-(\d*)$/u.exec(unitMatch[2].trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    return { kind: "invalid" };
  }

  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength)) {
      return { kind: "invalid" };
    }
    if (suffixLength < 1) return { kind: "unsatisfiable" };
    return {
      end: total - 1,
      kind: "range",
      start: Math.max(0, total - suffixLength),
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? total - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0
  ) {
    return { kind: "invalid" };
  }
  if (start >= total) return { kind: "unsatisfiable" };
  if (requestedEnd < start) return { kind: "invalid" };
  return {
    end: Math.min(requestedEnd, total - 1),
    kind: "range",
    start,
  };
}

function attachmentHeaders({
  byteLength,
  disposition,
  mediaType,
  originalName,
}: {
  byteLength: number;
  disposition: "attachment" | "inline";
  mediaType: Parameters<typeof buildAttachmentContentDisposition>[1];
  originalName: string;
}): Record<string, string> {
  return {
    "cache-control": "private, no-store",
    "content-disposition": buildAttachmentContentDisposition(
      originalName,
      mediaType,
      disposition,
    ),
    "content-length": String(byteLength),
    "content-security-policy":
      disposition === "inline"
        ? mediaType === "application/pdf"
          ? INLINE_PDF_CSP
          : INLINE_IMAGE_CSP
        : ATTACHMENT_CSP,
    "content-type": mediaType,
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function responseBody(data: Buffer, release: () => void): BodyInit {
  let offset = 0;
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (): void => {
    if (released) return;
    released = true;
    if (timer) clearTimeout(timer);
    release();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        finish();
        controller.error(new Error("Attachment response deadline exceeded."));
      }, MAX_ATTACHMENT_RESPONSE_MS);
      timer.unref();
    },
    pull(controller) {
      if (offset >= data.byteLength) {
        finish();
        controller.close();
        return;
      }
      const end = Math.min(offset + RESPONSE_CHUNK_BYTES, data.byteLength);
      controller.enqueue(data.subarray(offset, end));
      offset = end;
    },
    cancel() {
      finish();
    },
  });
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function previewNavigationErrorResponse(
  request: Request,
  response: Response,
): Response {
  const fetchDestination = request.headers.get("sec-fetch-dest");
  if (
    (fetchDestination !== "document" && fetchDestination !== "iframe") ||
    resolveBudgetAttachmentDisposition(new URL(request.url)) !== "inline" ||
    ![401, 404, 422, 429, 500].includes(response.status)
  ) {
    return response;
  }
  const downloadUrl = new URL(request.url);
  downloadUrl.search = "";
  const content =
    response.status === 401
      ? {
          guidance: "請關閉此分頁，回到 VowBook 重新登入。",
          offerDownload: false,
          title: "登入狀態已失效",
        }
      : response.status === 429
        ? {
            guidance: "請稍後再試，或下載原始檔。",
            offerDownload: true,
            title: "附件預覽服務忙碌",
          }
        : response.status === 422
          ? {
              guidance: "請關閉此分頁，或下載原始檔。",
              offerDownload: true,
              title: "這個附件無法安全預覽",
            }
          : {
              guidance: "請稍後重試，或關閉此分頁。",
              offerDownload: false,
              title: "附件預覽暫時無法使用",
            };
  const recoveryLink = content.offerDownload
    ? `<p><a href="${escapeHtmlAttribute(downloadUrl.pathname)}">下載原始檔</a></p>`
    : "";
  const body = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${content.title}</title><main role="alert" aria-live="assertive"><p>VowBook 安全附件預覽</p><h1>${content.title}</h1><p>${content.guidance}</p>${recoveryLink}</main></html>`;
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-security-policy":
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors " +
      (fetchDestination === "iframe" ? "'self'" : "'none'"),
    "content-type": "text/html; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new Response(body, { status: response.status, headers });
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const currentUser = await getApiCurrentUser();
    if (!currentUser) {
      return previewNavigationErrorResponse(
        request,
        attachmentJson({ error: "請先登入後再試。" }, 401),
      );
    }

    const disposition = resolveBudgetAttachmentDisposition(
      new URL(request.url),
    );
    const { workspaceId, budgetItemId, attachmentId } = await context.params;
    const attachmentScope = {
      workspaceId,
      budgetItemId,
      attachmentId,
      currentUserId: currentUser.id,
    };
    await assertBudgetAttachmentReadAccess(attachmentScope);
    const responseSlot = await acquireBudgetAttachmentResponseSlot({
      signal: request.signal,
      userId: currentUser.id,
      workspaceId,
    });
    const loadAttachment = async () => {
      const attachment = await getBudgetAttachmentDownload(attachmentScope);
      request.signal.throwIfAborted();
      return attachment;
    };
    try {
      if (disposition === "attachment") {
        const attachment = await loadAttachment();
        return new Response(
          responseBody(attachment.data, responseSlot.release),
          {
            status: 200,
            headers: attachmentHeaders({
              byteLength: attachment.byteSize,
              disposition,
              mediaType: attachment.mediaType,
              originalName: attachment.originalName,
            }),
          },
        );
      }

      return await runBudgetAttachmentPreviewRequest({
        signal: request.signal,
        userId: currentUser.id,
        workspaceId,
        task: async () => {
          const attachment = await loadAttachment();
          const preview = await createBudgetAttachmentPreview(
            {
              data: attachment.data,
              mediaType: attachment.mediaType,
            },
            request.signal,
          );
          request.signal.throwIfAborted();
          const total = preview.data.byteLength;
          const etag = `"${createHash("sha256").update(preview.data).digest("hex")}"`;
          let range = parseSingleByteRange(
            request.headers.get("range"),
            total,
          );
          const headers = attachmentHeaders({
            byteLength: total,
            disposition: "inline",
            mediaType: preview.mediaType,
            originalName: attachment.originalName,
          });
          headers["accept-ranges"] = "bytes";
          headers.etag = etag;

          const ifRange = request.headers.get("if-range");
          if (ifRange !== null && ifRange !== etag) {
            range = { kind: "none" };
          }

          if (range.kind === "unsatisfiable") {
            responseSlot.release();
            headers["content-length"] = "0";
            headers["content-range"] = "bytes */" + total;
            return new Response(null, { status: 416, headers });
          }
          if (range.kind === "range") {
            const body = Buffer.from(
              preview.data.subarray(range.start, range.end + 1),
            );
            headers["content-length"] = String(body.byteLength);
            headers["content-range"] =
              "bytes " + range.start + "-" + range.end + "/" + total;
            return new Response(responseBody(body, responseSlot.release), {
              status: 206,
              headers,
            });
          }
          return new Response(
            responseBody(preview.data, responseSlot.release),
            {
              status: 200,
              headers,
            },
          );
        },
      });
    } catch (error) {
      responseSlot.release();
      throw error;
    }
  } catch (error) {
    return previewNavigationErrorResponse(
      request,
      budgetAttachmentErrorResponse(error),
    );
  }
}

export async function DELETE(
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

  try {
    const { workspaceId, budgetItemId, attachmentId } =
      await context.params;
    await deleteBudgetAttachment({
      workspaceId,
      budgetItemId,
      attachmentId,
      currentUserId: currentUser.id,
    });
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return budgetAttachmentErrorResponse(error);
  }
}
