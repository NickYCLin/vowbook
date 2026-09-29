import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import {
  deleteBody,
  mobileDeleteWorkspace,
  mobileUpdateWorkspaceSettings,
  mobileWorkspaceSettings,
  settingsBody,
} from "@/lib/mobile/workspace-settings";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileWorkspaceSettings(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const fields = settingsBody(await readMobileJSON(request));
    return mobileJSON({ settings: await mobileUpdateWorkspaceSettings(workspaceId, user.id, fields) });
  } catch (error) {
    return mobileError(error);
  }
}

/** 刪整場婚宴。workspaceId 與身分只認路徑與已驗證的使用者。 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const fields = deleteBody(await readMobileJSON(request));
    return mobileJSON(await mobileDeleteWorkspace(workspaceId, user.id, fields));
  } catch (error) {
    return mobileError(error);
  }
}
