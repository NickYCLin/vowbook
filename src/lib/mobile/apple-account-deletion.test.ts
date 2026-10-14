import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), preview: vi.fn(), remove: vi.fn(), find: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.find, updateMany: mocks.update } } }));
vi.mock("./apple-sign-in", () => ({ APPLE_AUDIENCE: "com.vowbook.ios", verifyAppleIdentity: mocks.identity }));
vi.mock("@/lib/account-deletion", () => ({ previewAccountDeletion: mocks.preview, deleteOwnAccount: mocks.remove }));

import { deleteAppleAccount, prepareAppleAccountDeletion, sealAppleDeletionToken, openAppleDeletionToken } from "./apple-account-deletion";
import { digest } from "./protocol";

const nonce = "a".repeat(43);
const input = { confirmationEmail: "me@example.com", identityToken: "identity", authorizationCode: "code", nonce };
const user = { id: "me", appleSubject: "apple-me", appleDeletionNonceHash: digest(nonce), appleDeletionExpiresAt: new Date(Date.now() + 300_000), appleDeletionToken: null, appleDeletionRevokedAt: null };

describe("Apple 刪帳撤銷與復原", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue(user);
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.preview.mockResolvedValue({ email: "me@example.com", blocked: [] });
    mocks.identity.mockResolvedValue({ subject: "apple-me" });
    mocks.remove.mockResolvedValue({ deletedWorkspaceCount: 0, leftWorkspaceCount: 0 });
  });

  const dependencies = () => ({ exchange: vi.fn().mockResolvedValue("refresh"), revoke: vi.fn().mockResolvedValue(undefined), secret: "synthetic-test-only" });

  it("加密內容綁帳號，不能改密文或用另一帳號解密", () => {
    const sealed = sealAppleDeletionToken("refresh", "me", "synthetic");
    expect(sealed).not.toContain("refresh");
    expect(openAppleDeletionToken(sealed, "me", "synthetic")).toBe("refresh");
    expect(() => openAppleDeletionToken(sealed, "other", "synthetic")).toThrow();
    expect(() => openAppleDeletionToken(sealed, "me", "wrong")).toThrow();
  });

  it("新確認由伺服器產生短效 nonce，沒有 Apple 設定就不開始", async () => {
    await expect(prepareAppleAccountDeletion("me", false)).rejects.toMatchObject({ code: "APPLE_CONFIGURATION" });
    expect(mocks.update).not.toHaveBeenCalled();
    const challenge = await prepareAppleAccountDeletion("me", true);
    expect(challenge.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge.resume).toBe(false);
  });

  it("Email 或共享婚宴未處理時，不交換或撤銷", async () => {
    const deps = dependencies();
    await expect(deleteAppleAccount("me", { ...input, confirmationEmail: "wrong" }, deps)).rejects.toMatchObject({ code: "CONFIRMATION" });
    mocks.preview.mockResolvedValue({ email: "me@example.com", blocked: ["共享婚宴"] });
    await expect(deleteAppleAccount("me", input, deps)).rejects.toMatchObject({ code: "BLOCKED" });
    expect(deps.exchange).not.toHaveBeenCalled();
    expect(deps.revoke).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("錯誤、過期 nonce 與不同 Apple 帳號皆不能刪除", async () => {
    const deps = dependencies();
    await expect(deleteAppleAccount("me", { ...input, nonce: "b".repeat(43) }, deps)).rejects.toMatchObject({ code: "REAUTHENTICATE" });
    mocks.find.mockResolvedValueOnce({ ...user, appleDeletionExpiresAt: new Date(0) });
    await expect(deleteAppleAccount("me", input, deps)).rejects.toMatchObject({ code: "REAUTHENTICATE" });
    mocks.identity.mockResolvedValue({ subject: "someone-else" });
    await expect(deleteAppleAccount("me", input, deps)).rejects.toMatchObject({ code: "REAUTHENTICATE" });
    expect(deps.exchange).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("併發刪帳拿不到 lease 就不接觸 Apple", async () => {
    const deps = dependencies();
    mocks.update.mockResolvedValueOnce({ count: 0 });
    await expect(deleteAppleAccount("me", input, deps)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(deps.exchange).not.toHaveBeenCalled();
  });

  it("先存加密 token、撤銷、記錄成功，再刪本地資料", async () => {
    const deps = dependencies();
    await deleteAppleAccount("me", input, deps);
    expect(mocks.update.mock.calls[1][0].data.appleDeletionToken).not.toContain("refresh");
    expect(deps.revoke).toHaveBeenCalledWith("refresh");
    expect(deps.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
    expect(mocks.update.mock.calls[2][0].data.appleDeletionRevokedAt).toBeInstanceOf(Date);
  });

  it("Apple 超時不刪；下次用保存的 token 重試，不重用已消耗的 code", async () => {
    const deps = dependencies();
    deps.revoke.mockRejectedValueOnce(new Error("timeout"));
    await expect(deleteAppleAccount("me", input, deps)).rejects.toMatchObject({ code: "APPLE_UNAVAILABLE" });
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.find.mockResolvedValue({ ...user, appleDeletionToken: sealAppleDeletionToken("refresh", "me", deps.secret) });
    await deleteAppleAccount("me", { confirmationEmail: input.confirmationEmail }, deps);
    expect(deps.exchange).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("撤銷後本地刪除失敗仍可續辦，不再交換或撤銷", async () => {
    const deps = dependencies();
    mocks.find.mockResolvedValue({ ...user, appleDeletionRevokedAt: new Date() });
    mocks.remove.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(deleteAppleAccount("me", { confirmationEmail: input.confirmationEmail }, deps)).rejects.toThrow();
    await deleteAppleAccount("me", { confirmationEmail: input.confirmationEmail }, deps);
    expect(deps.exchange).not.toHaveBeenCalled();
    expect(deps.revoke).not.toHaveBeenCalled();
  });

  it("撤銷已成功時，即使 Apple 設定暫時不可用仍可續辦本地刪除", async () => {
    mocks.find.mockResolvedValue({ ...user, appleDeletionRevokedAt: new Date() });
    await expect(prepareAppleAccountDeletion("me", false)).resolves.toEqual({ nonce: null, resume: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
