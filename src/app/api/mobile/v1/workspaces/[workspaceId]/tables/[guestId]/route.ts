import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileAssignGuestToTable } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

const ALLOWED = ["tableId", "expectedVersion", "expectedTableId"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; guestId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, guestId } = await context.params;
    const body = await readMobileJSON(request);
    // 賓客與婚宴一律以路徑和已驗證的使用者為準，不接受 client 覆寫。
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !ALLOWED.includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "桌次輸入格式有誤。");
    }
    const fields = body as Record<string, unknown>;
    const seating = await mobileAssignGuestToTable(workspaceId, user.id, guestId, {
      tableId: "tableId" in fields ? fields.tableId : null,
      expectedVersion: fields.expectedVersion,
      expectedTableId: "expectedTableId" in fields ? fields.expectedTableId : null,
    });
    return mobileJSON({ seating });
  } catch (error) {
    return mobileError(error);
  }
}
