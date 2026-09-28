import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  aggregate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { mobileCreateSeatingTable, mobileUpdateSeatingTable } from "./seating-tables";

const client = {
  $executeRaw: mocks.executeRaw,
  $queryRaw: mocks.queryRaw,
  seatingTable: { findMany: mocks.findMany, create: mocks.create, updateMany: mocks.updateMany },
  guest: { aggregate: mocks.aggregate },
};
const table = (id: string, position: number, version = 0) => ({
  id, workspaceId: "workspace_1", position, version, name: `第${position}桌`, capacity: 10, notes: null, layoutX: null, layoutY: null,
});

describe("手機新增、調整桌次", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.executeRaw.mockResolvedValue(1);
    mocks.queryRaw.mockResolvedValue([{ id: "workspace_1" }]);
    mocks.findMany.mockResolvedValue([table("t1", 1), table("t2", 3, 2)]);
    mocks.create.mockResolvedValue({ id: "t3", version: 0 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.aggregate.mockResolvedValue({ _sum: { partySize: 6 } });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("新的一桌排在最後，先鎖桌次再確認權限", async () => {
    await expect(mobileCreateSeatingTable("workspace_1", "user_1", { name: " 男方同事 ", capacity: 12 }))
      .resolves.toEqual({ id: "t3", name: "男方同事", capacity: 12, version: 0 });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "edit", client);
    expect(mocks.create).toHaveBeenCalledWith({
      data: { workspaceId: "workspace_1", position: 4, name: "男方同事", capacity: 12, notes: null },
      select: { id: true, version: true },
    });
  });

  it("桌數滿了、座位數不合理都不寫入", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 200 }, (_, index) => table(`t${index}`, index + 1)));
    await expect(mobileCreateSeatingTable("workspace_1", "user_1", { name: "加桌", capacity: 10 }))
      .rejects.toMatchObject({ status: 400 });
    await expect(mobileCreateSeatingTable("workspace_1", "user_1", { name: "加桌", capacity: 0 }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("修改要對上版本，座位數不能少於已入座人數", async () => {
    await expect(mobileUpdateSeatingTable("workspace_1", "user_1", "t2", { name: "主桌", capacity: 8, expectedVersion: 2 }))
      .resolves.toEqual({ id: "t2", name: "主桌", capacity: 8, version: 3 });
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: "t2", workspaceId: "workspace_1", version: 2 });

    await expect(mobileUpdateSeatingTable("workspace_1", "user_1", "t2", { name: "主桌", capacity: 5, expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("6") });
    await expect(mobileUpdateSeatingTable("workspace_1", "user_1", "t2", { name: "主桌", capacity: 8, expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409 });
    await expect(mobileUpdateSeatingTable("workspace_1", "user_1", "other", { name: "主桌", capacity: 8, expectedVersion: 0 }))
      .rejects.toMatchObject({ status: 409 });
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });
});
