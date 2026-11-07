import { readProfileAvatar } from "@/lib/profile-avatar";
import { getApiCurrentUser } from "@/lib/api-current-user";
import { requireSystemAdmin, SystemAdminAccessDeniedError } from "@/lib/system-admin";

export const runtime = "nodejs";

const headers = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    if (!await getApiCurrentUser()) return new Response(null, { status: 401, headers });
    await requireSystemAdmin();
    const { userId } = await params;
    const avatar = await readProfileAvatar(userId);
    if (!avatar) return new Response(null, { status: 404, headers });
    return new Response(Buffer.from(avatar.data), {
      headers: { ...headers, "content-type": avatar.mediaType, "content-length": String(avatar.byteSize) },
    });
  } catch (error) {
    if (error instanceof SystemAdminAccessDeniedError) {
      return new Response(null, { status: 404, headers });
    }
    return new Response(null, { status: 500, headers });
  }
}
