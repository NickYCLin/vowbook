import "server-only";
import { GuestInvitationValidationError } from "@/domain/guest-invitations";
import { getApiCurrentUser } from "@/lib/api-current-user";
import { isSameOriginMutationRequest } from "@/lib/http-request-security";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { mobileError, mobileJSON, readMobileJSON } from "@/lib/mobile/http";
import { issueGuestInvitation, loadGuestInvitationManagement, revokeGuestInvitation, saveGuestInvitationSettings, saveGuestVenueMap } from "@/lib/guest-invitations";

export function guestInvitationError(error: unknown) {
  if (error instanceof GuestInvitationValidationError) return mobileJSON({ error: "VALIDATION", message: error.message }, 400);
  return mobileError(error);
}
export function guestInvitationToken(request: Request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new MobileRequestError(404, "INVITATION_UNAVAILABLE", "邀請連結無效、已到期或已撤銷，請聯絡主辦方。");
  return match[1];
}
export async function guestInvitationWebUser(request: Request) {
  if (request.method !== "GET" && !isSameOriginMutationRequest(request)) throw new MobileRequestError(403, "ORIGIN", "拒絕跨來源請求。");
  const user = await getApiCurrentUser();
  if (!user) throw new MobileRequestError(401, "UNAUTHORIZED", "請先登入後再試。");
  return user;
}
export async function manageGuestInvitations(request: Request, workspaceId: string, userId: string) {
  if (request.method === "GET") return mobileJSON(await loadGuestInvitationManagement(workspaceId, userId));
  const body = await readMobileJSON(request, 16384);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new MobileRequestError(400, "VALIDATION", "邀請管理格式有誤。");
  const { operation, ...input } = body as Record<string, unknown>;
  if (operation === "settings") return mobileJSON(await saveGuestInvitationSettings(workspaceId, userId, input));
  if (operation === "issue") return mobileJSON(await issueGuestInvitation(workspaceId, userId, input));
  if (operation === "revoke") return mobileJSON(await revokeGuestInvitation(workspaceId, userId, input));
  throw new MobileRequestError(400, "VALIDATION", "請選擇有效的邀請操作。");
}
export async function uploadGuestVenueMap(request: Request, workspaceId: string, userId: string) {
  const rawVersion = new URL(request.url).searchParams.get("version");
  if (rawVersion === null || !/^(0|[1-9]\d{0,9})$/.test(rawVersion)) throw new MobileRequestError(400, "VALIDATION", "請重新載入會館設定。");
  const expectedVersion = Number(rawVersion);
  if (request.method === "DELETE") return mobileJSON(await saveGuestVenueMap(workspaceId, userId, expectedVersion, null));
  const reader = request.body?.getReader();
  if (!reader) throw new MobileRequestError(400, "VALIDATION", "請選擇圖片。");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new MobileRequestError(413, "TOO_LARGE", "圖片超過 3 MiB 上限。"); }
      parts.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bounded = new Request(request.url, { method: "POST", headers: request.headers, body: Buffer.concat(parts) });
  let form: FormData;
  try { form = await bounded.formData(); } catch { throw new MobileRequestError(400, "VALIDATION", "圖片格式有誤。"); }
  const file = form.get("file");
  if (!(file instanceof File) || [...form.keys()].some((key) => key !== "file") || form.getAll("file").length !== 1) throw new MobileRequestError(400, "VALIDATION", "請選擇一張圖片。");
  return mobileJSON(await saveGuestVenueMap(workspaceId, userId, expectedVersion, new Uint8Array(await file.arrayBuffer())));
}
