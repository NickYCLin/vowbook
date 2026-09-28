import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileRecordGift, mobileUpdateGift } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

function fields(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "禮金輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; guestId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, guestId } = await context.params;
    const body = fields(await readMobileJSON(request), ["amount", "notes"]);
    const gift = await mobileRecordGift(workspaceId, user.id, guestId, {
      amount: body.amount,
      notes: body.notes ?? null,
    });
    return mobileJSON({ gift }, 201);
  } catch (error) {
    return mobileError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; guestId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const body = fields(await readMobileJSON(request), ["giftId", "amount", "notes", "expectedVersion"]);
    if (typeof body.giftId !== "string" || !body.giftId) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "禮金輸入格式有誤。");
    }
    const gift = await mobileUpdateGift(
      workspaceId, user.id, body.giftId,
      { amount: body.amount, notes: body.notes ?? null },
      body.expectedVersion,
    );
    return mobileJSON({ gift });
  } catch (error) {
    return mobileError(error);
  }
}
