import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { scenarioBody, scenarioFailure } from "@/lib/mobile/seating-scenarios";
import { createSeatingScenarioFromLive, loadSeatingScenarioList } from "@/lib/seating-scenarios";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const list = await loadSeatingScenarioList(workspaceId, user.id).catch((error) => scenarioFailure(error, "read"));
    return mobileJSON({ canEdit: list.canEdit, drafts: list.drafts, backups: list.backups });
  } catch (error) {
    return mobileError(error);
  }
}

/** 複製目前的正式安排成一份新方案。 */
export async function POST(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const fields = scenarioBody(await readMobileJSON(request), ["name"]);
    const scenario = await createSeatingScenarioFromLive(workspaceId, user.id, fields.name).catch((error) =>
      scenarioFailure(error),
    );
    return mobileJSON({ scenario: { id: scenario.id } }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
