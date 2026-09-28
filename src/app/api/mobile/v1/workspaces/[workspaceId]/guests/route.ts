import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileCreateGuest, mobileGuestList } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

const GUEST_FIELDS = ["name", "category", "seniority", "side", "attendanceStatus", "partySize", "notes"];

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileGuestList(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const body = await readMobileJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !GUEST_FIELDS.includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "賓客資料格式有誤。");
    }
    const guest = await mobileCreateGuest(workspaceId, user.id, body as Record<string, unknown>);
    return mobileJSON({ guest }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
