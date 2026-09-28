import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { scenarioBody, scenarioFailure, scenarioVersion } from "@/lib/mobile/seating-scenarios";
import { removeScenarioTable, updateScenarioTable } from "@/lib/seating-scenarios";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; scenarioId: string; tableId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, scenarioId, tableId } = await context.params;
    const fields = scenarioBody(await readMobileJSON(request), ["name", "capacity", "notes", "expectedVersion"]);
    const version = scenarioVersion(fields.expectedVersion);
    await updateScenarioTable(
      workspaceId, user.id, scenarioId, tableId,
      { name: fields.name, capacity: fields.capacity, notes: fields.notes }, version,
    ).catch((error) => scenarioFailure(error));
    return mobileJSON({ ok: true });
  } catch (error) {
    return mobileError(error);
  }
}

/** 只從方案拿掉這桌，那桌的人回到未入座；正式安排不受影響。 */
export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, scenarioId, tableId } = await context.params;
    const fields = scenarioBody(await readMobileJSON(request), ["expectedVersion"]);
    const version = scenarioVersion(fields.expectedVersion);
    await removeScenarioTable(workspaceId, user.id, scenarioId, tableId, version).catch((error) =>
      scenarioFailure(error),
    );
    return mobileJSON({ ok: true });
  } catch (error) {
    return mobileError(error);
  }
}
