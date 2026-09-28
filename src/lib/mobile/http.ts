import { WorkspaceAccessDeniedError, WorkspaceValidationError } from "@/domain/workspace";
import { MobileRequestError } from "./protocol";

export function mobileJSON(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

export function mobileError(error: unknown) {
  if (error instanceof MobileRequestError) return mobileJSON({ error: error.code, message: error.message }, error.status);
  if (error instanceof WorkspaceValidationError) return mobileJSON({ error: "VALIDATION", message: error.message }, 400);
  // 讀取頁面時被移出婚宴或邀請被撤銷，要講清楚，不能說成伺服器壞了。
  if (error instanceof WorkspaceAccessDeniedError) {
    return mobileJSON({ error: "FORBIDDEN", message: "你已經沒有這場婚宴的權限，請回到婚宴列表重新整理。" }, 403);
  }
  return mobileJSON({ error: "UNAVAILABLE", message: "服務暫時無法使用，請稍後再試。" }, 503);
}

export async function readMobileJSON(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MobileRequestError(415, "CONTENT_TYPE", "請使用 JSON 格式。");
  }
  // Stream limit applies even without a Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) throw new MobileRequestError(400, "INVALID_REQUEST", "缺少輸入內容。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw new MobileRequestError(413, "TOO_LARGE", "輸入內容過長。");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof MobileRequestError) throw error;
    throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
  } finally { reader.releaseLock(); }
}
