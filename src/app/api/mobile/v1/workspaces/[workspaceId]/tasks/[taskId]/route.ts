import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  mobileDeleteTask,
  mobileSetTaskStatus,
  mobileUpdateTask,
} from "@/lib/mobile/workspace-data";

export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; taskId: string }> };

const STATUS_FIELDS = ["status", "expectedVersion"];
const DETAIL_FIELDS = ["title", "description", "dueDate", "side", "expectedVersion"];

function objectBody(body: unknown, allowed: string[], message: string) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", message);
  }
  return body as Record<string, unknown>;
}

/** 只帶 status 是勾完成；帶 title 是改內容。兩種不混在同一次送出。 */
export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, taskId } = await context.params;
    const body = await readMobileJSON(request);
    const isStatus = !!body && typeof body === "object" && "status" in body;
    if (isStatus) {
      const fields = objectBody(body, STATUS_FIELDS, "任務狀態輸入格式有誤。");
      const task = await mobileSetTaskStatus(
        workspaceId, user.id, taskId, fields.status, fields.expectedVersion,
      );
      return mobileJSON({ task });
    }
    const fields = objectBody(body, DETAIL_FIELDS, "任務內容輸入格式有誤。");
    const task = await mobileUpdateTask(workspaceId, user.id, taskId, fields);
    return mobileJSON({ task });
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireMobileUser(request);
    const { workspaceId, taskId } = await context.params;
    const fields = objectBody(await readMobileJSON(request), ["expectedVersion"], "刪除任務的輸入格式有誤。");
    return mobileJSON(await mobileDeleteTask(workspaceId, user.id, taskId, fields.expectedVersion));
  } catch (error) {
    return mobileError(error);
  }
}
