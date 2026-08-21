import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSession, resolveCurrentUserIdentity } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolveCurrentUserIdentity: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/current-user-claim", () => ({ resolveCurrentUserIdentity }));

import { getApiCurrentUser } from "./api-current-user";

const user = {
  id: "user_1",
  googleSubject: "google_123",
  email: "canonical@example.com",
  name: "既有使用者",
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("getApiCurrentUser API adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCurrentUserIdentity.mockResolvedValue(user);
  });

  it("uses the same DB-clock subject/proof resolver as pages", async () => {
    const verifiedAt = Date.parse("2026-07-29T02:00:00.000Z");
    getServerSession.mockResolvedValue({
      expires: "2099-01-01",
      user: {
        googleSubject: "google_123",
        googleEmailVerifiedAt: verifiedAt,
        email: "Fresh-Api@Example.COM",
        name: "新名稱",
        image: null,
      },
    });

    await expect(getApiCurrentUser()).resolves.toBe(user);
    expect(resolveCurrentUserIdentity).toHaveBeenCalledWith({
      googleSubject: "google_123",
      emailVerifiedAt: verifiedAt,
      email: "Fresh-Api@Example.COM",
      name: "新名稱",
      image: null,
    });
  });

  it("maps only a missing or unresolved identity to null", async () => {
    getServerSession.mockResolvedValue(null);
    await expect(getApiCurrentUser()).resolves.toBeNull();

    getServerSession.mockResolvedValueOnce({
      expires: "2099-01-01",
      user: { googleSubject: "google_123" },
    });
    resolveCurrentUserIdentity.mockResolvedValueOnce(null);
    await expect(getApiCurrentUser()).resolves.toBeNull();

    const databaseFailure = new Error("database failed");
    getServerSession.mockResolvedValueOnce({
      expires: "2099-01-01",
      user: { googleSubject: "google_123" },
    });
    resolveCurrentUserIdentity.mockRejectedValueOnce(databaseFailure);
    await expect(getApiCurrentUser()).rejects.toBe(databaseFailure);
  });
});
