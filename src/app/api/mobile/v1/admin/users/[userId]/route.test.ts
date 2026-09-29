import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), remove: vi.fn(), tx: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/serializable-transaction", async (original) => ({
  ...(await original<typeof import("@/lib/serializable-transaction")>()),
  runSerializableTransaction: (run: (tx: unknown) => Promise<unknown>) => run(mocks.tx),
}));
vi.mock("@/lib/system-admin", async (original) => ({
  ...(await original<typeof import("@/lib/system-admin")>()),
  updateSystemUserAccessStatus: mocks.update,
  deleteSystemUser: mocks.remove,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  SystemAdminDeleteConfirmationError,
  SystemAdminProtectedUserError,
  SystemAdminStaleWriteError,
} from "@/lib/system-admin";
import { DELETE, PATCH } from "./route";

const admin = { id: "admin", email: "a@b.c", accessStatus: "ACTIVE" };
const params = { params: Promise.resolve({ userId: "target" }) };
const send = (method: string, value: unknown) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

describe("手機使用者管理操作 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue(admin);
  });

  it("改狀態會帶上伺服器認得的管理者與版本", async () => {
    const response = await PATCH(send("PATCH", { expectedVersion: 3, accessStatus: "SUSPENDED" }), params);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(admin, "target", 3, "SUSPENDED", mocks.tx);
  });

  it("狀態或版本不合法就擋下來", async () => {
    expect((await PATCH(send("PATCH", { expectedVersion: 1, accessStatus: "OWNER" }), params)).status).toBe(400);
    expect((await PATCH(send("PATCH", { expectedVersion: -1, accessStatus: "ACTIVE" }), params)).status).toBe(400);
    expect((await PATCH(send("PATCH", { expectedVersion: 1, accessStatus: "ACTIVE", userId: "x" }), params)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("版本過期或對象受保護回 409", async () => {
    mocks.update.mockRejectedValueOnce(new SystemAdminStaleWriteError());
    expect((await PATCH(send("PATCH", { expectedVersion: 1, accessStatus: "ACTIVE" }), params)).status).toBe(409);
    mocks.update.mockRejectedValueOnce(new SystemAdminProtectedUserError());
    expect((await PATCH(send("PATCH", { expectedVersion: 1, accessStatus: "ACTIVE" }), params)).status).toBe(409);
  });

  it("刪除要帶確認 Email，Email 不對回 400", async () => {
    const response = await DELETE(send("DELETE", { expectedVersion: 2, confirmationEmail: "t@b.c" }), params);
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(admin, "target", 2, "t@b.c", mocks.tx);

    mocks.remove.mockRejectedValueOnce(new SystemAdminDeleteConfirmationError());
    expect((await DELETE(send("DELETE", { expectedVersion: 2, confirmationEmail: "x@b.c" }), params)).status).toBe(400);
  });

  it("刪除不接受空白 Email", async () => {
    expect((await DELETE(send("DELETE", { expectedVersion: 2, confirmationEmail: "  " }), params)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
