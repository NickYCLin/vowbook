import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { mobileUpdateSeatingTable, TABLE_FIELDS, tableBody } from "@/lib/mobile/seating-tables";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; tableId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, tableId } = await context.params;
    const fields = tableBody(await readMobileJSON(request), [...TABLE_FIELDS, "expectedVersion"]);
    return mobileJSON({ table: await mobileUpdateSeatingTable(workspaceId, user.id, tableId, fields) });
  } catch (error) {
    return mobileError(error);
  }
}
