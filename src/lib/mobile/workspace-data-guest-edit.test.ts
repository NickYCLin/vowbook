import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  aggregate: vi.fn(),
  updateMany: vi.fn(),
  records: vi.fn(),
  table: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { mobileUpdateGuest } from "./workspace-data";

const client = {
  guest: { findFirst: mocks.findFirst, aggregate: mocks.aggregate, updateMany: mocks.updateMany },
  guestImportRecord: { findMany: mocks.records },
  seatingTable: { findFirst: mocks.table },
};

const current = {
  id: "guest_1", version: 3, category: "GUEST", partySize: 2, seatingTableId: "table_1", checkIn: null,
};
const edit = {
  name: "王小明", side: "PARTNER_B", attendanceStatus: "ATTENDING", partySize: 2, notes: "坐靠門", expectedVersion: 3,
};

describe("手機修改賓客", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.findFirst.mockResolvedValue(current);
    mocks.aggregate.mockResolvedValue({ _sum: { partySize: 6 } });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.records.mockResolvedValue([]);
    mocks.table.mockResolvedValue({ id: "table_1", capacity: 10 });
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("只改核心欄位，名單身份沿用資料庫，不動輩份", async () => {
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", edit))
      .resolves.toEqual({ id: "guest_1", name: "王小明", version: 4, removedFromTable: false });
    expect(mocks.locked).toHaveBeenCalledWith("workspace_1", "user_1", "edit", client);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 3 },
      data: {
        name: "王小明", category: "GUEST", side: "PARTNER_B", attendanceStatus: "ATTENDING",
        partySize: 2, notes: "坐靠門", version: { increment: 1 },
      },
    });
  });

  it("改成不出席就移出桌次", async () => {
    const result = await mobileUpdateGuest("workspace_1", "user_1", "guest_1", { ...edit, attendanceStatus: "DECLINED" });
    expect(result.removedFromTable).toBe(true);
    expect(mocks.updateMany.mock.calls[0][0].data.seatingTableId).toBeNull();
  });

  it("加人會超過桌子的位子就擋下", async () => {
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", { ...edit, partySize: 5 }))
      .rejects.toMatchObject({ status: 409, code: "CAPACITY" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("減人不能少於已登記的素食人數", async () => {
    mocks.records.mockResolvedValue([
      { source: "MANUAL", sourceInstance: "guest-details", sourceManaged: false, childSeatCount: null, vegetarianCount: 2 },
    ]);
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", { ...edit, partySize: 1 }))
      .rejects.toMatchObject({ status: 400, message: "素食人數不能超過邀請人數。" });
  });

  it("已報到的人不能直接改成未回覆", async () => {
    mocks.findFirst.mockResolvedValue({ ...current, checkIn: { id: "c1" } });
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", { ...edit, attendanceStatus: "UNDECIDED" }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("版本不對或不在這場婚宴回 409", async () => {
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", { ...edit, expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 409 });
    mocks.findFirst.mockResolvedValue(null);
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", edit)).rejects.toMatchObject({ status: 409 });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "guest_1", workspaceId: "workspace_1" } }));
  });

  it("姓名空白回 400", async () => {
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", { ...edit, name: " " }))
      .rejects.toMatchObject({ status: 400 });
  });
});
