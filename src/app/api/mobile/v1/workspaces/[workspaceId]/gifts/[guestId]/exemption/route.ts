import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { GIFT_EXEMPTION_FIELDS, mobileSetGiftExemption } from "@/lib/mobile/gift-exemption";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; guestId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, guestId } = await context.params;
    const body = await readMobileJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !GIFT_EXEMPTION_FIELDS.includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "標記格式有誤。");
    }
    return mobileJSON({
      guest: await mobileSetGiftExemption(
        workspaceId, user.id, guestId, body as Record<string, unknown>),
    });
  } catch (error) {
    return mobileError(error);
  }
}
