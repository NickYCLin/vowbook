import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { scenarioBody, scenarioFailure, scenarioId, scenarioVersion } from "@/lib/mobile/seating-scenarios";
import { seatGuestInScenario } from "@/lib/seating-scenarios";

export const runtime = "nodejs";

/** 在方案裡換桌；tableId 為 null 代表這個方案裡先不入座。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; scenarioId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, scenarioId: id } = await context.params;
    const fields = scenarioBody(await readMobileJSON(request), ["guestId", "tableId", "expectedVersion"]);
    const guestId = scenarioId(fields.guestId)!;
    const tableId = scenarioId(fields.tableId, true);
    const version = scenarioVersion(fields.expectedVersion);
    await seatGuestInScenario(workspaceId, user.id, id, guestId, tableId, version).catch((error) =>
      scenarioFailure(error),
    );
    return mobileJSON({ ok: true });
  } catch (error) {
    return mobileError(error);
  }
}
