import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), preview: vi.fn(), remove: vi.fn(), appleRemove: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/mobile/apple-account-deletion", () => ({ deleteAppleAccount: mocks.appleRemove, prepareAppleAccountDeletion: mocks.prepare }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/account-deletion", async (original) => ({
  ...(await original<typeof import("@/lib/account-deletion")>()),
  previewAccountDeletion: mocks.preview,
  deleteOwnAccount: mocks.remove,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { AccountDeletionBlockedError, AccountDeletionConfirmationError } from "@/lib/account-deletion";
import { DELETE, GET, POST } from "./route";

const send = (method: string, value?: unknown) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
  });

describe("手機刪除帳號 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.remove.mockResolvedValue({ deletedWorkspaceCount: 1, leftWorkspaceCount: 0 });
  });

  it("預覽只看登入的帳號", async () => {
    mocks.preview.mockResolvedValue({ email: "a@b.c", deleted: [], left: [], handedOver: [], blocked: [] });
    expect((await GET(send("GET"))).status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith("server-user");
  });

  it("只收確認 Email，不能指定別人的帳號", async () => {
    expect((await DELETE(send("DELETE", { confirmationEmail: "a@b.c" }))).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("server-user", "a@b.c");
    expect((await DELETE(send("DELETE", { confirmationEmail: "a@b.c", userId: "u2" }))).status).toBe(400);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("Email 不對回 400，被擋下回 409", async () => {
    mocks.remove.mockRejectedValueOnce(new AccountDeletionConfirmationError());
    expect((await DELETE(send("DELETE", { confirmationEmail: "x" }))).status).toBe(400);
    mocks.remove.mockRejectedValueOnce(new AccountDeletionBlockedError(["王家"]));
    const blocked = await DELETE(send("DELETE", { confirmationEmail: "a@b.c" }));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).message).toContain("王家");
  });

  it("沒登入就是 401", async () => {
    const { MobileRequestError } = await import("@/lib/mobile/protocol");
    mocks.user.mockRejectedValueOnce(new MobileRequestError(401, "UNAUTHORIZED", "登入已失效"));
    expect((await DELETE(send("DELETE", { confirmationEmail: "a@b.c" }))).status).toBe(401);
  });

  it("Apple 不能繞過重新驗證與撤銷，body 也不能換帳號", async () => {
    mocks.user.mockResolvedValue({ id: "server-user", appleSubject: "apple" });
    mocks.prepare.mockResolvedValue({ nonce: "server-nonce", resume: false });
    expect((await POST(send("POST"))).status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith("server-user");
    mocks.appleRemove.mockResolvedValue({ deletedWorkspaceCount: 0, leftWorkspaceCount: 0 });
    const body = { confirmationEmail: "a@b.c", identityToken: "token", authorizationCode: "code", nonce: "server-nonce" };
    expect((await DELETE(send("DELETE", body))).status).toBe(200);
    expect(mocks.appleRemove).toHaveBeenCalledWith("server-user", body);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((await DELETE(send("DELETE", { ...body, userId: "other" }))).status).toBe(400);
  });
});
