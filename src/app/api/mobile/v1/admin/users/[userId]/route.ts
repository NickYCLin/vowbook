import {
  mobileDeleteSystemUser,
  mobileUpdateSystemUserAccess,
} from "@/lib/mobile/admin-users";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { requireMobileUser } from "@/lib/mobile/session";

export const runtime = "nodejs";

/** 停權、移除或恢復登入權限；不會動到婚宴資料。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { userId } = await context.params;
    const body = await readMobileJSON(request);
    return mobileJSON(await mobileUpdateSystemUserAccess(user, userId, body));
  } catch (error) {
    return mobileError(error);
  }
}

/** 連同他建立的婚宴一起永久刪除，所以要再輸入一次對方的 Email。 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { userId } = await context.params;
    const body = await readMobileJSON(request);
    return mobileJSON(await mobileDeleteSystemUser(user, userId, body));
  } catch (error) {
    return mobileError(error);
  }
}
