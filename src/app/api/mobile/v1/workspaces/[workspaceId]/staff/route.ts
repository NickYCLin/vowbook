import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { mobileCreateStaff } from "@/lib/mobile/wedding-staff";
import { mobileStaffList } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON({ staff: await mobileCreateStaff(workspaceId, user.id, await readMobileJSON(request)) }, 201);
  } catch (error) { return mobileError(error); }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileStaffList(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}
