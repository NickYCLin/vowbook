import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileDissolveCakeHousehold, mobileUpdateCakeHousehold } from "@/lib/mobile/wedding-cakes";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; householdId: string }> };

async function fields(request: Request, allowed: string[]) {
  const body = await readMobileJSON(request);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, householdId } = await context.params;
    const body = await fields(request, ["name", "boxes", "guests", "expectedVersion", "expectedMembers"]);
    return mobileJSON(await mobileUpdateCakeHousehold(workspaceId, user.id, householdId, body));
  } catch (error) {
    return mobileError(error);
  }
}

/** 解散家庭，成員恢復每筆名單一盒。 */
export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, householdId } = await context.params;
    const body = await fields(request, ["expectedVersion", "expectedMembers"]);
    return mobileJSON(await mobileDissolveCakeHousehold(workspaceId, user.id, householdId, body));
  } catch (error) {
    return mobileError(error);
  }
}
