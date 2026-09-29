import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import {
  mobileDeleteSeatingTable,
  mobileUpdateSeatingTable,
  TABLE_FIELDS,
  tableBody,
} from "@/lib/mobile/seating-tables";

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

/** 只刪空桌，所以 body 只收版本，避免誤刪還有人坐的桌次。 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; tableId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, tableId } = await context.params;
    const fields = tableBody(await readMobileJSON(request), ["expectedVersion"]);
    return mobileJSON(await mobileDeleteSeatingTable(workspaceId, user.id, tableId, fields));
  } catch (error) {
    return mobileError(error);
  }
}
