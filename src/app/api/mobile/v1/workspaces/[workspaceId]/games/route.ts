import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileAddGameParticipants } from "@/lib/mobile/wedding-games";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const body = await readMobileJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["game", "names"].includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "名單輸入格式有誤。");
    }
    const fields = body as Record<string, unknown>;
    const result = await mobileAddGameParticipants(workspaceId, user.id, fields.game, fields.names);
    return mobileJSON(result, 201);
  } catch (error) {
    return mobileError(error);
  }
}
