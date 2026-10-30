import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ begin: vi.fn(), signIn: vi.fn() }));
vi.mock("./actions", () => ({ beginGoogleLink: mocks.begin }));
vi.mock("next-auth/react", () => ({ signIn: mocks.signIn }));
import { GoogleLinkButton } from "./link-button";

describe("Google account-link consent", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("requires an explicit click and a valid challenge before starting OAuth", async () => {
    render(<GoogleLinkButton nonce={"n".repeat(43)} />);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "選擇要連結的 Google 帳號" }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("google", {
      callbackUrl: expect.stringContaining("/mobile/link/google/complete"),
    }, { prompt: "select_account" }));
    expect(mocks.begin).toHaveBeenCalledWith("n".repeat(43));
  });

  it("does not fall back to normal login when the challenge fails", async () => {
    mocks.begin.mockRejectedValue(new Error("expired"));
    render(<GoogleLinkButton nonce={"n".repeat(43)} />);
    fireEvent.click(screen.getByRole("button", { name: "選擇要連結的 Google 帳號" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("請關閉視窗並從 App 設定重新開始");
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});
