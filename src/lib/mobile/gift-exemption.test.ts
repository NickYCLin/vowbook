import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  access: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.access }));

import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { mobileSetGiftExemption } from "./gift-exemption";

const client = { guest: { updateMany: mocks.updateMany } };

describe("手機上標記不收禮金", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue("OWNER");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("標記後版本往前推一號", async () => {
    await expect(
      mobileSetGiftExemption("workspace_1", "user_1", "guest_1", {
        giftExemptWithCake: true,
        expectedVersion: 4,
      }),
    ).resolves.toEqual({ id: "guest_1", giftExemptWithCake: true, version: 5 });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 4 },
      data: { giftExemptWithCake: true, version: { increment: 1 } },
    });
  });

  it("也能取消標記", async () => {
    await expect(
      mobileSetGiftExemption("workspace_1", "user_1", "guest_1", {
        giftExemptWithCake: false,
        expectedVersion: 0,
      }),
    ).resolves.toMatchObject({ giftExemptWithCake: false });
  });

  it("標記不是布林值就擋下來", async () => {
    await expect(
      mobileSetGiftExemption("workspace_1", "user_1", "guest_1", {
        giftExemptWithCake: "on",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("版本不是整數也擋下來", async () => {
    await expect(
      mobileSetGiftExemption("workspace_1", "user_1", "guest_1", {
        giftExemptWithCake: true,
        expectedVersion: "4",
      }),
    ).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
  });

  it("賓客在別處被改過就回衝突", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      mobileSetGiftExemption("workspace_1", "user_1", "guest_1", {
        giftExemptWithCake: true,
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ status: 409, code: "STALE" });
  });

  it("沒有編輯權限回 403", async () => {
    mocks.access.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(
      mobileSetGiftExemption("workspace_1", "user_1", "guest_1", {
        giftExemptWithCake: true,
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});
