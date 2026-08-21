import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("next-auth/react", () => ({ signOut }));

import { SignOutButton } from "./sign-out-button";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("SignOutButton", () => {
  it("keeps the header action at least 44px tall", () => {
    render(<SignOutButton />);

    expect(screen.getByRole("button", { name: "登出" })).toHaveClass(
      "min-h-11",
    );
  });

  it("returns to the deployment base path after sign-out", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole("button", { name: "登出" }));

    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/VowBook" });
  });
});
