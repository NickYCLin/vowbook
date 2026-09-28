import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  queryRaw: vi.fn(),
  createMany: vi.fn(),
  sessionDelete: vi.fn(),
  sessionCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));

import { signInWithApple, verifyAppleIdentity } from "./apple-sign-in";

const tx = {
  user: { findUnique: m.findUnique, create: m.create, update: m.update },
  $queryRaw: m.queryRaw,
  membership: { createMany: m.createMany },
  mobileSession: { deleteMany: m.sessionDelete, create: m.sessionCreate },
};
const rawNonce = "n".repeat(40);
const hashed = createHash("sha256").update(rawNonce).digest("hex");
const body = (extra: Record<string, unknown> = {}) => ({ identityToken: "x".repeat(40), nonce: rawNonce, ...extra });
const verified = (claims: Record<string, unknown> = {}) =>
  vi.fn().mockResolvedValue({ sub: "apple-1", nonce: hashed, email: "Bride@Example.com", email_verified: "true", ...claims });

describe("Sign in with Apple", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    m.findUnique.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: "u1" });
    m.update.mockResolvedValue({ id: "u1" });
    m.queryRaw.mockResolvedValue([]);
  });

  it("簽章或 nonce 不對就拒絕", async () => {
    await expect(verifyAppleIdentity("t", rawNonce, vi.fn().mockRejectedValue(new Error("bad"))))
      .rejects.toMatchObject({ status: 401 });
    await expect(verifyAppleIdentity("t", rawNonce, verified({ nonce: "other" })))
      .rejects.toMatchObject({ status: 401 });
  });

  it("第一次登入建立獨立的 Apple 帳號並發 App 憑證", async () => {
    const result = await signInWithApple(body({ name: " 林小美 " }), verified());
    expect(m.findUnique).toHaveBeenCalledWith({ where: { appleSubject: "apple-1" } });
    expect(m.create.mock.calls[0][0].data).toMatchObject({ appleSubject: "apple-1", email: "bride@example.com", name: "林小美" });
    expect(m.create.mock.calls[0][0].data).not.toHaveProperty("googleSubject");
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(m.sessionCreate.mock.calls[0][0].data.userId).toBe("u1");
  });

  it("Email 驗證過才接受寄給這個 Email 的邀請", async () => {
    m.queryRaw.mockResolvedValue([{ workspace_id: "w", role: "PARTNER" }]);
    await signInWithApple(body(), verified());
    expect(m.createMany.mock.calls[0][0].data).toEqual([{ workspaceId: "w", userId: "u1", role: "PARTNER" }]);

    vi.clearAllMocks();
    m.transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    m.findUnique.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: "u2" });
    await signInWithApple(body(), verified({ email_verified: "false" }));
    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.create.mock.calls[0][0].data.email).toMatch(/^apple-[0-9a-f]{16}@users\.invalid$/);
  });

  it("停用的帳號不能登入", async () => {
    m.findUnique.mockResolvedValue({ id: "u1", accessStatus: "SUSPENDED", name: null });
    await expect(signInWithApple(body(), verified())).rejects.toMatchObject({ status: 403 });
    expect(m.sessionCreate).not.toHaveBeenCalled();
  });

  it("再次登入不覆寫原本的名字", async () => {
    m.findUnique.mockResolvedValue({ id: "u1", accessStatus: "ACTIVE", name: "原本" });
    await signInWithApple(body({ name: "新名字" }), verified());
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty("name");
  });

  it("多送欄位或 nonce 太短就擋下", async () => {
    await expect(signInWithApple(body({ userId: "evil" }), verified())).rejects.toMatchObject({ status: 400 });
    await expect(signInWithApple(body({ nonce: "short" }), verified())).rejects.toMatchObject({ status: 400 });
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
