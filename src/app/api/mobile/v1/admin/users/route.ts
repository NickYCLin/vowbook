import { mobileSystemUsers } from "@/lib/mobile/admin-users";
import { mobileError, mobileJSON } from "@/lib/mobile/http";
import { requireMobileUser } from "@/lib/mobile/session";

export const runtime = "nodejs";

/** 系統管理者才看得到全站帳號；管理者身分一律由伺服器判定。 */
export async function GET(request: Request) {
  try {
    const user = await requireMobileUser(request);
    return mobileJSON(await mobileSystemUsers(user));
  } catch (error) {
    return mobileError(error);
  }
}
