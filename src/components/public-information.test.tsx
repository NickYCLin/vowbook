import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import SupportPage from "@/app/support/page";
import { informationEvidence } from "@/content/service-information";

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get() { throw new Error("公開說明不得讀資料庫"); } }) }));
vi.mock("next-auth", () => ({ getServerSession() { throw new Error("公開說明不得要求登入"); } }));

describe("匿名資料說明與支援頁", () => {
  it("明示待確認政策與不確定保存資訊，不捏造聯絡地址", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("資料使用說明");
    expect(screen.getByText(/不是已核定的正式隱私政策/)).toBeVisible();
    expect(screen.getByText(/備份保存期限/)).toBeVisible();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    for (const link of screen.getAllByRole("link")) expect(link).toHaveClass("min-h-11");
  });

  it("支援頁提供可逆處理步驟，不假稱有正式客服管道", () => {
    render(<SupportPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("使用說明與支援狀態");
    expect(screen.getByText(/尚未確認正式對外聯絡方式/)).toBeVisible();
    expect(screen.getByText(/不要提供密碼/)).toBeVisible();
  });

  it("列出的資料與用途具有可查核的程式依據", () => {
    expect(informationEvidence.every((evidence) => !evidence.path.startsWith("ios/"))).toBe(true);
    for (const evidence of informationEvidence) {
      const source = readFileSync(evidence.path, "utf8");
      for (const marker of evidence.markers) expect(source).toContain(marker);
    }
  });
});
