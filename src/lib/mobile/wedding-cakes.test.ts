import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";

const m = vi.hoisted(() => ({
  read: vi.fn(),
  locked: vi.fn(),
  transaction: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  guestUpdate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/wedding-cakes", () => ({ readWeddingCakesForUser: m.read }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: m.locked }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));

import {
  MAX_APP_HOUSEHOLD,
  mobileCreateCakeHousehold,
  mobileDissolveCakeHousehold,
  mobileUpdateCakeHousehold,
  mobileWeddingCakes,
} from "./wedding-cakes";

const tx = {
  guest: { findMany: m.find, updateMany: m.guestUpdate },
  weddingCakeHousehold: { create: m.create, updateMany: m.update, deleteMany: m.remove },
};

const guest = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, version: 0, category: "FRIEND", side: "PARTNER_A", seniority: "PEER",
  attendanceStatus: "ATTENDING", partySize: 1, cakeHouseholdId: null, checkedIn: false,
  relationshipLabel: null, giftExemptWithCake: false, ...extra,
});

describe("手機發餅名單", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.read.mockResolvedValue({
      workspace: { id: "w", name: "婚禮" },
      households: [{ id: "h", name: "王家", boxes: 2, version: 3 }],
      guests: [
        guest("王爸", { category: "FAMILY", cakeHouseholdId: "h" }),
        guest("王媽", { category: "FAMILY", cakeHouseholdId: "h", version: 1 }),
        guest("新郎", { category: "COUPLE" }),
        guest("小林", { attendanceStatus: "DECLINED" }),
      ],
    });
    m.locked.mockResolvedValue("OWNER");
    m.transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    m.find.mockResolvedValue([{ id: "g", version: 0, category: "FRIEND", cakeHouseholdId: null }]);
    m.create.mockResolvedValue({ id: "new" });
    m.update.mockResolvedValue({ count: 1 });
    m.remove.mockResolvedValue({ count: 1 });
    m.guestUpdate.mockResolvedValue({ count: 1 });
  });

  it("列出家庭、成員快照與盒數，新人本人不列入", async () => {
    const page = await mobileWeddingCakes("w", "u");
    expect(m.read).toHaveBeenCalledWith("w", "u");
    expect(page.guests.map((g) => g.id)).not.toContain("新郎");
    expect(page.households[0]).toMatchObject({ memberIds: ["王爸", "王媽"], membersSnapshot: '[["王媽",1],["王爸",0]]' });
    // 王家兩盒；不出席的小林不領。
    expect(page.totalBoxes).toBe(2);
    expect(page.groups[0]).toMatchObject({ label: "新郎的親戚家人", rows: [{ boxes: 2 }] });
  });

  it("沒有編輯權限時回 403", async () => {
    m.read.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileWeddingCakes("w", "u")).rejects.toMatchObject({ status: 403 });
  });

  it("新增家庭時在交易內確認權限，workspace 只看路徑", async () => {
    await mobileCreateCakeHousehold("w", "u", { name: " 陳家 ", boxes: 1, guests: [{ id: "g", version: 0 }] });
    expect(m.locked).toHaveBeenCalledWith("w", "u", "edit", tx);
    expect(m.create.mock.calls[0][0].data).toEqual({ workspaceId: "w", name: "陳家", boxes: 1 });
    expect(m.guestUpdate.mock.calls[0][0].where).toMatchObject({ id: "g", workspaceId: "w", version: 0 });
  });

  it("名單版本不同時回 409，不寫入", async () => {
    m.find.mockResolvedValue([{ id: "g", version: 2, category: "FRIEND", cakeHouseholdId: null }]);
    await expect(mobileCreateCakeHousehold("w", "u", { name: "陳家", boxes: 1, guests: [{ id: "g", version: 0 }] }))
      .rejects.toMatchObject({ status: 409 });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("擋掉格式錯誤與超過上限的成員", async () => {
    await expect(mobileCreateCakeHousehold("w", "u", { name: "陳家", boxes: 1.5, guests: [{ id: "g", version: 0 }] }))
      .rejects.toBeInstanceOf(MobileRequestError);
    const many = Array.from({ length: MAX_APP_HOUSEHOLD + 1 }, (_, i) => ({ id: `g${i}`, version: 0 }));
    await expect(mobileCreateCakeHousehold("w", "u", { name: "陳家", boxes: 1, guests: many }))
      .rejects.toMatchObject({ status: 400 });
    await expect(mobileCreateCakeHousehold("w", "u", { name: "陳家", boxes: 1, guests: [{ id: "g", version: 0 }, { id: "g", version: 0 }] }))
      .rejects.toMatchObject({ status: 400 });
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("修改時成員快照不同就擋下", async () => {
    m.find.mockResolvedValue([{ id: "g", version: 0, category: "FRIEND", cakeHouseholdId: "h" }]);
    await expect(mobileUpdateCakeHousehold("w", "u", "h", {
      name: "王家", boxes: 1, guests: [{ id: "g", version: 0 }], expectedVersion: 3, expectedMembers: "[]",
    })).rejects.toMatchObject({ status: 409 });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("解散家庭會把成員移出並刪掉家庭", async () => {
    m.find.mockResolvedValue([{ id: "g", version: 0, category: "FRIEND", cakeHouseholdId: "h" }]);
    await mobileDissolveCakeHousehold("w", "u", "h", { expectedVersion: 3, expectedMembers: '[["g",0]]' });
    expect(m.guestUpdate.mock.calls[0][0].data).toMatchObject({ cakeHouseholdId: null });
    expect(m.remove.mock.calls[0][0].where).toEqual({ id: "h", workspaceId: "w", version: 4 });
  });

  it("檢視者寫入時回 403", async () => {
    m.locked.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileDissolveCakeHousehold("w", "u", "h", { expectedVersion: 3, expectedMembers: "[]" }))
      .rejects.toMatchObject({ status: 403 });
  });
});
