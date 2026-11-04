import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/system-admin", () => ({ requireSystemAdmin: mocks.admin }));
vi.mock("@/lib/prisma", () => ({ prisma: { productFeedback: { findMany: mocks.findMany } } }));
import { listProductFeedback } from "./product-feedback";
beforeEach(() => vi.resetAllMocks());
describe("回饋管理讀取權限", () => {
  it("一般使用者與其他協作者無法列出回饋", async () => {
    mocks.admin.mockRejectedValue(new Error("forbidden"));
    await expect(listProductFeedback()).rejects.toThrow("forbidden");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("管理者讀取僅選擇回饋欄位，不載入婚宴內容或帳號資料", async () => {
    mocks.findMany.mockResolvedValue([]);
    await listProductFeedback();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51, select: { id: true, section: true, category: true, message: true, contact: true, createdAt: true } }));
  });
  it("同一時間建立的回饋以編號接續，不會因分頁漏列", async () => {
    const cursor = { date: new Date("2026-11-05T00:00:00Z"), id: "00000000-0000-4000-8000-000000000010" };
    mocks.findMany.mockResolvedValue([]);
    await listProductFeedback(cursor);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { createdAt: { lt: cursor.date } },
        { createdAt: cursor.date, id: { lt: cursor.id } },
      ] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
  });
});
