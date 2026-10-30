import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction, SerializationConflictError } from "@/lib/serializable-transaction";
import { verifyAppleIdentity } from "./apple-sign-in";
import { digest, MobileRequestError } from "./protocol";

export type LinkProvider = "GOOGLE" | "APPLE";
export const ACCOUNT_LINK_COOKIE = "vowbook.account-link";
const invalid = () => new MobileRequestError(409, "LINK_EXPIRED", "連結確認已失效或帳號狀態已改變，請從設定重新開始。");
const occupied = () => new MobileRequestError(409, "IDENTITY_IN_USE", "這個登入方式已連結其他帳號，不會自動合併婚宴資料。");
const fieldFor = (provider: LinkProvider) => provider === "GOOGLE" ? "googleSubject" : "appleSubject";

export function validateLinkNonce(nonce: unknown): asserts nonce is string {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "連結要求格式有誤。");
  }
}

function available(user: User) {
  return user.accessStatus === "ACTIVE" && !user.appleDeletionToken && !user.appleDeletionRevokedAt &&
    (!user.appleDeletionLeaseUntil || user.appleDeletionLeaseUntil.getTime() <= Date.now());
}

async function transaction<Result>(operation: (tx: Prisma.TransactionClient) => Promise<Result>) {
  try { return await runSerializableTransaction(operation, prisma); }
  catch (error) {
    if (error instanceof SerializationConflictError) throw invalid();
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw occupied();
    throw error;
  }
}

async function pending(tx: Prisma.TransactionClient, nonce: unknown, userId?: string, sessionHash?: string) {
  validateLinkNonce(nonce);
  const challenge = await tx.accountLinkChallenge.findUnique({
    where: { tokenHash: digest(nonce) }, include: { user: true, session: true },
  });
  if (!challenge || challenge.expiresAt.getTime() <= Date.now() || !challenge.session ||
      challenge.session.expiresAt.getTime() <= Date.now() || challenge.session.userId !== challenge.userId ||
      !available(challenge.user) || (userId !== undefined && challenge.userId !== userId) ||
      (sessionHash !== undefined && challenge.sessionHash !== sessionHash)) throw invalid();
  return challenge;
}

export async function prepareAccountLink(userId: string, sessionHash: string, provider: LinkProvider) {
  if (provider !== "GOOGLE" && provider !== "APPLE") throw new MobileRequestError(400, "INVALID_REQUEST", "請選擇登入方式。");
  return transaction(async (tx) => {
    const session = await tx.mobileSession.findUnique({ where: { tokenHash: sessionHash }, include: { user: true } });
    if (!session || session.userId !== userId || session.expiresAt.getTime() <= Date.now() ||
        !available(session.user) || session.user[fieldFor(provider)]) throw invalid();
    const nonce = randomBytes(32).toString("base64url");
    await tx.accountLinkChallenge.deleteMany({ where: { userId } });
    await tx.accountLinkChallenge.create({ data: {
      tokenHash: digest(nonce), userId, sessionHash, provider, expiresAt: new Date(Date.now() + 300_000),
    } });
    return { nonce };
  });
}

export async function validateGoogleLinkStart(nonce: unknown) {
  return transaction(async (tx) => {
    const challenge = await pending(tx, nonce);
    if (challenge.provider !== "GOOGLE" || challenge.subject) throw invalid();
  });
}

export async function googleLinkCallback(nonce: unknown) {
  validateLinkNonce(nonce);
  await transaction(async (tx) => {
    const challenge = await pending(tx, nonce);
    if (challenge.provider !== "GOOGLE" || !challenge.subject) throw invalid();
  });
  return `vowbook://account-link/callback?${new URLSearchParams({ nonce })}`;
}

async function stage(tx: Prisma.TransactionClient, tokenHash: string, subject: string, email: string | null) {
  const result = await tx.accountLinkChallenge.updateMany({
    where: { tokenHash, subject: null, expiresAt: { gt: new Date() } }, data: { subject, email },
  });
  if (result.count !== 1) throw invalid();
}

export async function stageGoogleAccountLink(nonce: unknown, subject: string, email: string) {
  if (!subject || subject.length > 255 || !email || email.length > 320) throw invalid();
  return transaction(async (tx) => {
    const challenge = await pending(tx, nonce);
    if (challenge.provider !== "GOOGLE") throw invalid();
    await stage(tx, challenge.tokenHash, subject, email);
  });
}

export async function stageAppleAccountLink(userId: string, sessionHash: string, nonce: unknown, identityToken: unknown) {
  validateLinkNonce(nonce);
  if (typeof identityToken !== "string" || identityToken.length < 20 || identityToken.length > 3000) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "Apple 確認資料有誤。");
  }
  await transaction(async (tx) => {
    const challenge = await pending(tx, nonce, userId, sessionHash);
    if (challenge.provider !== "APPLE" || challenge.subject) throw invalid();
  });
  const identity = await verifyAppleIdentity(identityToken, nonce).catch(() => {
    throw new MobileRequestError(409, "LINK_VERIFICATION_FAILED", "無法確認這次 Apple 授權，原本的登入仍保留。請重新開始連結。");
  });
  await transaction(async (tx) => {
    const challenge = await pending(tx, nonce, userId, sessionHash);
    if (challenge.provider !== "APPLE") throw invalid();
    await stage(tx, challenge.tokenHash, identity.subject, identity.email);
  });
}

export async function inspectAccountLink(userId: string, sessionHash: string, nonce: unknown) {
  return transaction(async (tx) => {
    const challenge = await pending(tx, nonce, userId, sessionHash);
    if (!challenge.subject) throw invalid();
    return { provider: challenge.provider, email: challenge.email };
  });
}

export async function confirmAccountLink(userId: string, sessionHash: string, nonce: unknown) {
  return transaction(async (tx) => {
    const challenge = await pending(tx, nonce, userId, sessionHash);
    if (!challenge.subject || (challenge.provider !== "GOOGLE" && challenge.provider !== "APPLE")) throw invalid();
    const field = fieldFor(challenge.provider);
    if (challenge.user[field]) throw invalid();
    const owner = await tx.user.findUnique({ where: challenge.provider === "GOOGLE"
      ? { googleSubject: challenge.subject } : { appleSubject: challenge.subject } });
    if (owner) throw occupied();
    const saved = await tx.user.updateMany({
      where: { id: userId, version: challenge.user.version, [field]: null },
      data: { [field]: challenge.subject, version: { increment: 1 } },
    });
    if (saved.count !== 1) throw invalid();
    await tx.accountLinkChallenge.deleteMany({ where: { userId } });
    return { linked: true };
  });
}
