import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  aggregate: vi.fn(),
  updateMany: vi.fn(),
  records: vi.fn(),
  table: vi.fn(),
  upsert: vi.fn(),
  guests: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/guest-list", () => ({ loadGuestsForUser: mocks.guests }));

import { mobileGuestList, mobileUpdateGuest } from "./workspace-data";

const client = {
  guest: { findFirst: mocks.findFirst, aggregate: mocks.aggregate, updateMany: mocks.updateMany },
  guestImportRecord: { findMany: mocks.records, upsert: mocks.upsert },
  seatingTable: { findFirst: mocks.table },
};

const current = {
  id: "guest_1", version: 3, category: "GUEST", partySize: 4, seatingTableId: null, checkIn: null,
};
const core = {
  name: "王小明", side: "PARTNER_B", attendanceStatus: "ATTENDING", partySize: 4, notes: "", expectedVersion: 3,
};

describe("手機修改賓客細項", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockResolvedValue("PARTNER");
    mocks.findFirst.mockResolvedValue(current);
    mocks.aggregate.mockResolvedValue({ _sum: { partySize: 0 } });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.records.mockResolvedValue([]);
    mocks.upsert.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(client));
  });

  it("有帶細項就寫進同一筆自行填寫的紀錄", async () => {
    await mobileUpdateGuest("workspace_1", "user_1", "guest_1", {
      ...core,
      relationshipLabel: "大學同學",
      contactPhone: "0912345678",
      childSeatCount: 1,
      vegetarianCount: 2,
    });

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.where.workspaceId_source_sourceInstance_externalId).toEqual({
      workspaceId: "workspace_1", source: "MANUAL", sourceInstance: "guest-details", externalId: "guest_1",
    });
    expect(args.create.relationshipLabel).toBe("大學同學");
    expect(args.create.contactPhone).toBe("0912345678");
    expect(args.create.childSeatCount).toBe(1);
    expect(args.create.vegetarianCount).toBe(2);
    expect(args.create.sourceManaged).toBe(false);
  });

  it("沒帶細項就完全不碰既有紀錄", async () => {
    await mobileUpdateGuest("workspace_1", "user_1", "guest_1", core);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("兒童椅超過邀請人數就擋下來，照網站的規則各自比對", async () => {
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", {
      ...core, childSeatCount: 5,
    })).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("素食超過邀請人數同樣擋下來", async () => {
    await expect(mobileUpdateGuest("workspace_1", "user_1", "guest_1", {
      ...core, vegetarianCount: 9,
    })).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("證婚回覆不接受手機傳進來的值，沿用資料庫現值", async () => {
    mocks.records.mockResolvedValue([
      { source: "LINEIN", sourceInstance: "a", sourceManaged: true, ceremonyAttendance: true },
    ]);
    await mobileUpdateGuest("workspace_1", "user_1", "guest_1", {
      ...core, relationshipLabel: "同事", ceremonyAttendance: false,
    } as Record<string, unknown>);
    expect(mocks.upsert.mock.calls[0][0].create.ceremonyAttendance).toBe(true);
  });
});

describe("手機名單帶出細項", () => {
  beforeEach(() => vi.clearAllMocks());

  it("把聯絡與飲食細節一起送給 App", async () => {
    mocks.guests.mockResolvedValue({
      role: "OWNER",
      guests: [{
        id: "guest_1", version: 1, name: "王小明", category: "GUEST", side: "PARTNER_A",
        attendanceStatus: "ATTENDING", partySize: 2, notes: null, seatingTable: null, checkIn: null,
        details: {
          relationshipLabel: "大學同學", contactPhone: "0912345678", contactEmail: null,
          ceremonyAttendance: null, childSeatCount: 1, vegetarianCount: 0,
          invitationDelivery: "PAPER", mailingAddress: null, guestMessage: null,
          attendanceReply: null, invitationReply: null,
        },
      }],
    });

    const result = await mobileGuestList("workspace_1", "user_1");

    expect(result.guests[0].details).toMatchObject({
      relationshipLabel: "大學同學",
      contactPhone: "0912345678",
      childSeatCount: 1,
      invitationDelivery: "PAPER",
    });
  });

  it("沒有細項的賓客回 null，不硬造空物件", async () => {
    mocks.guests.mockResolvedValue({
      role: "OWNER",
      guests: [{
        id: "guest_1", version: 1, name: "王小明", category: "GUEST", side: "PARTNER_A",
        attendanceStatus: "ATTENDING", partySize: 2, notes: null, seatingTable: null, checkIn: null,
        details: null,
      }],
    });

    const result = await mobileGuestList("workspace_1", "user_1");
    expect(result.guests[0].details).toBeNull();
  });
});
