import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/product-feedback", () => ({ listProductFeedback: mocks.list }));
import FeedbackAdminPage from "./page";
import { SystemAdminAccessDeniedError } from "@/lib/system-admin";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
});

describe("意見回饋管理頁", () => {
  it("拒絕非系統管理者", async () => {
    mocks.list.mockRejectedValueOnce(new SystemAdminAccessDeniedError());
    await expect(FeedbackAdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("無效分頁參數不進行資料查詢", async () => {
    await expect(FeedbackAdminPage({ searchParams: Promise.resolve({ before: "invalid", id: "invalid" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("僅顯示使用者提供的文字，不執行 HTML", async () => {
    mocks.list.mockResolvedValueOnce([{
      id: "00000000-0000-4000-8000-000000000001", section: "timeline", category: "habit",
      message: "<script>不應執行</script>", contact: null, createdAt: new Date("2026-11-05T00:00:00Z"),
    }]);
    const { container } = render(await FeedbackAdminPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("總流程・使用習慣")).toBeVisible();
    expect(screen.getByText("<script>不應執行</script>")).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
  });
});
