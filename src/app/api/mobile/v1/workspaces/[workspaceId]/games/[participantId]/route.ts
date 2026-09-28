import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  mobileDeleteGameParticipant,
  mobileUpdateGameParticipant,
} from "@/lib/mobile/wedding-games";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; participantId: string }> };

function fields(body: unknown, allowed: string[]): Record<string, unknown> {
  // workspaceId、participantId 與身分只看路徑和已驗證的使用者。
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "名單輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, participantId } = await context.params;
    const body = fields(await readMobileJSON(request), ["name", "note", "expectedVersion"]);
    const participant = await mobileUpdateGameParticipant(workspaceId, user.id, participantId, {
      name: body.name,
      note: body.note,
      expectedVersion: body.expectedVersion,
    });
    return mobileJSON({ participant });
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, participantId } = await context.params;
    const body = fields(await readMobileJSON(request), ["expectedVersion"]);
    return mobileJSON(
      await mobileDeleteGameParticipant(workspaceId, user.id, participantId, body.expectedVersion),
    );
  } catch (error) {
    return mobileError(error);
  }
}
