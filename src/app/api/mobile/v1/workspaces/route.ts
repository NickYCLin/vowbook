import { revalidatePath } from "next/cache";
import { requireMobileUser } from "@/lib/mobile/session";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { listWorkspaceOverviewsForUser } from "@/lib/workspace-overview";
import { normalizeWorkspaceDetails } from "@/domain/workspace";
import { createWorkspaceForUser } from "@/lib/create-workspace";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireMobileUser(request);
    const workspaces = await listWorkspaceOverviewsForUser(user.id);
    return mobileJSON({ workspaces });
  } catch (error) { return mobileError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireMobileUser(request);
    const body = await readMobileJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["name", "weddingDate", "timezone"].includes(key))) {
      throw new MobileRequestError(400, "INVALID_REQUEST", "婚宴輸入格式有誤。");
    }
    const fields = body as Record<string, unknown>;
    const details = normalizeWorkspaceDetails({ name: fields.name, weddingDate: fields.weddingDate ?? null, timezone: fields.timezone ?? null });
    const workspace = await createWorkspaceForUser(user.id, details);
    // A cache invalidation failure must not turn a committed create into a retry.
    try { revalidatePath("/dashboard"); revalidatePath("/onboarding"); } catch { /* Next dynamic pages read fresh data. */ }
    return mobileJSON({ id: workspace.id }, 201);
  } catch (error) { return mobileError(error); }
}
