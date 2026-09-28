import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileSetGuestAttendance, mobileUpdateGuest } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

const ATTENDANCE_FIELDS = ["attendanceStatus", "expectedVersion"];
const DETAIL_FIELDS = ["name", "side", "attendanceStatus", "partySize", "notes", "expectedVersion"];

function objectBody(body: unknown, allowed: string[], message: string) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", message);
  }
  return body as Record<string, unknown>;
}

/** 帶 name 是改整筆資料；只帶出席狀態是名單上的快速切換。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; guestId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, guestId } = await context.params;
    const body = await readMobileJSON(request);
    // workspaceId、guestId 與身分只認路徑與已驗證的使用者。
    if (body && typeof body === "object" && "name" in body) {
      const fields = objectBody(body, DETAIL_FIELDS, "賓客資料格式有誤。");
      const guest = await mobileUpdateGuest(workspaceId, user.id, guestId, fields);
      return mobileJSON({ guest });
    }
    const fields = objectBody(body, ATTENDANCE_FIELDS, "出席狀態輸入格式有誤。");
    const guest = await mobileSetGuestAttendance(
      workspaceId, user.id, guestId, fields.attendanceStatus, fields.expectedVersion,
    );
    return mobileJSON({ guest });
  } catch (error) {
    return mobileError(error);
  }
}
