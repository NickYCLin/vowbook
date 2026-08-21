import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signInButton } = vi.hoisted(() => ({ signInButton: vi.fn() }));

vi.mock("@/components/auth/sign-in-button", () => ({
  SignInButton: (props: { callbackUrl: string }) => {
    signInButton(props);
    return <button type="button">使用 Google 登入</button>;
  },
}));

import SignInPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function renderSignInPage(error?: string | string[]) {
  render(
    await SignInPage({
      searchParams: Promise.resolve(error === undefined ? {} : { error }),
    }),
  );
}

describe("SignInPage authentication errors", () => {
  it.each([
    ["OAuthSignin", "Google 登入未能完成，請稍後再試。"],
    ["AccessDenied", "此帳號目前無法登入誓約簿，請確認授權後再試。"],
    ["Configuration", "登入服務目前無法使用，請稍後再試。"],
  ])("shows a safe Traditional Chinese message for %s", async (code, message) => {
    await renderSignInPage(code);

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(document.body).not.toHaveTextContent(code);
  });

  it("uses a generic safe message without echoing an unknown query value", async () => {
    const untrustedCode = "internal database host:5432 <script>alert(1)</script>";

    await renderSignInPage(untrustedCode);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登入未能完成，請稍後再試。",
    );
    expect(document.body).not.toHaveTextContent(untrustedCode);
    expect(document.body).not.toHaveTextContent("internal database host");
  });

  it("does not render an alert when no authentication error is present", async () => {
    await renderSignInPage();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SignInPage callback normalization", () => {
  it.each(["/dashboard", "/VowBook/dashboard"])(
    "keeps %s inside the deployment base path without double-prefixing",
    async (callbackUrl) => {
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");

      render(
        await SignInPage({
          searchParams: Promise.resolve({ callbackUrl }),
        }),
      );

      expect(signInButton).toHaveBeenCalledWith(
        expect.objectContaining({ callbackUrl: "/VowBook/dashboard" }),
      );
    },
  );

  it("uses the base-path dashboard fallback for an external callback", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");

    render(
      await SignInPage({
        searchParams: Promise.resolve({
          callbackUrl: "https://attacker.example/steal",
        }),
      }),
    );

    expect(signInButton).toHaveBeenCalledWith(
      expect.objectContaining({ callbackUrl: "/VowBook/dashboard" }),
    );
  });
});
