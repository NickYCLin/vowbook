import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileSetRedEnvelopeSent } from "@/lib/mobile/workspace-data";
import { mobileUpdateStaff, mobileDeleteStaff } from "@/lib/mobile/wedding-staff";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ workspaceId: string; staffId: string }> }) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, staffId } = await context.params;
    return mobileJSON({ staff: await mobileUpdateStaff(workspaceId, user.id, staffId, await readMobileJSON(request)) });
  } catch (error) { return mobileError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ workspaceId: string; staffId: string }> }) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, staffId } = await context.params;
    return mobileJSON(await mobileDeleteStaff(workspaceId, user.id, staffId, await readMobileJSON(request)));
  } catch (error) { return mobileError(error); }
}

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
