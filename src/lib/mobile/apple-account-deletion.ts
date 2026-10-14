import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { normalizeInvitationEmail } from "@/domain/workspace-invitation";
import { deleteOwnAccount, previewAccountDeletion } from "@/lib/account-deletion";
import { prisma } from "@/lib/prisma";
import { APPLE_AUDIENCE, verifyAppleIdentity } from "./apple-sign-in";
import { digest, MobileRequestError } from "./protocol";

type DeletionInput = { confirmationEmail?: unknown; identityToken?: unknown; authorizationCode?: unknown; nonce?: unknown };
type Dependencies = { exchange: (code: string, nonce: string, subject: string) => Promise<string>; revoke: (token: string) => Promise<void>; secret: string };
const reauthenticate = () => new MobileRequestError(409, "REAUTHENTICATE", "請重新確認原本的 Apple 帳號，帳號資料仍保留。");
const conflict = () => new MobileRequestError(409, "CONFLICT", "刪帳確認正在處理，請稍後重試。");
const unavailable = () => new MobileRequestError(409, "APPLE_UNAVAILABLE", "Apple 撤銷尚未完成，帳號資料仍保留。請稍後重試。");
const configuration = () => new MobileRequestError(409, "APPLE_CONFIGURATION", "Apple 刪帳服務尚未設定完成，帳號資料仍保留。請聯絡支援。");
const keyFor = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "vowbook", "apple-account-deletion-v1", 32));

export function sealAppleDeletionToken(token: string, userId: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function openAppleDeletionToken(sealed: string, userId: string, secret: string) {
  const parts = sealed.split(".");
  if (parts.length !== 3) throw unavailable();
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), iv);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function isConfigured() {
  return [process.env.APPLE_SIGN_IN_TEAM_ID, process.env.APPLE_SIGN_IN_KEY_ID,
    process.env.APPLE_SIGN_IN_PRIVATE_KEY, process.env.AUTH_SECRET].every((value) => !!value);
}

async function clientSecret() {
  if (!isConfigured()) throw configuration();
  const key = await importPKCS8(process.env.APPLE_SIGN_IN_PRIVATE_KEY!, "ES256");
  return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_SIGN_IN_KEY_ID! })
    .setIssuer(process.env.APPLE_SIGN_IN_TEAM_ID!).setSubject(APPLE_AUDIENCE)
    .setAudience("https://appleid.apple.com").setIssuedAt().setExpirationTime("5m").sign(key);
}

async function appleRequest(path: "token" | "revoke", values: Record<string, string>) {
  const response = await fetch(`https://appleid.apple.com/auth/${path}`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: APPLE_AUDIENCE, client_secret: await clientSecret(), ...values }),
  });
  if (!response.ok) throw unavailable();
  return response;
}

async function exchange(code: string, nonce: string, subject: string) {
  const response = await appleRequest("token", { grant_type: "authorization_code", code });
  const body = await response.json() as Record<string, unknown>;
  if (typeof body.id_token !== "string" || typeof body.refresh_token !== "string" ||
      !body.refresh_token || body.refresh_token.length > 4096) throw unavailable();
  const identity = await verifyAppleIdentity(body.id_token, nonce);
  if (identity.subject !== subject) throw reauthenticate();
  return body.refresh_token;
}

async function revoke(token: string) {
  await appleRequest("revoke", { token, token_type_hint: "refresh_token" });
}

export async function prepareAppleAccountDeletion(userId: string, configured = isConfigured()) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.appleSubject) throw reauthenticate();
  if (user.appleDeletionRevokedAt) return { nonce: null, resume: true };
  if (!configured) throw configuration();
  if (user.appleDeletionToken || user.appleDeletionRevokedAt) return { nonce: null, resume: true };
  const nonce = randomBytes(32).toString("base64url");
  const saved = await prisma.user.updateMany({
    where: { id: userId, accessStatus: "ACTIVE", appleDeletionToken: null, appleDeletionRevokedAt: null,
      OR: [{ appleDeletionLeaseUntil: null }, { appleDeletionLeaseUntil: { lte: new Date() } }] },
    data: { appleDeletionNonceHash: digest(nonce), appleDeletionExpiresAt: new Date(Date.now() + 300_000) },
  });
  if (saved.count !== 1) throw conflict();
  return { nonce, resume: false };
}

export async function deleteAppleAccount(userId: string, input: DeletionInput, dependencies?: Dependencies) {
  const preview = await previewAccountDeletion(userId);
  let email: string;
  try { email = normalizeInvitationEmail(input.confirmationEmail); }
  catch { throw new MobileRequestError(400, "CONFIRMATION", "請輸入登入 Email。"); }
  if (email !== normalizeInvitationEmail(preview.email)) {
    throw new MobileRequestError(400, "CONFIRMATION", "請輸入登入 Email。");
  }
  if (preview.blocked.length) throw new MobileRequestError(409, "BLOCKED", "請先處理共享婚宴的協作者，再重新確認刪帳。");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.appleSubject) throw reauthenticate();
  if (user.appleDeletionRevokedAt) return deleteOwnAccount(userId, email);
  if (!dependencies && !isConfigured()) throw configuration();
  const deps = dependencies ?? { exchange, revoke, secret: process.env.AUTH_SECRET! };
  if (!user.appleDeletionToken) {
    if (typeof input.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.nonce) ||
        digest(input.nonce) !== user.appleDeletionNonceHash ||
        !user.appleDeletionExpiresAt || user.appleDeletionExpiresAt.getTime() <= Date.now() ||
        typeof input.identityToken !== "string" || input.identityToken.length > 3000 ||
        typeof input.authorizationCode !== "string" || !input.authorizationCode || input.authorizationCode.length > 1024) throw reauthenticate();
    const identity = await verifyAppleIdentity(input.identityToken, input.nonce).catch(() => { throw reauthenticate(); });
    if (identity.subject !== user.appleSubject) throw reauthenticate();
  }
  const leaseUntil = new Date(Date.now() + 60_000);
  const claim = await prisma.user.updateMany({
    where: { id: userId, accessStatus: "ACTIVE", appleDeletionRevokedAt: null,
      appleDeletionNonceHash: user.appleDeletionNonceHash, appleDeletionToken: user.appleDeletionToken,
      OR: [{ appleDeletionLeaseUntil: null }, { appleDeletionLeaseUntil: { lte: new Date() } }] },
    data: { appleDeletionLeaseUntil: leaseUntil },
  });
  if (claim.count !== 1) throw conflict();
  const lease = { id: userId, appleDeletionLeaseUntil: leaseUntil };
  try {
    let token: string;
    if (user.appleDeletionToken) token = openAppleDeletionToken(user.appleDeletionToken, userId, deps.secret);
    else {
      token = await deps.exchange(input.authorizationCode as string, input.nonce as string, user.appleSubject);
      try {
        const saved = await prisma.user.updateMany({ where: lease,
          data: { appleDeletionToken: sealAppleDeletionToken(token, userId, deps.secret) } });
        if (saved.count !== 1) throw conflict();
      } catch {
        await deps.revoke(token).catch(() => undefined);
        throw unavailable();
      }
    }
    await deps.revoke(token);
    const saved = await prisma.user.updateMany({ where: lease,
      data: { appleDeletionRevokedAt: new Date(), appleDeletionToken: null } });
    if (saved.count !== 1) throw conflict();
  } catch (error) {
    if (error instanceof MobileRequestError) throw error;
    throw unavailable();
  } finally {
    await prisma.user.updateMany({ where: lease, data: { appleDeletionLeaseUntil: null } });
  }
  return deleteOwnAccount(userId, email);
}
