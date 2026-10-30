import { afterAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { prepareAccountLink, stageGoogleAccountLink, stageAppleAccountLink, confirmAccountLink, inspectAccountLink } from "@/lib/mobile/account-links";
import { digest } from "@/lib/mobile/protocol";
import { signInWithApple, verifyAppleIdentity } from "@/lib/mobile/apple-sign-in";
import { findCurrentUserByGoogleSubject } from "@/lib/current-user-claim";
import { createWorkspaceForUser } from "@/lib/create-workspace";
import { deleteOwnAccount, AccountDeletionReauthenticationError } from "@/lib/account-deletion";

vi.mock("@/lib/mobile/apple-sign-in", async (original) => ({
  ...await original<typeof import("@/lib/mobile/apple-sign-in")>(), verifyAppleIdentity: vi.fn(),
}));

const suite = process.env.VOWBOOK_DB_INTEGRATION === "1" ? describe : describe.skip;
const prefix = `link-it-${process.pid}-`;
let sequence = 0;
async function fixture() {
  const subject = `${prefix}${sequence++}`;
  const user = await prisma.user.create({ data: { appleSubject: subject, email: `${subject}@example.test` } });
  const tokenHash = digest(randomBytes(32).toString("base64url"));
  await prisma.mobileSession.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 600_000) } });
  return { user, tokenHash, subject: `${subject}-google` };
}

suite("account linking against isolated PostgreSQL", () => {
  afterAll(async () => {
    const ownUsers = { OR: [{ appleSubject: { startsWith: prefix } }, { googleSubject: { startsWith: prefix } }] };
    await prisma.weddingWorkspace.deleteMany({ where: { createdBy: ownUsers } });
    await prisma.user.deleteMany({ where: ownUsers });
    await prisma.$disconnect();
  });

  it("keeps the original user, workspace and membership for either login provider", async () => {
    const { user, tokenHash, subject } = await fixture();
    const workspace = await createWorkspaceForUser(user.id, { name: "合成連結測試婚宴", weddingDate: null, timezone: "Asia/Taipei" });
    const { nonce } = await prepareAccountLink(user.id, tokenHash, "GOOGLE");
    await stageGoogleAccountLink(nonce, subject, "linked@example.test");
    await confirmAccountLink(user.id, tokenHash, nonce);
    expect((await findCurrentUserByGoogleSubject(subject))?.id).toBe(user.id);
    const appleNonce = randomBytes(32).toString("base64url");
    const signedIn = await signInWithApple({ nonce: appleNonce, identityToken: "synthetic-token".repeat(3) }, async () => ({
      sub: user.appleSubject!, nonce: digest(appleNonce),
    }));
    expect((await prisma.mobileSession.findUniqueOrThrow({ where: { tokenHash: digest(signedIn.token) } })).userId).toBe(user.id);
    expect(await prisma.membership.count({ where: { workspaceId: workspace.id, userId: user.id, role: "OWNER" } })).toBe(1);
    expect(await prisma.accountLinkChallenge.count({ where: { userId: user.id } })).toBe(0);
    await expect(confirmAccountLink(user.id, tokenHash, nonce)).rejects.toMatchObject({ status: 409 });
    await expect(deleteOwnAccount(user.id, user.email)).rejects.toBeInstanceOf(AccountDeletionReauthenticationError);
  });

  it("allows exactly one concurrent confirmation", async () => {
    const { user, tokenHash, subject } = await fixture();
    const { nonce } = await prepareAccountLink(user.id, tokenHash, "GOOGLE");
    await stageGoogleAccountLink(nonce, subject, user.email);
    const results = await Promise.allSettled([confirmAccountLink(user.id, tokenHash, nonce), confirmAccountLink(user.id, tokenHash, nonce)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("links verified Apple identity to a Google account without requiring a matching email", async () => {
    const { user, tokenHash, subject } = await fixture();
    await prisma.user.update({ where: { id: user.id }, data: { googleSubject: subject, appleSubject: null } });
    const { nonce } = await prepareAccountLink(user.id, tokenHash, "APPLE");
    vi.mocked(verifyAppleIdentity).mockResolvedValueOnce({ subject: user.appleSubject!, email: null, emailVerified: false });
    await stageAppleAccountLink(user.id, tokenHash, nonce, "synthetic-apple-token".repeat(2));
    expect(await inspectAccountLink(user.id, tokenHash, nonce)).toEqual({ provider: "APPLE", email: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).appleSubject).toBeNull();
    await confirmAccountLink(user.id, tokenHash, nonce);
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(linked.appleSubject).toBe(user.appleSubject);
    expect(linked.googleSubject).toBe(subject);
    expect(linked.email).toBe(user.email);
  });

  it("does not add a login while Apple deletion is pending", async () => {
    const { user, tokenHash, subject } = await fixture();
    const { nonce } = await prepareAccountLink(user.id, tokenHash, "GOOGLE");
    await stageGoogleAccountLink(nonce, subject, user.email);
    await prisma.user.update({ where: { id: user.id }, data: { appleDeletionLeaseUntil: new Date(Date.now() + 60_000) } });
    await expect(confirmAccountLink(user.id, tokenHash, nonce)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).googleSubject).toBeNull();
  });

  it("does not merge existing accounts even with the same email", async () => {
    const { user, tokenHash, subject } = await fixture();
    const other = await fixture();
    await prisma.user.update({ where: { id: other.user.id }, data: { googleSubject: subject, email: user.email } });
    const { nonce } = await prepareAccountLink(user.id, tokenHash, "GOOGLE");
    await stageGoogleAccountLink(nonce, subject, user.email);
    await expect(confirmAccountLink(user.id, tokenHash, nonce)).rejects.toMatchObject({ code: "IDENTITY_IN_USE" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).googleSubject).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { googleSubject: subject } })).id).toBe(other.user.id);
  });

  it("rejects expired proof and another device", async () => {
    const { user, tokenHash, subject } = await fixture();
    const { nonce } = await prepareAccountLink(user.id, tokenHash, "GOOGLE");
    await stageGoogleAccountLink(nonce, subject, user.email);
    await expect(inspectAccountLink(user.id, "other-device", nonce)).rejects.toMatchObject({ status: 409 });
    await prisma.accountLinkChallenge.update({ where: { tokenHash: digest(nonce) }, data: { expiresAt: new Date(0) } });
    await expect(confirmAccountLink(user.id, tokenHash, nonce)).rejects.toMatchObject({ status: 409 });
  });

  it("revokes pending links on device logout through the session foreign key", async () => {
    const { user, tokenHash } = await fixture();
    await prepareAccountLink(user.id, tokenHash, "GOOGLE");
    await prisma.mobileSession.delete({ where: { tokenHash } });
    expect(await prisma.accountLinkChallenge.count({ where: { userId: user.id } })).toBe(0);
  });
});
