import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findCurrentUserByGoogleSubject,
  getServerSession,
  hasPendingInvitationAfterProof,
  redirect,
  resolveCurrentUserIdentity,
} = vi.hoisted(() => ({
  findCurrentUserByGoogleSubject: vi.fn(),
  getServerSession: vi.fn(),
  hasPendingInvitationAfterProof: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  resolveCurrentUserIdentity: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/current-user-claim", () => ({
  findCurrentUserByGoogleSubject,
  hasPendingInvitationAfterProof,
  resolveCurrentUserIdentity,
}));

import {
  AuthenticationRequiredError,
  requireCurrentUser,
  requireCurrentUserContext,
  resolveCurrentUser,
} from "./current-user";

const user = {
  id: "user_1",
  googleSubject: "google_123",
  email: "canonical@example.com",
  name: "王小明",
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const session = {
  expires: "2099-01-01",
  user: {
    googleSubject: "google_123",
    googleEmailVerifiedAt: Date.parse("2026-07-29T02:00:00.000Z"),
    email: "Fresh@Example.COM",
    name: "新名稱",
    image: "https://example.test/avatar.png",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  findCurrentUserByGoogleSubject.mockResolvedValue(user);
  hasPendingInvitationAfterProof.mockResolvedValue(false);
  resolveCurrentUserIdentity.mockResolvedValue(user);
});

describe("redirect-neutral current-user resolver", () => {
  it("rejects a missing Google subject without touching persistence", async () => {
    await expect(resolveCurrentUser(null)).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
    expect(resolveCurrentUserIdentity).not.toHaveBeenCalled();
  });

  it("delegates proof freshness and claim to the serializable DB-clock resolver", async () => {
    await expect(resolveCurrentUser(session)).resolves.toBe(user);
    expect(resolveCurrentUserIdentity).toHaveBeenCalledWith({
      googleSubject: "google_123",
      emailVerifiedAt: session.user.googleEmailVerifiedAt,
      email: "Fresh@Example.COM",
      name: "新名稱",
      image: "https://example.test/avatar.png",
    });
  });

  it("uses a subject-only lookup after this signed proof already completed invitation claim", async () => {
    const resolvedSession = {
      ...session,
      user: {
        ...session.user,
        googleInvitationClaimCompletedAt:
          session.user.googleEmailVerifiedAt,
      },
    };

    await expect(resolveCurrentUser(resolvedSession)).resolves.toBe(user);
    expect(findCurrentUserByGoogleSubject).toHaveBeenCalledWith(
      "google_123",
    );
    expect(resolveCurrentUserIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["old", Date.parse("2026-07-29T01:00:00.000Z")],
    ["future", Date.parse("2099-01-01T00:00:00.000Z")],
  ])(
    "never uses the application clock for a %s proof",
    async (_label, googleEmailVerifiedAt) => {
      const candidate = {
        ...session,
        user: {
          ...session.user,
          googleEmailVerifiedAt,
        },
      };

      await expect(resolveCurrentUser(candidate)).resolves.toBe(user);
      expect(resolveCurrentUserIdentity).toHaveBeenCalledWith({
        googleSubject: "google_123",
        emailVerifiedAt: googleEmailVerifiedAt,
        email: "Fresh@Example.COM",
        name: "新名稱",
        image: "https://example.test/avatar.png",
      });
    },
  );

  it("requires authentication when the DB-clock resolver finds no subject", async () => {
    resolveCurrentUserIdentity.mockResolvedValueOnce(null);

    await expect(resolveCurrentUser(session)).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });
});

describe("requireCurrentUser page adapter", () => {
  it("redirects authentication requirements with a safe callback", async () => {
    getServerSession.mockResolvedValue(null);

    await expect(requireCurrentUser()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith(
      "/signin?callbackUrl=%2Fdashboard",
    );
  });

  it("uses the same DB-clock identity resolver for pages", async () => {
    getServerSession.mockResolvedValue(session);

    await expect(requireCurrentUser()).resolves.toBe(user);
    expect(resolveCurrentUserIdentity).toHaveBeenCalledOnce();
    expect(hasPendingInvitationAfterProof).not.toHaveBeenCalled();
  });

  it("adds only a boolean pending-invitation confirmation to dashboard context", async () => {
    const completedSession = {
      ...session,
      user: {
        ...session.user,
        googleInvitationClaimCompletedAt:
          session.user.googleEmailVerifiedAt,
      },
    };
    getServerSession.mockResolvedValue(completedSession);
    hasPendingInvitationAfterProof.mockResolvedValueOnce(true);

    await expect(requireCurrentUserContext()).resolves.toEqual({
      currentUser: user,
      invitationNotice: null,
      pendingInvitationConfirmation: true,
    });
    expect(hasPendingInvitationAfterProof).toHaveBeenCalledWith(
      "Fresh@Example.COM",
      session.user.googleEmailVerifiedAt,
    );
    expect(findCurrentUserByGoogleSubject).toHaveBeenCalledOnce();
  });

  it("does not turn session or database failures into redirects", async () => {
    const sessionFailure = new Error("session lookup failed");
    getServerSession.mockRejectedValueOnce(sessionFailure);
    await expect(requireCurrentUser()).rejects.toBe(sessionFailure);

    const databaseFailure = new Error("database unavailable");
    getServerSession.mockResolvedValueOnce(session);
    resolveCurrentUserIdentity.mockRejectedValueOnce(databaseFailure);
    await expect(requireCurrentUser()).rejects.toBe(databaseFailure);
  });
});
