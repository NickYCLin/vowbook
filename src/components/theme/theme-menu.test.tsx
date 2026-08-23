import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { ThemeMenu } from "./theme-menu";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("next-auth/react", () => ({ signOut }));

describe("ThemeMenu", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-preference");
    vi.clearAllMocks();
  });

  it("shows every theme choice in the signed-in account menu", () => {
    render(<ThemeMenu displayName="合成使用者" initial="合" />);

    const summary = screen.getByLabelText(/開啟帳號與外觀選單/);
    expect(within(summary).getByText("誓約紙本", { exact: true })).toBeVisible();
    fireEvent.click(summary);

    const group = screen.getByRole("group", { name: "外觀主題" });
    for (const label of [
      "誓約紙本",
      "晨霧花園",
      "深林誓言",
      "星夜宴會",
      "跟隨系統",
    ]) {
      expect(within(group).getByRole("radio", { name: label })).toBeVisible();
    }
    expect(screen.getByText("只套用在這台裝置")).toBeVisible();
  });

  it("persists and immediately applies the selected device theme", () => {
    render(<ThemeMenu displayName="合成使用者" initial="合" />);

    fireEvent.click(screen.getByRole("radio", { name: "晨霧花園" }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("morning-mist");
    expect(document.documentElement).toHaveAttribute(
      "data-theme",
      "morning-mist",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-theme-preference",
      "morning-mist",
    );
    expect(
      screen.getByLabelText(/目前為晨霧花園/),
    ).toBeVisible();
  });
});
