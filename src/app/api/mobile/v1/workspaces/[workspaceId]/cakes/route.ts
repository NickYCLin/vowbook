import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileCreateCakeHousehold, mobileWeddingCakes } from "@/lib/mobile/wedding-cakes";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileWeddingCakes(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}

/** 新增同一家人；workspace 與身分只看路徑和登入憑證。 */
export async function POST(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const body = await readMobileJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["name", "boxes", "guests"].includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
    }
    return mobileJSON(await mobileCreateCakeHousehold(workspaceId, user.id, body as Record<string, unknown>));
  } catch (error) {
    return mobileError(error);
  }
}
