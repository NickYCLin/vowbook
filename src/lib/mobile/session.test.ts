import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  mobileLoginGrant: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
  mobileSession: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { digest, pkceChallenge } from "./protocol";
import { issueLoginGrant, exchangeGrant, requireMobileUser, revokeMobileSession } from "./session";
const proof = { code: "C".repeat(43), verifier: "V".repeat(43) };

describe("mobile sessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (callback) => callback(db));
    db.mobileLoginGrant.deleteMany.mockResolvedValue({ count: 0 });
    db.mobileSession.deleteMany.mockResolvedValue({ count: 0 });
  });
  it("stores a digest and a short-lived PKCE-bound grant", async () => {
    const code = await issueLoginGrant("user", pkceChallenge(proof.verifier));
    expect(code).toMatch(/^[\w-]{43}$/);
    expect(db.mobileLoginGrant.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      codeHash: digest(code), challenge: pkceChallenge(proof.verifier), userId: "user",
      expiresAt: expect.any(Date),
    }) });
    const expiry = db.mobileLoginGrant.create.mock.calls[0][0].data.expiresAt.getTime();
    expect(expiry - Date.now()).toBeGreaterThan(50_000);
    expect(expiry - Date.now()).toBeLessThanOrEqual(60_000);
  });
  it("rejects invalid, expired, consumed or mismatched grants without creating sessions", async () => {
    await expect(exchangeGrant(proof)).rejects.toMatchObject({ status: 401 });
    expect(db.mobileSession.create).not.toHaveBeenCalled();
  });
  it("atomically consumes only a matching unexpired grant for an active account", async () => {
    // The transaction reads the identity then atomically deletes the same eligible row.
    const tx = { ...db, mobileLoginGrant: { ...db.mobileLoginGrant, findUnique: vi.fn().mockResolvedValue({ userId: "u" }) } };
    db.$transaction.mockImplementation(async (callback) => callback(tx));
    db.mobileLoginGrant.deleteMany.mockResolvedValue({ count: 1 });
    const result = await exchangeGrant(proof);
    expect(db.mobileLoginGrant.deleteMany).toHaveBeenCalledWith({ where: {
      codeHash: digest(proof.code), challenge: pkceChallenge(proof.verifier),
      expiresAt: { gt: expect.any(Date) }, user: { accessStatus: "ACTIVE" },
    } });
    expect(db.mobileSession.create).toHaveBeenCalledWith({ data: {
      tokenHash: digest(result.token), userId: "u", expiresAt: expect.any(Date),
    } });
    expect(result.expiresAt).toBeTruthy();
  });
  it("requires a bearer credential even if cookies or a client userId are present", async () => {
    for (const header of [null, "", "Basic abc", "Bearer short", `Bearer ${"x".repeat(43)} extra`]) {
      const request = new Request("https://example.test", { headers: header ? { Authorization: header } : {} });
      await expect(requireMobileUser(request)).rejects.toMatchObject({ status: 401 });
    }
    expect(db.mobileSession.findUnique).not.toHaveBeenCalled();
  });
  it("rechecks expiry and blocked accounts on every request", async () => {
    const request = new Request("https://example.test", { headers: { Authorization: `Bearer ${"T".repeat(43)}` } });
    for (const session of [null, { expiresAt: new Date(0), user: { accessStatus: "ACTIVE" } },
      { expiresAt: new Date(Date.now() + 10_000), user: { accessStatus: "BLOCKED" } }]) {
      db.mobileSession.findUnique.mockResolvedValue(session);
      await expect(requireMobileUser(request)).rejects.toMatchObject({ status: 401 });
    }
    db.mobileSession.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 10_000), user: { id: "u", accessStatus: "ACTIVE" } });
    await expect(requireMobileUser(request)).resolves.toMatchObject({ id: "u" });
    expect(db.mobileSession.findUnique).toHaveBeenLastCalledWith({ where: { tokenHash: digest("T".repeat(43)) }, include: { user: true } });
  });
  it("revokes only the presented session and is idempotent", async () => {
    const request = new Request("https://example.test", { headers: { Authorization: `Bearer ${"T".repeat(43)}` } });
    await revokeMobileSession(request);
    expect(db.mobileSession.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: digest("T".repeat(43)) } });
  });
});
