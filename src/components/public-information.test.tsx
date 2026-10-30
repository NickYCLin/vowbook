import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import SupportPage from "@/app/support/page";
import { informationEvidence } from "@/content/service-information";

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get() { throw new Error("公開說明不得讀資料庫"); } }) }));
vi.mock("next-auth", () => ({ getServerSession() { throw new Error("公開說明不得要求登入"); } }));

describe("匿名資料說明與支援頁", () => {
  it("正式隱私政策載明營運主體、生效日期與保存規則，只以 GitHub Issues 聯絡", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("隱私政策");
    expect(screen.getByRole("note")).toHaveTextContent("營運主體：個人「林洋琛」");
    expect(screen.getByRole("note")).toHaveTextContent("生效日期：2026 年 10 月 30 日");
    for (const required of ["台灣", "Docker", "Caddy", "Google OAuth", "Sign in with Apple", "不使用分析、廣告或追蹤", "12 小時", "最新 2 份", "刪除帳號", "密碼", "驗證碼", "token"]) {
      expect(document.body).toHaveTextContent(required);
    }
    const issues = screen.getByRole("link", { name: /前往 GitHub Issues 聯絡/ });
    expect(issues).toHaveAttribute("href", "https://github.com/NickYCLin/vowbook/issues");
    expect(issues).toHaveAttribute("rel", "noopener noreferrer");
    expect(document.body.textContent).not.toMatch(/待維運確認|不是已核定的正式隱私政策|尚待確認/);
    expect(document.body.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    for (const link of screen.getAllByRole("link")) expect(link).toHaveClass("min-h-11");
  });

  it("支援頁以 GitHub Issues 作為回報管道，不提供 Email 也不保留待確認字樣", () => {
    render(<SupportPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("使用說明與支援");
    expect(screen.getByRole("heading", { level: 2, name: "回報問題與測試回饋" })).toBeVisible();
    const issues = screen.getByRole("link", { name: /前往 GitHub Issues 回報問題/ });
    expect(issues).toHaveAttribute("href", "https://github.com/NickYCLin/vowbook/issues");
    expect(issues).toHaveAttribute("rel", "noopener noreferrer");
    for (const required of ["App 版本", "iOS 版本", "裝置型號", "重現步驟", "錯誤訊息", "密碼", "驗證碼", "token", "婚宴賓客", "傳送 Beta 版回饋"]) {
      expect(document.body).toHaveTextContent(required);
    }
    expect(document.body.textContent).not.toMatch(/待維運確認|尚未確認正式對外聯絡方式/);
    expect(document.body.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    for (const link of screen.getAllByRole("link")) expect(link).toHaveClass("min-h-11");
  });

  it("列出的資料與用途具有可查核的程式依據", () => {
    expect(informationEvidence.every((evidence) => !evidence.path.startsWith("ios/"))).toBe(true);
    for (const evidence of informationEvidence) {
      const source = readFileSync(evidence.path, "utf8");
      for (const marker of evidence.markers) expect(source).toContain(marker);
    }
  });
});
