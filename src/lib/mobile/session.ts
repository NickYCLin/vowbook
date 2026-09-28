import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { digest, MobileRequestError, pkceChallenge, validateExchange } from "./protocol";

const unauthorized = () => new MobileRequestError(401, "UNAUTHORIZED", "登入已失效，請重新登入。");
const randomToken = () => randomBytes(32).toString("base64url");

export async function issueLoginGrant(userId: string, challenge: string) {
  const code = randomToken();
  // Bounded to this account: no scheduled cleanup or unrelated data access.
  await prisma.mobileLoginGrant.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
  await prisma.mobileLoginGrant.create({ data: {
    codeHash: digest(code), challenge, userId, expiresAt: new Date(Date.now() + 60_000),
  } });
  return code;
}

export async function exchangeGrant(body: unknown) {
  const { code, verifier } = validateExchange(body);
  return prisma.$transaction(async (tx) => {
    const codeHash = digest(code);
    const grant = await tx.mobileLoginGrant.findUnique({ where: { codeHash }, select: { userId: true } });
    if (!grant) throw unauthorized();
    const consumed = await tx.mobileLoginGrant.deleteMany({ where: {
      codeHash, challenge: pkceChallenge(verifier), expiresAt: { gt: new Date() }, user: { accessStatus: "ACTIVE" },
    } });
    // Concurrent exchanges contend on this row; exactly one deletion can succeed.
    if (consumed.count !== 1) throw unauthorized();
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await tx.mobileSession.deleteMany({ where: { userId: grant.userId, expiresAt: { lte: new Date() } } });
    await tx.mobileSession.create({ data: { tokenHash: digest(token), userId: grant.userId, expiresAt } });
    return { token, expiresAt: expiresAt.toISOString() };
  }, { maxWait: 5000, timeout: 5000 });
}

function bearerDigest(request: Request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw unauthorized();
  return digest(match[1]);
}

export async function requireMobileUser(request: Request) {
  const session = await prisma.mobileSession.findUnique({ where: { tokenHash: bearerDigest(request) }, include: { user: true } });
  if (!session || session.expiresAt.getTime() <= Date.now() || session.user.accessStatus !== "ACTIVE") throw unauthorized();
  return session.user;
}

export async function revokeMobileSession(request: Request) {
  await prisma.mobileSession.deleteMany({ where: { tokenHash: bearerDigest(request) } });
}
