import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  locked: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));

import {
  mobileUpdateCeremonyPreferences,
  mobileUpdateMealPricing,
} from "./budget-settings";

const client = { weddingWorkspace: { updateMany: mocks.updateMany } };

describe("手機改餐費設定", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("數字照網站的規則收下來", async () => {
    await expect(mobileUpdateMealPricing("workspace_1", "user_1", {
      staffMealUnitPrice: 120, vegetarianMealUnitPrice: 300, serviceChargePercent: 10,
    })).resolves.toEqual({
      staffMealUnitPrice: 120, vegetarianMealUnitPrice: 300, serviceChargePercent: 10,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "workspace_1" },
      data: { staffMealUnitPrice: 120, vegetarianMealUnitPrice: 300, serviceChargePercent: 10 },
    });
  });

  it("留空就是沒設定，存成 null", async () => {
    await expect(mobileUpdateMealPricing("workspace_1", "user_1", {
      staffMealUnitPrice: null, vegetarianMealUnitPrice: null, serviceChargePercent: 0,
    })).resolves.toEqual({
      staffMealUnitPrice: null, vegetarianMealUnitPrice: null, serviceChargePercent: 0,
    });
  });

  it("服務費超過 100 就擋下來", async () => {
    await expect(mobileUpdateMealPricing("workspace_1", "user_1", {
      staffMealUnitPrice: null, vegetarianMealUnitPrice: null, serviceChargePercent: 101,
    })).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("手機改中式儀式設定", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("用 ceremonyPreferencesVersion 當版本依據", async () => {
    await expect(mobileUpdateCeremonyPreferences("workspace_1", "user_1", {
      hasEngagementCeremony: true, hasProcessionCeremony: false, expectedVersion: 2,
    })).resolves.toEqual({
      hasEngagementCeremony: true, hasProcessionCeremony: false, version: 3,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "workspace_1", ceremonyPreferencesVersion: 2 },
      data: {
        hasEngagementCeremony: true,
        hasProcessionCeremony: false,
        ceremonyPreferencesVersion: { increment: 1 },
      },
    });
  });

  it("版本對不上就回衝突", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(mobileUpdateCeremonyPreferences("workspace_1", "user_1", {
      hasEngagementCeremony: true, hasProcessionCeremony: true, expectedVersion: 2,
    })).rejects.toMatchObject({ status: 409, code: "STALE" });
  });

  it("只收布林值，其他型別一律擋掉", async () => {
    await expect(mobileUpdateCeremonyPreferences("workspace_1", "user_1", {
      hasEngagementCeremony: "on", hasProcessionCeremony: false, expectedVersion: 1,
    })).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
