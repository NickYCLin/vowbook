import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileCreateTask, mobileTaskList } from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

const TASK_FIELDS = ["title", "description", "dueDate", "side"];

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    return mobileJSON(await mobileTaskList(workspaceId, user.id));
  } catch (error) {
    return mobileError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId } = await context.params;
    const body = await readMobileJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !TASK_FIELDS.includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "任務資料格式有誤。");
    }
    const task = await mobileCreateTask(workspaceId, user.id, body as Record<string, unknown>);
    return mobileJSON({ task }, 201);
  } catch (error) {
    return mobileError(error);
  }
}
