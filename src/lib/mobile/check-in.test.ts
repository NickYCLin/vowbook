import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), create: vi.fn(), guest: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.access }));
vi.mock("@/lib/serializable-transaction", async (original) => ({ ...await original<typeof import("@/lib/serializable-transaction")>(), runSerializableTransaction: mocks.transaction }));
import { mobileCheckInGuest } from "./check-in";
describe("手機 JSON 報到人數契約", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.access.mockResolvedValue("OWNER");
    mocks.guest.mockResolvedValue({ id: "guest", category: "GUEST", attendanceStatus: "ATTENDING" });
    mocks.create.mockResolvedValue({ id: "check", headcount: 2, checkedInAt: new Date(0), version: 0 });
    mocks.transaction.mockImplementation((operation) => operation({ guest: { findFirst: mocks.guest }, guestCheckIn: { create: mocks.create } }));
  });
  it("接受 App 編碼的整數並沿用領域規則檢查後寫入", async () => {
    await expect(mobileCheckInGuest("workspace", "user", "guest", { headcount: 2, notes: null })).resolves.toMatchObject({ headcount: 2 });
    expect(mocks.access).toHaveBeenCalledWith("workspace", "user", "edit", expect.anything());
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: { workspaceId: "workspace", guestId: "guest", headcount: 2, notes: null } }));
  });
  it.each([0, 21, 1.5, NaN, Infinity, null, {}, true, "2.5"])("拒絕非法人數 %s，且不執行交易", async (headcount) => {
    await expect(mobileCheckInGuest("workspace", "user", "guest", { headcount, notes: null })).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("保留既有表單字串的合法輸入", async () => {
    await expect(mobileCheckInGuest("workspace", "user", "guest", { headcount: "2", notes: "" })).resolves.toMatchObject({ headcount: 2 });
  });
});
