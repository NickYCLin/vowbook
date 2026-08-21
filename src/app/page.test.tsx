import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/sign-in-button", () => ({
  SignInButton: ({ className }: { className?: string }) => (
    <button className={className}>使用 Google 登入</button>
  ),
}));

import HomePage, { dynamic } from "./page";

/** 從 globals.css 的 @theme 讀出 design token 的實際色值。 */
function readColorToken(name: string): string {
  const css = readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`, "u").exec(
    css,
  );
  if (!match) {
    throw new Error(`找不到 --color-${name}`);
  }
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  );
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const dark = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (light + 0.05) / (dark + 0.05);
}

describe("HomePage", () => {
  it("prevents shared HTML caching across deployment-hashed asset revisions", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses AA normal-text contrast for small copy directly on the paper background", () => {
    render(<HomePage />);

    // 小字級的次要說明都用 text-ink-soft，直接鋪在 paper 背景上。
    expect(screen.getByText("開放註冊・資料依工作區隔離")).toHaveClass(
      "text-ink-soft",
    );
    expect(
      screen.getByText("把重要的事，留在彼此都找得到的地方。").parentElement,
    ).toHaveClass("text-ink-soft");

    // 直接量測 token 的實際對比，避免改色票時悄悄掉到 AA 以下。
    expect(
      contrastRatio(readColorToken("ink-soft"), readColorToken("paper")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(readColorToken("ink"), readColorToken("paper")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(readColorToken("ink-soft"), readColorToken("surface")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
