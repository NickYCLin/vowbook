import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, requireCurrentUser } = vi.hoisted(() => ({
  findMany: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany } } }));

import {
  configuredSystemAdminEmailHashes,
  isSystemAdmin,
  listSystemUsers,
  requireSystemAdmin,
  SystemAdminAccessDeniedError,
  SystemAdminConfigurationError,
  SystemAdminProtectedUserError,
  SystemAdminStaleWriteError,
  systemAdminEmailHash,
  updateSystemUserAccessStatus,
} from "./system-admin";

const owner = {
  id: "user_owner",
  googleSubject: "google_owner",
  email: "Owner@Example.COM",
  name: "站台管理者",
  image: null,
  accessStatus: "ACTIVE" as const,
  accessStatusChangedAt: null,
  lastLoginAt: null,
  version: 0,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv(
    "VOWBOOK_ADMIN_EMAIL_HASHES",
    systemAdminEmailHash(owner.email),
  );
  requireCurrentUser.mockResolvedValue(owner);
  findMany.mockResolvedValue([]);
});

describe("system admin allowlist", () => {
  it("normalizes email identity before hashing and accepts lowercase hash lists", () => {
    expect(systemAdminEmailHash("  OWNER@example.com ")).toBe(
      systemAdminEmailHash("owner@example.com"),
    );
    const hash = systemAdminEmailHash(owner.email);
    expect(
      configuredSystemAdminEmailHashes(` ${hash.toUpperCase()},${hash} `),
    ).toEqual(new Set([hash]));
    expect(isSystemAdmin(owner)).toBe(true);
  });

  it("fails closed for missing, malformed, suspended, or removed admins", async () => {
    expect(configuredSystemAdminEmailHashes("")).toEqual(new Set());
    expect(() => configuredSystemAdminEmailHashes("not-a-hash")).toThrow(
      SystemAdminConfigurationError,
    );
    expect(() =>
      isSystemAdmin({ ...owner, accessStatus: "SUSPENDED" }),
    ).not.toThrow();
    expect(isSystemAdmin({ ...owner, accessStatus: "SUSPENDED" })).toBe(false);
    vi.stubEnv("VOWBOOK_ADMIN_EMAIL_HASHES", "");
    await expect(requireSystemAdmin()).rejects.toBeInstanceOf(
      SystemAdminAccessDeniedError,
    );
  });

  it("authorizes before listing users and never selects Google subject identifiers", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "user_2",
        email: "guest@example.com",
        name: "一般使用者",
        image: null,
        accessStatus: "ACTIVE",
        accessStatusChangedAt: null,
        lastLoginAt: null,
        version: 2,
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        memberships: [
          {
            role: "PARTNER",
            workspace: { id: "workspace_1", name: "我們的婚宴" },
          },
        ],
      },
    ]);

    await expect(listSystemUsers()).resolves.toHaveLength(1);
    expect(requireCurrentUser).toHaveBeenCalledOnce();
    const query = findMany.mock.calls[0]?.[0];
    expect(query.select).not.toHaveProperty("googleSubject");
    expect(query.select.memberships.select).not.toHaveProperty("userId");

    requireCurrentUser.mockResolvedValueOnce({
      ...owner,
      email: "outsider@example.com",
    });
    await expect(listSystemUsers()).rejects.toBeInstanceOf(
      SystemAdminAccessDeniedError,
    );
    expect(findMany).toHaveBeenCalledOnce();
  });
});

describe("system admin user access updates", () => {
  function clientFor(target: typeof owner | null, count = 1) {
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue(target),
        updateMany: vi.fn().mockResolvedValue({ count }),
      },
    };
  }

  it("never lets an admin suspend or remove themselves", async () => {
    const client = clientFor(owner);

    await expect(
      updateSystemUserAccessStatus(
        owner,
        owner.id,
        0,
        "SUSPENDED",
        client,
      ),
    ).rejects.toBeInstanceOf(SystemAdminProtectedUserError);
    expect(client.user.updateMany).not.toHaveBeenCalled();
  });

  it("also protects every configured admin identity", async () => {
    const secondAdmin = { ...owner, id: "user_admin_2" };
    const client = clientFor(secondAdmin);

    await expect(
      updateSystemUserAccessStatus(
        owner,
        secondAdmin.id,
        0,
        "REMOVED",
        client,
      ),
    ).rejects.toBeInstanceOf(SystemAdminProtectedUserError);
  });

  it("uses optimistic versioning and leaves memberships untouched", async () => {
    const target = {
      ...owner,
      id: "user_2",
      email: "guest@example.com",
      version: 4,
    };
    const client = clientFor(target);

    await expect(
      updateSystemUserAccessStatus(
        owner,
        target.id,
        4,
        "SUSPENDED",
        client,
      ),
    ).resolves.toBeUndefined();
    expect(client.user.updateMany).toHaveBeenCalledWith({
      where: { id: target.id, version: 4 },
      data: {
        accessStatus: "SUSPENDED",
        accessStatusChangedAt: expect.any(Date),
        version: { increment: 1 },
      },
    });
    expect(client).not.toHaveProperty("membership");
  });

  it("reports a stale write without overwriting a newer decision", async () => {
    const target = {
      ...owner,
      id: "user_2",
      email: "guest@example.com",
      version: 5,
    };
    const client = clientFor(target, 0);

    await expect(
      updateSystemUserAccessStatus(
        owner,
        target.id,
        4,
        "ACTIVE",
        client,
      ),
    ).rejects.toBeInstanceOf(SystemAdminStaleWriteError);
  });
});
