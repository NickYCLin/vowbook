import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { scenarioBody, scenarioFailure, scenarioVersion } from "@/lib/mobile/seating-scenarios";
import { addScenarioTable } from "@/lib/seating-scenarios";

export const runtime = "nodejs";

/** 在方案裡加開一桌，排在最後面。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; scenarioId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, scenarioId } = await context.params;
    const fields = scenarioBody(await readMobileJSON(request), ["name", "capacity", "notes", "expectedVersion"]);
    const version = scenarioVersion(fields.expectedVersion);
    await addScenarioTable(
      workspaceId, user.id, scenarioId,
      { name: fields.name, capacity: fields.capacity, notes: fields.notes }, version,
    ).catch((error) => scenarioFailure(error));
    return mobileJSON({ ok: true }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
