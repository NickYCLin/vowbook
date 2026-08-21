import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getServerSession, redirect } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button>登出</button>,
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
  });
});
