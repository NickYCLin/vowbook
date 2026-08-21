import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { sessionProvider } = vi.hoisted(() => ({ sessionProvider: vi.fn() }));

vi.mock("next-auth/react", () => ({
  SessionProvider: (props: { basePath: string; children: React.ReactNode }) => {
    sessionProvider(props);
    return props.children;
  },
}));

import { AuthSessionProvider } from "./auth-session-provider";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("AuthSessionProvider", () => {
  it("configures the NextAuth client API under /VowBook", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");

    render(
      <AuthSessionProvider>
        <span>內容</span>
      </AuthSessionProvider>,
    );

    expect(screen.getByText("內容")).toBeInTheDocument();
    expect(sessionProvider).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "/VowBook/api/auth" }),
    );
  });
});
