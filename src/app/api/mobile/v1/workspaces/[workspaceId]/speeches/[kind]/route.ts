import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileSaveWeddingSpeech } from "@/lib/mobile/wedding-timeline";

export const runtime = "nodejs";

/** 謝親恩整篇覆寫；kind 走路徑，內容空白等於清掉。 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ workspaceId: string; kind: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, kind } = await context.params;
    const body = await readMobileJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["content", "expectedVersion"].includes(key)) ||
        !("expectedVersion" in body)) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "致詞稿格式有誤。");
    }
    const fields = body as Record<string, unknown>;
    const speech = await mobileSaveWeddingSpeech(workspaceId, user.id, kind, fields.content, fields.expectedVersion);
    return mobileJSON({ speech });
  } catch (error) {
    return mobileError(error);
  }
}
