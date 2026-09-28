import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileCancelCheckIn, mobileCheckInGuest } from "@/lib/mobile/check-in";

export const runtime = "nodejs";

function fields(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "報到輸入格式有誤。");
  }
  const record = body as Record<string, unknown>;
  // workspaceId、guestId 與身分一律以路徑和已驗證的使用者為準，不接受 client 覆寫。
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "報到輸入格式有誤。");
  }
  return record;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; guestId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, guestId } = await context.params;
    const body = fields(await readMobileJSON(request), ["headcount", "notes"]);
    const checkIn = await mobileCheckInGuest(workspaceId, user.id, guestId, {
      headcount: body.headcount,
      notes: body.notes ?? null,
    });
    return mobileJSON({ checkIn }, 201);
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; guestId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const body = fields(await readMobileJSON(request), ["checkInId", "expectedVersion"]);
    const checkInId = body.checkInId;
    const expectedVersion = body.expectedVersion;
    if (typeof checkInId !== "string" || !checkInId ||
        typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "報到版本資訊無效，請重新整理後再試。");
    }
    await mobileCancelCheckIn(workspaceId, user.id, checkInId, expectedVersion);
    return mobileJSON({ cancelled: true });
  } catch (error) {
    return mobileError(error);
  }
}
