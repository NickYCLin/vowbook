import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock("next-auth/react", () => ({ signIn }));

import { SignInButton } from "./sign-in-button";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("SignInButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  });

  it("recovers from a rejected sign-in attempt and allows retrying", async () => {
    signIn
      .mockRejectedValueOnce(new Error("sensitive provider failure"))
      .mockImplementationOnce(() => new Promise(() => {}));
    render(<SignInButton callbackUrl="/dashboard" />);

    const button = screen.getByRole("button", {
      name: "使用 Google 開始規劃",
    });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("正在前往 Google…");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "polite");
    expect(alert).toHaveTextContent("無法開始 Google 登入，請再試一次。");
    expect(alert).not.toHaveTextContent("sensitive provider failure");
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("使用 Google 開始規劃");

    fireEvent.click(button);

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(signIn).toHaveBeenLastCalledWith(
      "google",
      {
        callbackUrl: "/dashboard",
      },
      { prompt: "select_account" },
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("keeps the existing pending state when sign-in starts successfully", async () => {
    signIn.mockResolvedValue(undefined);
    render(<SignInButton label="登入" />);

    const button = screen.getByRole("button", { name: "登入" });
    fireEvent.click(button);

    await waitFor(() => expect(signIn).toHaveBeenCalledOnce());
    expect(signIn).toHaveBeenCalledWith(
      "google",
      {
        callbackUrl: "/dashboard",
      },
      { prompt: "select_account" },
    );
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("正在前往 Google…");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the callback inside the deployment base path", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");
    signIn.mockResolvedValue(undefined);
    render(<SignInButton callbackUrl="/dashboard" />);

    fireEvent.click(
      screen.getByRole("button", { name: "使用 Google 開始規劃" }),
    );

    await waitFor(() => expect(signIn).toHaveBeenCalledOnce());
    expect(signIn).toHaveBeenCalledWith(
      "google",
      {
        callbackUrl: "/VowBook/dashboard",
      },
      { prompt: "select_account" },
    );
  });
});
