import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { mobileCreateSeatingTable, TABLE_FIELDS, tableBody } from "@/lib/mobile/seating-tables";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const fields = tableBody(await readMobileJSON(request), TABLE_FIELDS);
    return mobileJSON({ table: await mobileCreateSeatingTable(workspaceId, user.id, fields) }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
