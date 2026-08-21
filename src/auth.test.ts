import type { NextAuthOptions } from "next-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

const { queryRaw, resolveCurrentUserIdentityWithClaims } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  resolveCurrentUserIdentityWithClaims: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: queryRaw },
}));
vi.mock("@/lib/current-user-claim", () => ({
  resolveCurrentUserIdentityWithClaims,
}));

type SignInParams = Parameters<
  NonNullable<NonNullable<NextAuthOptions["callbacks"]>["signIn"]>
>[0];
type JwtParams = Parameters<
  NonNullable<NonNullable<NextAuthOptions["callbacks"]>["jwt"]>
>[0];
type SessionParams = Parameters<
  NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>
>[0];
type GoogleProfile = NonNullable<SignInParams["profile"]> & {
  email_verified?: boolean;
};

function googleProfile(
  overrides: Partial<GoogleProfile> = {},
): GoogleProfile {
  return {
    email: "verified@example.com",
    email_verified: true,
    ...overrides,
  };
}

async function runSignIn(overrides: Partial<SignInParams> = {}) {
  const { authOptions } = await import("./auth");
  const signIn = authOptions.callbacks?.signIn;
  if (!signIn) {
    throw new Error("Expected NextAuth signIn callback");
  }

  const params = {
    user: {
      id: "oauth_user",
      name: "OAuth user",
      email: "untrusted-session@example.com",
      image: null,
    },
    account: {
      provider: "google",
      type: "oauth",
      providerAccountId: "google_subject",
    },
    profile: googleProfile(),
    ...overrides,
  } satisfies SignInParams;

  return signIn(params);
}

async function runJwt(overrides: Partial<JwtParams> = {}) {
  const { authOptions } = await import("./auth");
  const jwt = authOptions.callbacks?.jwt;
  if (!jwt) {
    throw new Error("Expected NextAuth jwt callback");
  }

  return jwt({
    token: {},
    user: {
      id: "oauth_user",
      name: "OAuth user",
      email: "verified@example.com",
    },
    account: {
      provider: "google",
      type: "oauth",
      providerAccountId: "google_subject",
    },
    profile: googleProfile(),
    trigger: "signIn",
    ...overrides,
  } as JwtParams);
}

async function runSession(overrides: Partial<SessionParams> = {}) {
  const { authOptions } = await import("./auth");
  const session = authOptions.callbacks?.session;
  if (!session) {
    throw new Error("Expected NextAuth session callback");
  }

  return session({
    session: {
      expires: "2099-01-01",
      user: {
        name: "OAuth user",
        email: "verified@example.com",
      },
    },
    token: {},
    ...overrides,
  } as SessionParams);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("NextAuth base path config", () => {
  it("keeps the custom sign-in page under /VowBook", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");
    vi.stubEnv(
      "NEXTAUTH_URL",
      "https://example.com/VowBook/api/auth",
    );

    const { authOptions } = await import("./auth");

    expect(authOptions.pages?.signIn).toBe("/VowBook/signin");
    expect(authOptions.cookies).toBeDefined();
    expect(Object.values(authOptions.cookies ?? {})).toHaveLength(6);
    for (const cookie of Object.values(authOptions.cookies ?? {})) {
      expect(cookie.name).toMatch(/^__Secure-vowbook\./);
      expect(cookie.options).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/VowBook",
        secure: true,
      });
    }
  });

  it("keeps the custom sign-in page root-relative for local development", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { authOptions } = await import("./auth");

    expect(authOptions.pages?.signIn).toBe("/signin");
    expect(authOptions.cookies).toBeUndefined();
  });
});

describe("NextAuth Google sign-in verification gate", () => {
  it("allows a Google account with a non-empty verified profile email", async () => {
    await expect(runSignIn()).resolves.toBe(true);
  });

  it("rejects an unverified or unverifiable Google profile", async () => {
    await expect(
      runSignIn({
        profile: googleProfile({ email_verified: false }),
      }),
    ).resolves.toBe(false);
    await expect(
      runSignIn({
        profile: googleProfile({ email_verified: undefined }),
      }),
    ).resolves.toBe(false);
  });

  it("rejects a missing Google profile", async () => {
    await expect(runSignIn({ profile: undefined })).resolves.toBe(false);
  });

  it("rejects a Google profile with a missing or blank email", async () => {
    await expect(
      runSignIn({ profile: googleProfile({ email: undefined }) }),
    ).resolves.toBe(false);
    await expect(
      runSignIn({ profile: googleProfile({ email: "   " }) }),
    ).resolves.toBe(false);
  });

  it("rejects a missing account or provider account id", async () => {
    await expect(runSignIn({ account: null })).resolves.toBe(false);
    await expect(
      runSignIn({
        account: {
          provider: "google",
          type: "oauth",
          providerAccountId: "",
        },
      }),
    ).resolves.toBe(false);
  });

  it("rejects a non-Google provider even with a verified profile", async () => {
    await expect(
      runSignIn({
        account: {
          provider: "credentials",
          type: "credentials",
          providerAccountId: "forged_subject",
        },
      }),
    ).resolves.toBe(false);
  });
});

describe("NextAuth server-signed Google email verification proof", () => {
  it("stamps the subject and PostgreSQL time only from a verified raw Google sign-in profile", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
    queryRaw.mockResolvedValueOnce([
      { databaseNow: new Date("2026-07-29T02:03:04.567Z") },
    ]);
    resolveCurrentUserIdentityWithClaims.mockResolvedValueOnce({
      acceptedInvitationCount: 2,
      user: { id: "user_1" },
    });

    await expect(runJwt()).resolves.toMatchObject({
      googleSubject: "google_subject",
      googleEmailVerifiedAt: 1785290584567,
      googleVerifiedEmail: "verified@example.com",
      googleInvitationClaimCompletedAt: 1785290584567,
      invitationNotice: { count: 2 },
    });
    expect(queryRaw).toHaveBeenCalledOnce();
    const sql = Array.from(
      queryRaw.mock.calls[0][0] as TemplateStringsArray,
    ).join("?");
    expect(sql).toMatch(/SELECT\s+CURRENT_TIMESTAMP\s+AS\s+"databaseNow"/u);
    expect(resolveCurrentUserIdentityWithClaims).toHaveBeenCalledWith({
      googleSubject: "google_subject",
      emailVerifiedAt: 1785290584567,
      email: "verified@example.com",
      name: "OAuth user",
      image: null,
    });
  });

  it("fails closed when PostgreSQL cannot mint the verification timestamp", async () => {
    const databaseFailure = new Error("database unavailable");
    queryRaw.mockRejectedValueOnce(databaseFailure);

    await expect(runJwt()).rejects.toBe(databaseFailure);
  });

  it.each([
    ["missing profile", undefined],
    ["unverified profile", googleProfile({ email_verified: false })],
    ["missing verification", googleProfile({ email_verified: undefined })],
    ["missing email", googleProfile({ email: undefined })],
    ["blank email", googleProfile({ email: "   " })],
  ])("does not stamp proof for %s", async (_label, profile) => {
    const token = { existing: "preserved" };

    await expect(runJwt({ token, profile })).resolves.toEqual(token);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("invalidates a legacy VowBook identity token that has no matching one-shot claim marker", async () => {
    const token = {
      sub: "nextauth_subject",
      email: "legacy@example.com",
      googleSubject: "google_subject",
      googleEmailVerifiedAt: 123456,
      googleVerifiedEmail: "legacy@example.com",
      invitationNotice: { id: "legacy_notice", count: 1 },
    };

    const result = await runJwt({
      token,
      user: undefined,
      account: null,
      profile: undefined,
      trigger: undefined,
    } as Partial<JwtParams>);

    expect(result).toMatchObject({
      sub: "nextauth_subject",
      email: "legacy@example.com",
    });
    expect(result).not.toHaveProperty("googleSubject");
    expect(result).not.toHaveProperty("googleEmailVerifiedAt");
    expect(result).not.toHaveProperty("googleVerifiedEmail");
    expect(result).not.toHaveProperty("googleInvitationClaimCompletedAt");
    expect(result).not.toHaveProperty("invitationNotice");
    expect(queryRaw).not.toHaveBeenCalled();
    expect(resolveCurrentUserIdentityWithClaims).not.toHaveBeenCalled();
  });

  it("does not accept proof or subject from a client session update", async () => {
    const token = { existing: "preserved" };

    await expect(
      runJwt({
        token,
        account: null,
        profile: undefined,
        trigger: "update",
        session: {
          googleSubject: "forged_subject",
          googleEmailVerifiedAt: Date.now(),
        },
      } as Partial<JwtParams>),
    ).resolves.toEqual(token);
  });

  it("only clears the exact server-issued invitation notice from a client session update", async () => {
    const token = {
      googleSubject: "google_subject",
      googleEmailVerifiedAt: 123456,
      googleInvitationClaimCompletedAt: 123456,
      invitationNotice: { id: "notice_1", count: 1 },
    };

    await expect(
      runJwt({
        token,
        account: null,
        profile: undefined,
        trigger: "update",
        session: { dismissedInvitationNoticeId: "wrong_notice" },
      } as Partial<JwtParams>),
    ).resolves.toEqual(token);

    await expect(
      runJwt({
        token,
        account: null,
        profile: undefined,
        trigger: "update",
        session: { dismissedInvitationNoticeId: "notice_1" },
      } as Partial<JwtParams>),
    ).resolves.not.toHaveProperty("invitationNotice");
    expect(token).toMatchObject({
      googleSubject: "google_subject",
      googleEmailVerifiedAt: 123456,
      googleInvitationClaimCompletedAt: 123456,
    });
  });

  it("exposes only finite numeric verification timestamps from the JWT", async () => {
    await expect(
      runSession({
        token: {
          googleSubject: "google_subject",
          googleEmailVerifiedAt: 123456,
          googleVerifiedEmail: "Canonical@Example.COM",
          googleInvitationClaimCompletedAt: 123456,
          invitationNotice: { id: "notice_1", count: 2 },
        },
      }),
    ).resolves.toMatchObject({
      user: {
        googleSubject: "google_subject",
        googleEmailVerifiedAt: 123456,
        googleInvitationClaimCompletedAt: 123456,
        email: "Canonical@Example.COM",
      },
      invitationNotice: { id: "notice_1", count: 2 },
    });

    for (const invalidProof of [Number.NaN, Number.POSITIVE_INFINITY, "123"]) {
      const session = await runSession({
        session: {
          expires: "2099-01-01",
          user: {
            email: "verified@example.com",
            googleEmailVerifiedAt: 999999,
          },
        },
        token: {
          googleSubject: "google_subject",
          googleEmailVerifiedAt: invalidProof,
        },
      } as Partial<SessionParams>);
      expect(session.user).not.toHaveProperty("googleEmailVerifiedAt");
    }
  });

  it("never treats an arbitrary session email as the fresh verified Google email", async () => {
    const session = await runSession({
      session: {
        expires: "2099-01-01",
        user: {
          email: "client-session@example.com",
        },
      },
      token: {
        googleSubject: "google_subject",
        googleEmailVerifiedAt: 123456,
      },
    });

    expect(session.user).not.toHaveProperty("googleEmailVerifiedAt");
    expect(session.user?.email).toBe("client-session@example.com");
  });

  it("does not preserve custom identity fields that are absent from the JWT", async () => {
    const session = await runSession({
      session: {
        expires: "2099-01-01",
        user: {
          email: "verified@example.com",
          googleSubject: "forged_subject",
          googleEmailVerifiedAt: 999999,
        },
      },
      token: {},
    });

    expect(session.user).not.toHaveProperty("googleSubject");
    expect(session.user).not.toHaveProperty("googleEmailVerifiedAt");
  });
});
