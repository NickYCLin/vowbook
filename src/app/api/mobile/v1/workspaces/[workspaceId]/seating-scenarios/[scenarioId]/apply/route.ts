import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import {
  liveFingerprint,
  scenarioBody,
  scenarioFailure,
  scenarioVersion,
} from "@/lib/mobile/seating-scenarios";
import { applySeatingScenario } from "@/lib/seating-scenarios";

export const runtime = "nodejs";

/**
 * 套用為正式安排。手機要帶回看差異時拿到的正式安排指紋，對不上就擋下，
 * 確保套用的就是剛剛確認過的那份差異；伺服器會先自動備份目前的安排。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; scenarioId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, scenarioId } = await context.params;
    const fields = scenarioBody(await readMobileJSON(request), ["expectedVersion", "expectedLiveFingerprint"]);
    const version = scenarioVersion(fields.expectedVersion);
    const fingerprint = liveFingerprint(fields.expectedLiveFingerprint);
    const result = await applySeatingScenario(workspaceId, user.id, scenarioId, version, fingerprint).catch(
      (error) => scenarioFailure(error),
    );
    return mobileJSON({ result });
  } catch (error) {
    return mobileError(error);
  }
}
