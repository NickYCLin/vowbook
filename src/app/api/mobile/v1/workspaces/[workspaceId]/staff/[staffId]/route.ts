import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileSetRedEnvelopeSent } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string; staffId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, staffId } = await context.params;
    const body = await readMobileJSON(request);
    // 發放時間由伺服器決定，client 只能送「已發／未發」，不接受其他欄位。
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["redEnvelopeSent", "expectedVersion"].includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "紅包狀態輸入格式有誤。");
    }
    const fields = body as Record<string, unknown>;
    const staff = await mobileSetRedEnvelopeSent(
      workspaceId, user.id, staffId, fields.redEnvelopeSent, fields.expectedVersion,
    );
    return mobileJSON({ staff });
  } catch (error) {
    return mobileError(error);
  }
}
