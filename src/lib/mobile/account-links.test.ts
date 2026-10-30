import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), find: vi.fn(), create: vi.fn(), remove: vi.fn(), stage: vi.fn(),
  owner: vi.fn(), update: vi.fn(), session: vi.fn(), verify: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("./apple-sign-in", () => ({ verifyAppleIdentity: mocks.verify }));

import { confirmAccountLink, inspectAccountLink, prepareAccountLink, stageAppleAccountLink, stageGoogleAccountLink } from "./account-links";
import { digest } from "./protocol";

const nonce = "n".repeat(43);
const sessionHash = "s".repeat(64);
const user = { id: "owner", accessStatus: "ACTIVE", googleSubject: null, appleSubject: "apple-original", version: 2,
  appleDeletionToken: null, appleDeletionRevokedAt: null, appleDeletionLeaseUntil: null };
const challenge = () => ({ tokenHash: digest(nonce), userId: user.id, sessionHash, provider: "GOOGLE", subject: "google-new",
  email: "linked@example.test", expiresAt: new Date(Date.now() + 60_000), user: { ...user },
  session: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
const tx = { accountLinkChallenge: { findUnique: mocks.find, create: mocks.create, deleteMany: mocks.remove, updateMany: mocks.stage },
  user: { findUnique: mocks.owner, updateMany: mocks.update }, mobileSession: { findUnique: mocks.session } };

describe("explicit account linking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (operation) => operation(tx));
    mocks.find.mockResolvedValue(challenge());
    mocks.owner.mockResolvedValue(null);
    mocks.session.mockResolvedValue({ userId: user.id, expiresAt: new Date(Date.now() + 60_000), user });
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.stage.mockResolvedValue({ count: 1 });
    mocks.remove.mockResolvedValue({ count: 1 });
  });

  it("issues a hashed, short-lived challenge bound to the authenticated device", async () => {
    const result = await prepareAccountLink(user.id, sessionHash, "GOOGLE");
    expect(result.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: user.id, sessionHash, provider: "GOOGLE", tokenHash: digest(result.nonce),
    }) });
    expect(mocks.create.mock.calls[0][0].data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
  });

  it("does not let the client choose a different owner or a linked provider", async () => {
    await expect(prepareAccountLink("other", sessionHash, "GOOGLE")).rejects.toMatchObject({ status: 409 });
    await expect(prepareAccountLink(user.id, sessionHash, "APPLE")).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("stages verified Google identity without creating a user or changing membership", async () => {
    mocks.find.mockResolvedValue({ ...challenge(), subject: null, email: null });
    await stageGoogleAccountLink(nonce, "google-new", "linked@example.test");
    expect(mocks.stage).toHaveBeenCalledWith({ where: expect.objectContaining({ subject: null }),
      data: { subject: "google-new", email: "linked@example.test" } });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires a fresh Apple nonce proof and supports hidden or missing email", async () => {
    mocks.find.mockResolvedValue({ ...challenge(), provider: "APPLE", subject: null });
    mocks.verify.mockResolvedValue({ subject: "apple-new", email: null });
    await stageAppleAccountLink(user.id, sessionHash, nonce, "signed-token".repeat(3));
    expect(mocks.verify).toHaveBeenCalledWith("signed-token".repeat(3), nonce);
    expect(mocks.stage.mock.calls[0][0].data).toEqual({ subject: "apple-new", email: null });
  });

  it("rejects failed Apple verification without staging or linking", async () => {
    mocks.find.mockResolvedValue({ ...challenge(), provider: "APPLE", subject: null });
    mocks.verify.mockRejectedValue(new Error("invalid signature"));
    await expect(stageAppleAccountLink(user.id, sessionHash, nonce, "forged-token".repeat(3)))
      .rejects.toMatchObject({ status: 409, code: "LINK_VERIFICATION_FAILED" });
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("shows verified identity for explicit confirmation", async () => {
    await expect(inspectAccountLink(user.id, sessionHash, nonce)).resolves.toEqual({ provider: "GOOGLE", email: "linked@example.test" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("attaches the provider to the original user without using email as an identity", async () => {
    await confirmAccountLink(user.id, sessionHash, nonce);
    expect(mocks.owner).toHaveBeenCalledWith({ where: { googleSubject: "google-new" } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: user.id, version: 2, googleSubject: null },
      data: { googleSubject: "google-new", version: { increment: 1 } } });
    expect(mocks.remove).toHaveBeenCalledWith({ where: { userId: user.id } });
  });

  it("never merges an identity that already belongs to another account", async () => {
    mocks.owner.mockResolvedValue({ id: "different-owner" });
    await expect(confirmAccountLink(user.id, sessionHash, nonce)).rejects.toMatchObject({ code: "IDENTITY_IN_USE", status: 409 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["expired challenge", () => ({ ...challenge(), expiresAt: new Date(0) })],
    ["revoked device", () => ({ ...challenge(), session: null })],
    ["expired device", () => ({ ...challenge(), session: { userId: user.id, expiresAt: new Date(0) } })],
    ["blocked account", () => ({ ...challenge(), user: { ...user, accessStatus: "BLOCKED" } })],
    ["deletion pending", () => ({ ...challenge(), user: { ...user, appleDeletionToken: "sealed" } })],
    ["revocation pending", () => ({ ...challenge(), user: { ...user, appleDeletionRevokedAt: new Date() } })],
    ["deletion leased", () => ({ ...challenge(), user: { ...user, appleDeletionLeaseUntil: new Date(Date.now() + 60_000) } })],
    ["missing proof", () => ({ ...challenge(), subject: null })],
    ["consumed challenge", () => null],
  ])("rejects %s", async (_label, fixture) => {
    mocks.find.mockResolvedValue(fixture());
    await expect(confirmAccountLink(user.id, sessionHash, nonce)).rejects.toMatchObject({ status: 409 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects another account or device even if it knows the nonce", async () => {
    await expect(confirmAccountLink("other", sessionHash, nonce)).rejects.toMatchObject({ status: 409 });
    await expect(confirmAccountLink(user.id, "different-session", nonce)).rejects.toMatchObject({ status: 409 });
  });

  it("does not replace a provider added concurrently", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(confirmAccountLink(user.id, sessionHash, nonce)).rejects.toMatchObject({ status: 409 });
  });

  it("maps concurrent unique-identity claims to a safe conflict", async () => {
    mocks.update.mockRejectedValue({ code: "P2002" });
    await expect(confirmAccountLink(user.id, sessionHash, nonce)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects malformed nonces before database access", async () => {
    await expect(confirmAccountLink(user.id, sessionHash, "short")).rejects.toMatchObject({ status: 400 });
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
