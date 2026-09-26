import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, requireCurrentUser } = vi.hoisted(() => ({
  findMany: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany } } }));

import {
  configuredSystemAdminEmailHashes,
  deleteSystemUser,
  isSystemAdmin,
  listSystemUsers,
  requireSystemAdmin,
  SystemAdminAccessDeniedError,
  SystemAdminConfigurationError,
  SystemAdminDeleteConfirmationError,
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
        createdWorkspaces: [
          {
            id: "workspace_2",
            name: "自己開的婚宴",
            _count: { memberships: 2, guests: 74 },
          },
        ],
      },
    ]);

    await expect(listSystemUsers()).resolves.toMatchObject([
      {
        createdWorkspaces: [
          { id: "workspace_2", name: "自己開的婚宴", memberCount: 2, guestCount: 74 },
        ],
      },
    ]);
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

describe("system admin user deletion", () => {
  function deleteClientFor(target: typeof owner | null, count = 1) {
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue(target),
        deleteMany: vi.fn().mockResolvedValue({ count }),
      },
      weddingWorkspace: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      budgetAttachment: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      workspaceInvitation: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }

  const target = {
    ...owner,
    id: "user_2",
    email: "Guest@Example.com",
    version: 5,
  };

  it("刪掉他建立的婚宴、別處的上傳與邀請，最後才刪帳號", async () => {
    const client = deleteClientFor(target);

    await expect(
      deleteSystemUser(owner, target.id, 5, "guest@example.com", client),
    ).resolves.toBeUndefined();

    expect(client.weddingWorkspace.deleteMany).toHaveBeenCalledWith({
      where: { createdById: "user_2" },
    });
    expect(client.budgetAttachment.deleteMany).toHaveBeenCalledWith({
      where: { uploadedByUserId: "user_2" },
    });
    expect(client.workspaceInvitation.updateMany).toHaveBeenCalledWith({
      where: { acceptedByUserId: "user_2" },
      data: { acceptedByUserId: null },
    });
    expect(client.workspaceInvitation.deleteMany).toHaveBeenCalledWith({
      where: { invitedByUserId: "user_2" },
    });
    expect(client.user.deleteMany).toHaveBeenCalledWith({
      where: { id: "user_2", version: 5 },
    });
  });

  it("確認 Email 不一致就完全不動任何資料", async () => {
    const client = deleteClientFor(target);

    await expect(
      deleteSystemUser(owner, target.id, 5, "someone-else@example.com", client),
    ).rejects.toBeInstanceOf(SystemAdminDeleteConfirmationError);
    expect(client.weddingWorkspace.deleteMany).not.toHaveBeenCalled();
    expect(client.user.deleteMany).not.toHaveBeenCalled();
  });

  it("管理者不能刪自己，也不能刪其他管理者", async () => {
    const own = deleteClientFor(owner);
    await expect(
      deleteSystemUser(owner, owner.id, 0, owner.email, own),
    ).rejects.toBeInstanceOf(SystemAdminProtectedUserError);
    expect(own.user.deleteMany).not.toHaveBeenCalled();

    const otherAdmin = deleteClientFor({ ...owner, id: "user_admin_2" });
    await expect(
      deleteSystemUser(owner, "user_admin_2", 0, owner.email, otherAdmin),
    ).rejects.toBeInstanceOf(SystemAdminProtectedUserError);
    expect(otherAdmin.user.deleteMany).not.toHaveBeenCalled();
  });

  it("版本對不上就當成別人剛改過，不刪", async () => {
    const stale = deleteClientFor(target);
    await expect(
      deleteSystemUser(owner, target.id, 4, "guest@example.com", stale),
    ).rejects.toBeInstanceOf(SystemAdminStaleWriteError);
    expect(stale.weddingWorkspace.deleteMany).not.toHaveBeenCalled();

    const missing = deleteClientFor(null);
    await expect(
      deleteSystemUser(owner, target.id, 5, "guest@example.com", missing),
    ).rejects.toBeInstanceOf(SystemAdminStaleWriteError);

    const raced = deleteClientFor(target, 0);
    await expect(
      deleteSystemUser(owner, target.id, 5, "guest@example.com", raced),
    ).rejects.toBeInstanceOf(SystemAdminStaleWriteError);
  });
});
