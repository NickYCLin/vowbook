import {
  MAX_PROFILE_AVATAR_UPLOAD_BYTES,
  ProfileAvatarValidationError,
} from "@/domain/profile-avatar";
import { getApiCurrentUser } from "@/lib/api-current-user";
import {
  hasBoundedContentLength,
  isSameOriginMutationRequest,
} from "@/lib/http-request-security";
import {
  readProfileAvatar,
  removeProfileAvatar,
  saveProfileAvatar,
} from "@/lib/profile-avatar";

export const runtime = "nodejs";

const MAX_MULTIPART_REQUEST_BYTES =
  MAX_PROFILE_AVATAR_UPLOAD_BYTES + 1024 * 1024;

const SAFE_HEADERS = {
  "cache-control": "private, no-store",
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function avatarJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: SAFE_HEADERS });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const currentUser = await getApiCurrentUser();
    if (!currentUser) return avatarJson({ error: "請先登入後再試。" }, 401);

    const avatar = await readProfileAvatar(currentUser.id);
    if (!avatar) return avatarJson({ error: "尚未設定自訂頭像。" }, 404);

    const etag = `"${avatar.sha256}"`;
    const responseHeaders = {
      ...SAFE_HEADERS,
      "cache-control": "private, max-age=0, must-revalidate",
      "content-length": String(avatar.byteSize),
      "content-type": avatar.mediaType,
      etag,
    };
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: responseHeaders });
    }

    return new Response(Buffer.from(avatar.data), {
      status: 200,
      headers: responseHeaders,
    });
  } catch {
    return avatarJson({ error: "目前無法載入頭像，請稍後再試。" }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutationRequest(request)) {
    return avatarJson({ error: "拒絕跨來源請求。" }, 403);
  }

  const currentUser = await getApiCurrentUser();
  if (!currentUser) return avatarJson({ error: "請先登入後再試。" }, 401);
  if (!hasBoundedContentLength(request, MAX_MULTIPART_REQUEST_BYTES)) {
    return avatarJson(
      { error: "上傳內容缺少有效大小，或已超過 5 MiB 頭像上限。" },
      413,
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (
      typeof file !== "object" ||
      file === null ||
      !("type" in file) ||
      typeof file.type !== "string" ||
      !("arrayBuffer" in file) ||
      typeof file.arrayBuffer !== "function"
    ) {
      return avatarJson({ error: "請選擇一張有效的頭像圖片。" }, 400);
    }

    const result = await saveProfileAvatar({
      currentUserId: currentUser.id,
      data: new Uint8Array(await file.arrayBuffer()),
      mediaType: file.type,
    });
    return avatarJson(result, 201);
  } catch (error) {
    if (error instanceof ProfileAvatarValidationError) {
      return avatarJson({ error: error.message }, 400);
    }
    return avatarJson({ error: "目前無法更新頭像，請稍後再試。" }, 500);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOriginMutationRequest(request)) {
    return avatarJson({ error: "拒絕跨來源請求。" }, 403);
  }

  try {
    const currentUser = await getApiCurrentUser();
    if (!currentUser) return avatarJson({ error: "請先登入後再試。" }, 401);

    const removed = await removeProfileAvatar(currentUser.id);
    return avatarJson({ removed }, 200);
  } catch {
    return avatarJson({ error: "目前無法移除頭像，請稍後再試。" }, 500);
  }
}
