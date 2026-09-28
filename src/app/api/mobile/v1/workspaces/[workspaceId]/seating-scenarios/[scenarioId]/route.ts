import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { scenarioBody, scenarioFailure, scenarioVersion } from "@/lib/mobile/seating-scenarios";
import {
  deleteSeatingScenario,
  loadSeatingScenarioDetail,
  renameSeatingScenario,
} from "@/lib/seating-scenarios";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; scenarioId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, scenarioId } = await context.params;
    const detail = await loadSeatingScenarioDetail(workspaceId, user.id, scenarioId).catch((error) =>
      scenarioFailure(error, "read"),
    );
    return mobileJSON({
      canEdit: detail.canEdit,
      scenario: detail.scenario,
      tables: detail.tables,
      unseated: detail.unseated,
      assumptions: detail.assumptions,
      preview: detail.preview,
      liveFingerprint: detail.liveFingerprint,
    });
  } catch (error) {
    return mobileError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, scenarioId } = await context.params;
    const fields = scenarioBody(await readMobileJSON(request), ["name", "expectedVersion"]);
    const version = scenarioVersion(fields.expectedVersion);
    await renameSeatingScenario(workspaceId, user.id, scenarioId, fields.name, version).catch((error) =>
      scenarioFailure(error),
    );
    return mobileJSON({ ok: true });
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, scenarioId } = await context.params;
    const fields = scenarioBody(await readMobileJSON(request), ["expectedVersion"]);
    const version = scenarioVersion(fields.expectedVersion);
    await deleteSeatingScenario(workspaceId, user.id, scenarioId, version).catch((error) => scenarioFailure(error));
    return mobileJSON({ ok: true });
  } catch (error) {
    return mobileError(error);
  }
}
