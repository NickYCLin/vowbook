import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";

const mocks = vi.hoisted(() => ({ stage: vi.fn(), signIn: vi.fn(), jwt: vi.fn() }));
vi.mock("@/lib/mobile/account-links", () => ({ stageGoogleAccountLink: mocks.stage }));
import { accountLinkAuthOptions } from "./account-link-auth";

const options: NextAuthOptions = { providers: [], callbacks: { signIn: mocks.signIn, jwt: mocks.jwt } };
const args = { user: { id: "oauth-user" }, account: { provider: "google", providerAccountId: "verified-subject", type: "oauth" as const },
  profile: { email: "verified@example.test", email_verified: true } };

describe("Google linking OAuth isolation", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("leaves ordinary login unchanged without a linking cookie", () => {
    expect(accountLinkAuthOptions(options, undefined)).toBe(options);
  });

  it("returns a redirect before NextAuth can run the normal user-creating JWT callback", async () => {
    const scoped = accountLinkAuthOptions(options, "n".repeat(43));
    const result = await scoped.callbacks!.signIn!(args);
    expect(result).toContain("/mobile/link/google/complete");
    expect(result).not.toContain("failed");
    expect(mocks.stage).toHaveBeenCalledWith("n".repeat(43), "verified-subject", "verified@example.test");
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.jwt).not.toHaveBeenCalled();
  });

  it.each([undefined, false, "true"])("rejects an unverified Google email (%s)", async (email_verified) => {
    const profile = { ...args.profile, email_verified };
    const result = await accountLinkAuthOptions(options, "nonce").callbacks!.signIn!({
      ...args, profile,
    });
    expect(result).toContain("failed=1");
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("never falls back to ordinary account creation on an expired link or database failure", async () => {
    mocks.stage.mockRejectedValue(new Error("expired"));
    expect(await accountLinkAuthOptions(options, "stale").callbacks!.signIn!(args)).toContain("failed=1");
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.jwt).not.toHaveBeenCalled();
  });
});
