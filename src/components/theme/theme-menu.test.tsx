import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    vi.stubGlobal("fetch", vi.fn());
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

  it("shows the private system-admin entry only when the server authorizes it", () => {
    const { rerender } = render(
      <ThemeMenu displayName="合成使用者" initial="合" />,
    );
    expect(
      screen.queryByRole("link", { name: "使用者管理" }),
    ).not.toBeInTheDocument();

    rerender(
      <ThemeMenu
        displayName="合成使用者"
        initial="合"
        adminHref="/admin/users"
      />,
    );
    expect(screen.getByRole("link", { name: "使用者管理" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
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

  it("prefers a custom avatar, then restores the Google account picture", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ removed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <ThemeMenu
        displayName="合成使用者"
        initial="合"
        googleAvatarUrl="https://lh3.googleusercontent.com/a/google"
        customAvatarUrl="/api/profile/avatar?v=old"
      />,
    );

    expect(screen.getByTestId("account-avatar-image")).toHaveAttribute(
      "src",
      "/api/profile/avatar?v=old",
    );
    fireEvent.click(screen.getByLabelText(/開啟帳號與外觀選單/));
    expect(screen.getByText("目前使用自訂頭像")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "恢復 Google 頭像" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/profile/avatar", {
        method: "DELETE",
        credentials: "same-origin",
      });
    });
    expect(screen.getByTestId("account-avatar-image")).toHaveAttribute(
      "src",
      "https://lh3.googleusercontent.com/a/google",
    );
    expect(screen.getByText("已恢復使用 Google 帳號頭像。")).toBeVisible();
  });

  it("uploads a selected image and switches to the custom avatar", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ updatedAt: "2026-08-23T15:00:00.000Z" }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    render(
      <ThemeMenu
        displayName="合成使用者"
        initial="合"
        googleAvatarUrl="https://lh3.googleusercontent.com/a/google"
      />,
    );
    fireEvent.click(screen.getByLabelText(/開啟帳號與外觀選單/));

    const file = new File([Uint8Array.from([1, 2, 3])], "avatar.png", {
      type: "image/png",
    });
    fireEvent.change(screen.getByLabelText("選擇自訂頭像"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      "/api/profile/avatar",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: expect.any(FormData),
      }),
    );
    expect(screen.getByTestId("account-avatar-image")).toHaveAttribute(
      "src",
      "/api/profile/avatar?v=2026-08-23T15%3A00%3A00.000Z",
    );
    expect(screen.getByText("已更新自訂頭像。")).toBeVisible();
  });
});
