import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  findProfileAvatarUpdatedAt,
  getServerSession,
  redirect,
  resolveCurrentUser,
} = vi.hoisted(() => ({
  findProfileAvatarUpdatedAt: vi.fn(),
  getServerSession: vi.fn(),
  redirect: vi.fn(),
  resolveCurrentUser: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/current-user", () => ({ resolveCurrentUser }));
vi.mock("@/lib/profile-avatar", () => ({ findProfileAvatarUpdatedAt }));
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button>登出</button>,
}));
vi.mock("@/components/theme/theme-menu", () => ({
  ThemeMenu: ({
    displayName,
    googleAvatarUrl,
  }: {
    displayName: string;
    googleAvatarUrl: string | null;
  }) => (
    <button>
      外觀主題：{displayName}；頭像：{googleAvatarUrl ?? "無"}
    </button>
  ),
}));

import AppLayout from "./layout";

describe("AppLayout", () => {
  it("links the authenticated Wordmark to the dashboard in the shared max-w-6xl frame", async () => {
    getServerSession.mockResolvedValue({
      user: {
        googleSubject: "synthetic-subject",
        name: "合成使用者",
        email: "synthetic@example.test",
      },
    });
    resolveCurrentUser.mockResolvedValue({
      id: "user_1",
      googleSubject: "synthetic-subject",
      name: "合成使用者",
      email: "synthetic@example.test",
      image: "https://lh3.googleusercontent.com/a/synthetic",
    });
    findProfileAvatarUpdatedAt.mockResolvedValue(null);

    const { container } = render(
      await AppLayout({ children: <main>合成內容</main> }),
    );

    expect(
      screen.getByRole("link", { name: "誓約簿 VowBook 我的婚宴" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(container.querySelector("header > div")).toHaveClass(
      "max-w-6xl",
      "px-5",
      "sm:px-8",
    );
    expect(
      screen.getByText(
        "外觀主題：合成使用者；頭像：https://lh3.googleusercontent.com/a/synthetic",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "登出" }).closest("span")).toHaveClass(
      "hidden",
      "sm:block",
    );
  });
});
