import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { normalizeInvitationEmail } from "@/domain/workspace-invitation";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { digest, MobileRequestError } from "./protocol";

/** App 的 bundle ID；Apple 簽發的 identity token 的 aud 必須是它。 */
export const APPLE_AUDIENCE = "com.vowbook.ios";
const APPLE_ISSUER = "https://appleid.apple.com";
// 對外連線偶爾會慢，預設 5 秒不夠就會把正常的登入判成失敗。
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"), {
  timeoutDuration: 10_000,
});

const rejected = () => new MobileRequestError(401, "UNAUTHORIZED", "無法確認 Apple 登入，請再試一次。");

export type AppleIdentity = { subject: string; email: string | null; emailVerified: boolean };

type Verify = (token: string) => Promise<JWTPayload>;
const verifyWithApple: Verify = async (token) =>
  (await jwtVerify(token, appleKeys, { issuer: APPLE_ISSUER, audience: APPLE_AUDIENCE, maxTokenAge: "10m" })).payload;

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** 驗 Apple 簽章、發行者、對象與 nonce；nonce 防止別人拿攔到的 token 來換登入。 */
export async function verifyAppleIdentity(token: string, rawNonce: string, verify: Verify = verifyWithApple) {
  let payload: JWTPayload;
  try {
    payload = await verify(token);
  } catch {
    throw rejected();
  }
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255) throw rejected();
  if (payload.nonce !== sha256Hex(rawNonce)) throw rejected();
  const verified = payload.email_verified === true || payload.email_verified === "true";
  let email: string | null = null;
  if (typeof payload.email === "string" && verified) {
    try { email = normalizeInvitationEmail(payload.email); } catch { email = null; }
  }
  return { subject: payload.sub, email, emailVerified: email !== null } satisfies AppleIdentity;
}

function parseBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["identityToken", "nonce", "name"].includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
  }
  const { identityToken, nonce, name } = body as Record<string, unknown>;
  if (typeof identityToken !== "string" || identityToken.length < 20 || identityToken.length > 3000) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
  }
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
  }
  if (name !== undefined && name !== null && (typeof name !== "string" || name.trim().length > 100)) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "輸入格式有誤。");
  }
  const trimmed = typeof name === "string" ? name.trim() : "";
  return { identityToken, nonce, name: trimmed || null };
}

/**
 * Apple 登入換 App 登入憑證。Apple 帳號是獨立帳號，不會依 Email 併到 Google 帳號；
 * Email 經 Apple 驗證時，才像 Google 一樣接受寄給這個 Email 的婚宴邀請。
 */
export async function signInWithApple(body: unknown, verify: Verify = verifyWithApple) {
  const input = parseBody(body);
  const identity = await verifyAppleIdentity(input.identityToken, input.nonce, verify);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

  await runSerializableTransaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { appleSubject: identity.subject } });
    if (existing && existing.accessStatus !== "ACTIVE") {
      throw new MobileRequestError(403, "BLOCKED", "這個帳號目前無法登入。");
    }
    // Apple 之後登入不會再給名字，只在第一次或原本沒有名字時寫入。
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            lastLoginAt: new Date(),
            ...(identity.email ? { email: identity.email } : {}),
            ...(!existing.name && input.name ? { name: input.name } : {}),
          },
        })
      : await tx.user.create({
          data: {
            appleSubject: identity.subject,
            // Apple 可能不給 Email；給一個不會收到信、也不會對到邀請的地址。
            email: identity.email ?? `apple-${sha256Hex(identity.subject).slice(0, 16)}@users.invalid`,
            name: input.name,
            lastLoginAt: new Date(),
          },
        });

    if (identity.email) {
      const invitations = await tx.$queryRaw<Array<{ workspace_id: string; role: "PARTNER" | "PLANNER" | "COORDINATOR" | "VIEWER" }>>`
        UPDATE "workspace_invitations"
        SET "status" = 'ACCEPTED'::"WorkspaceInvitationStatus",
            "accepted_by_user_id" = ${user.id},
            "accepted_at" = CURRENT_TIMESTAMP,
            "version" = "version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "email" = ${identity.email}
          AND "status" = 'PENDING'::"WorkspaceInvitationStatus"
          AND "superseded_by_invitation_id" IS NULL
          AND "created_at" <= CURRENT_TIMESTAMP
          AND "expires_at" > CURRENT_TIMESTAMP
        RETURNING "workspace_id", "role"
      `;
      if (invitations.length > 0) {
        await tx.membership.createMany({
          data: invitations.map((row) => ({ workspaceId: row.workspace_id, userId: user.id, role: row.role })),
          skipDuplicates: true,
        });
      }
    }

    await tx.mobileSession.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
    await tx.mobileSession.create({ data: { tokenHash: digest(token), userId: user.id, expiresAt } });
  }, prisma);

  return { token, expiresAt: expiresAt.toISOString() };
}
