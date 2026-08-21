import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { requireCurrentUser, requireWorkspaceAccess, requireLockedWorkspaceAccess } =
  vi.hoisted(() => ({
    requireCurrentUser: vi.fn(),
    requireWorkspaceAccess: vi.fn(),
    requireLockedWorkspaceAccess: vi.fn(),
  }));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  createWorkspaceInvitation,
  getWorkspaceMembersData,
  removeWorkspaceMember,
  reinviteWorkspaceInvitation,
  revokePendingWorkspaceInvitation,
  updateWorkspaceMemberRole,
  WorkspaceMemberValidationError,
  WorkspaceMembersDataError,
} from "./workspace-invitations";

const operationKey = "8d7fcdcf-2bea-4aa4-89b3-47158efcb40d";

function transactionClient() {
  return {
    $queryRaw: vi.fn(),
  };
}

function serializableClient(transaction: ReturnType<typeof transactionClient>) {
  return {
    $transaction: vi.fn(
      async (
        operation: (client: typeof transaction) => Promise<unknown>,
        options: unknown,
      ) => {
        expect(options).toEqual({ isolationLevel: "Serializable" });
        return operation(transaction);
      },
    ),
  } as unknown as Pick<PrismaClient, "$transaction">;
}

function queryText(mock: ReturnType<typeof vi.fn>, call = 0) {
  const strings = mock.mock.calls[call]?.[0] as TemplateStringsArray;
  return Array.from(strings).join("?");
}

describe("immutable and replay-safe workspace invitation mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue("OWNER");
  });

  it("authorizes, validates operationKey, and creates with ON CONFLICT DO NOTHING without email membership lookup or xmax", async () => {
    const tx = transactionClient();
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: null }])
      .mockResolvedValueOnce([{ id: "invitation_1" }]);

    await expect(
      createWorkspaceInvitation(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          operationKey,
          email: " Partner@Example.COM ",
          role: "PARTNER",
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "CREATED" });

    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "owner_1",
      "manageMembers",
      tx,
    );
    const insertSql = queryText(tx.$queryRaw, 1);
    expect(insertSql).toMatch(/INSERT INTO "workspace_invitations"/u);
    expect(insertSql).toContain('"operation_key"');
    expect(insertSql).toMatch(/ON CONFLICT DO NOTHING/u);
    expect(insertSql).not.toContain("xmax");
    expect(insertSql).toMatch(/INTERVAL '7 days'/u);
    expect(JSON.stringify(tx)).not.toContain("findFirst");
  });

  it("replays the same operation key without inserting or reopening any closed generation", async () => {
    const tx = transactionClient();
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "closed_generation" }]);

    await expect(
      createWorkspaceInvitation(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          operationKey,
          email: "replay@example.com",
          role: "VIEWER",
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "REPLAYED" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(queryText(tx.$queryRaw, 2)).toMatch(
      /WHERE "operation_key" = \?::uuid/u,
    );
  });

  it("treats a different operation key as already pending without mutating its role or expiry", async () => {
    const tx = transactionClient();
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { status: "PENDING", active: true },
      ]);

    await expect(
      createWorkspaceInvitation(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          operationKey,
          email: "pending@example.com",
          role: "PLANNER",
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "ALREADY_PENDING" });
    const pendingSql = queryText(tx.$queryRaw, 3);
    expect(pendingSql).toMatch(/"expires_at" > CURRENT_TIMESTAMP/u);
    expect(pendingSql).not.toMatch(/\bUPDATE\b/u);
  });

  it("requires explicit reinvite for an expired unsuperseded pending generation", async () => {
    const tx = transactionClient();
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { status: "PENDING", active: false },
      ]);

    await expect(
      createWorkspaceInvitation(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          operationKey,
          email: "expired@example.com",
          role: "VIEWER",
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "REINVITE_REQUIRED" });
  });

  it("CAS-revokes only the current unexpired pending generation", async () => {
    const tx = transactionClient();
    tx.$queryRaw.mockResolvedValueOnce([{ id: "invitation_1" }]);

    await expect(
      revokePendingWorkspaceInvitation(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          invitationId: "invitation_1",
          version: 4,
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "REVOKED" });
    const sql = queryText(tx.$queryRaw);
    expect(sql).toContain('"version" = "version" + 1');
    expect(sql).toContain(
      '"status" = \'PENDING\'::"WorkspaceInvitationStatus"',
    );
    expect(sql).toContain('"expires_at" > CURRENT_TIMESTAMP');
    expect(sql).not.toMatch(
      /SET[\s\S]*(?:"email"|"role"|"created_at"|"expires_at"|"operation_key")\s*=/u,
    );
  });

  it("reinvite inserts a new generation and records lineage without overwriting old core fields", async () => {
    const tx = transactionClient();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "source_1",
          email: "renew@example.com",
          status: "REVOKED",
          expired: false,
          version: 5,
        },
      ])
      .mockResolvedValueOnce([{ locked: null }])
      .mockResolvedValueOnce([{ id: "new_generation" }])
      .mockResolvedValueOnce([{ id: "source_1" }]);

    await expect(
      reinviteWorkspaceInvitation(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          invitationId: "source_1",
          version: 5,
          role: "PLANNER",
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "REINVITED" });

    expect(queryText(tx.$queryRaw, 0)).toMatch(/FOR UPDATE/u);
    const insertSql = queryText(tx.$queryRaw, 2);
    expect(insertSql).toMatch(/INSERT INTO "workspace_invitations"/u);
    expect(insertSql).toContain('"operation_key"');
    const lineageSql = queryText(tx.$queryRaw, 3);
    expect(lineageSql).toMatch(
      /SET[\s\S]*"superseded_by_invitation_id"\s*=\s*\?[\s\S]*"superseded_at"\s*=\s*CURRENT_TIMESTAMP[\s\S]*"version"\s*=\s*"version"\s*\+\s*1/u,
    );
    expect(lineageSql).not.toMatch(
      /SET[\s\S]*(?:"email"|"role"|"created_at"|"expires_at"|"operation_key")\s*=/u,
    );
  });

  it("marks an expired PENDING source EXPIRED before inserting its successor", async () => {
    const tx = transactionClient();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "source_1",
          email: "expired@example.com",
          status: "PENDING",
          expired: true,
          version: 7,
        },
      ])
      .mockResolvedValueOnce([{ locked: null }])
      .mockResolvedValueOnce([{ id: "source_1", version: 8 }])
      .mockResolvedValueOnce([{ id: "new_generation" }])
      .mockResolvedValueOnce([{ id: "source_1" }]);

    await expect(
      reinviteWorkspaceInvitation(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          invitationId: "source_1",
          version: 7,
          role: "PARTNER",
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "REINVITED" });

    expect(queryText(tx.$queryRaw, 2)).toMatch(
      /SET[\s\S]*"status" = 'EXPIRED'::"WorkspaceInvitationStatus"[\s\S]*"version" = "version" \+ 1/u,
    );
    expect(queryText(tx.$queryRaw, 3)).toMatch(
      /INSERT INTO "workspace_invitations"/u,
    );
  });

  it("stops an OWNER denial before operation-key or lifecycle validation", async () => {
    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    const tx = transactionClient();

    await expect(
      createWorkspaceInvitation(
        {
          workspaceId: "workspace_1",
          currentUserId: "former_owner",
          operationKey: "forged",
          email: "invalid",
          role: "OWNER",
        },
        serializableClient(tx),
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("accepted workspace member mutations", () => {
  const expectedUpdatedAt = "2026-07-29T02:03:04.567Z";
  const ownerLockRow = { id: "membership_owner", role: "OWNER" };
  const targetLockRow = {
    id: "membership_target",
    role: "PARTNER",
    userId: "member_1",
    updatedAt: new Date(expectedUpdatedAt),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
  });

  it.each(["PARTNER", "PLANNER", "VIEWER"] as const)(
    "allows OWNER to update an accepted member to the exact %s role with scoped updatedAt CAS",
    async (role) => {
      const tx = transactionClient();
      const nextUpdatedAt = new Date("2026-07-29T02:04:05.678Z");
      tx.$queryRaw
        .mockResolvedValueOnce([ownerLockRow])
        .mockResolvedValueOnce([targetLockRow])
        .mockResolvedValueOnce([{ updatedAt: nextUpdatedAt }]);

      await expect(
        updateWorkspaceMemberRole(
          {
            workspaceId: "workspace_1",
            currentUserId: "owner_1",
            targetMembershipId: "membership_target",
            expectedUpdatedAt,
            role,
          },
          serializableClient(tx),
        ),
      ).resolves.toEqual({ outcome: "UPDATED", updatedAt: nextUpdatedAt });

      const ownerSql = queryText(tx.$queryRaw, 0);
      expect(ownerSql).toMatch(/FROM "memberships"/u);
      expect(ownerSql).toMatch(/"workspace_id" = \?/u);
      expect(ownerSql).toMatch(/"user_id" = \?/u);
      expect(ownerSql).toMatch(/"role" = 'OWNER'::"MembershipRole"/u);
      expect(ownerSql).toMatch(/FOR SHARE/u);

      const targetSql = queryText(tx.$queryRaw, 1);
      expect(targetSql).toMatch(/FROM "memberships"/u);
      expect(targetSql).toMatch(/"workspace_id" = \?/u);
      expect(targetSql).toMatch(/"id" = \?/u);
      expect(targetSql).toMatch(/"updated_at" = \?/u);
      expect(targetSql).toMatch(/FOR UPDATE/u);

      const updateSql = queryText(tx.$queryRaw, 2);
      expect(updateSql).toMatch(/UPDATE "memberships"/u);
      expect(updateSql).toMatch(/"id" = \?/u);
      expect(updateSql).toMatch(/"workspace_id" = \?/u);
      expect(updateSql).toMatch(/"updated_at" = \?/u);
      expect(updateSql).toMatch(/"role" <> 'OWNER'::"MembershipRole"/u);
      expect(updateSql).toMatch(/RETURNING "updated_at" AS "updatedAt"/u);
    },
  );

  it.each(["OWNER", "owner", "EDITOR", "", null, undefined])(
    "rejects non-allowlisted target role %s before the member query",
    async (role) => {
      const tx = transactionClient();
      tx.$queryRaw.mockResolvedValueOnce([ownerLockRow]);
      await expect(
        updateWorkspaceMemberRole(
          {
            workspaceId: "workspace_1",
            currentUserId: "owner_1",
            targetMembershipId: "membership_target",
            expectedUpdatedAt,
            role,
          },
          serializableClient(tx),
        ),
      ).rejects.toBeInstanceOf(WorkspaceMemberValidationError);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(queryText(tx.$queryRaw)).toMatch(/FOR SHARE/u);
    },
  );

  it.each(["missing", "cross-workspace", "stale", "owner-target"])(
    "returns the same safe update outcome for a %s target",
    async () => {
      const tx = transactionClient();
      tx.$queryRaw
        .mockResolvedValueOnce([ownerLockRow])
        .mockResolvedValueOnce([]);

      await expect(
        updateWorkspaceMemberRole(
          {
            workspaceId: "workspace_1",
            currentUserId: "owner_1",
            targetMembershipId: "opaque_target",
            expectedUpdatedAt,
            role: "VIEWER",
          },
          serializableClient(tx),
        ),
      ).resolves.toEqual({ outcome: "NOT_MUTABLE" });
    },
  );

  it("removes only a non-owner target matching membership id, workspace, and updatedAt", async () => {
    const tx = transactionClient();
    tx.$queryRaw
      .mockResolvedValueOnce([ownerLockRow])
      .mockResolvedValueOnce([targetLockRow])
      .mockResolvedValueOnce([{ id: "membership_target" }]);

    await expect(
      removeWorkspaceMember(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          targetMembershipId: "membership_target",
          expectedUpdatedAt,
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "REMOVED" });

    expect(queryText(tx.$queryRaw, 0)).toMatch(/FOR SHARE/u);
    expect(queryText(tx.$queryRaw, 1)).toMatch(/FOR UPDATE/u);
    const sql = queryText(tx.$queryRaw, 2);
    expect(sql).toMatch(/DELETE FROM "memberships"/u);
    expect(sql).toMatch(/"id" = \?/u);
    expect(sql).toMatch(/"workspace_id" = \?/u);
    expect(sql).toMatch(/"updated_at" = \?/u);
    expect(sql).toMatch(/"role" <> 'OWNER'::"MembershipRole"/u);
  });

  it.each(["missing", "cross-workspace", "stale", "owner-target"])(
    "returns the same safe removal outcome for a %s target",
    async () => {
      const tx = transactionClient();
      tx.$queryRaw
        .mockResolvedValueOnce([ownerLockRow])
        .mockResolvedValueOnce([]);

      await expect(
        removeWorkspaceMember(
          {
            workspaceId: "workspace_1",
            currentUserId: "owner_1",
            targetMembershipId: "opaque_target",
            expectedUpdatedAt,
          },
          serializableClient(tx),
        ),
      ).resolves.toEqual({ outcome: "NOT_MUTABLE" });
    },
  );

  it("returns one safe outcome for the owner's own membership without writing", async () => {
    const tx = transactionClient();
    tx.$queryRaw
      .mockResolvedValueOnce([ownerLockRow])
      .mockResolvedValueOnce([
        {
          ...targetLockRow,
          id: "membership_owner",
          role: "OWNER",
          userId: "owner_1",
        },
      ]);

    await expect(
      removeWorkspaceMember(
        {
          workspaceId: "workspace_1",
          currentUserId: "owner_1",
          targetMembershipId: "membership_owner",
          expectedUpdatedAt,
        },
        serializableClient(tx),
      ),
    ).resolves.toEqual({ outcome: "NOT_MUTABLE" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(queryText(tx.$queryRaw, 1)).toMatch(/FOR UPDATE/u);
  });

  it("denies a non-owner inside the transaction before target validation or reads", async () => {
    const tx = transactionClient();
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      updateWorkspaceMemberRole(
        {
          workspaceId: "workspace_1",
          currentUserId: "viewer_1",
          targetMembershipId: "",
          expectedUpdatedAt: "forged",
          role: "OWNER",
        },
        serializableClient(tx),
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(queryText(tx.$queryRaw)).toMatch(/FOR SHARE/u);
  });
});

describe("workspace members privacy and DB-clock expiry query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
  });

  it("OWNER alone receives only unsuperseded active pending and renewable targets", async () => {
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    const invitationQuery = vi.fn().mockResolvedValue([
      {
        id: "active",
        email: "active@example.com",
        role: "PARTNER",
        status: "PENDING",
        version: 2,
        createdAt: new Date("2026-07-28T12:00:00.000Z"),
        expiresAt: new Date("2026-08-04T12:00:00.000Z"),
        active: true,
      },
      {
        id: "expired",
        email: "expired@example.com",
        role: "VIEWER",
        status: "EXPIRED",
        version: 3,
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        expiresAt: new Date("2026-07-27T12:00:00.000Z"),
        active: false,
      },
      {
        id: "revoked",
        email: "revoked@example.com",
        role: "PLANNER",
        status: "REVOKED",
        version: 4,
        createdAt: new Date("2026-07-27T12:00:00.000Z"),
        expiresAt: new Date("2026-08-03T12:00:00.000Z"),
        active: false,
      },
    ]);

    const memberUpdatedAt = new Date("2026-07-29T03:04:05.678Z");
    const memberFindMany = vi.fn().mockResolvedValue([
      {
        id: "membership_1",
        role: "PARTNER",
        updatedAt: memberUpdatedAt,
        user: { name: "協作者", email: "member@example.com" },
      },
    ]);
    const data = await getWorkspaceMembersData("workspace_1", {
      membership: { findMany: memberFindMany },
      $queryRaw: invitationQuery,
    });

    expect(data.members).toEqual([
      {
        role: "PARTNER",
        displayName: "協作者",
        email: "member@example.com",
        management: {
          membershipId: "membership_1",
          updatedAt: memberUpdatedAt.toISOString(),
        },
      },
    ]);
    expect(memberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ id: true, updatedAt: true }),
      }),
    );

    expect(data.pendingInvitations).toEqual([
      expect.objectContaining({ id: "active" }),
    ]);
    expect(data.renewableInvitations).toEqual([
      expect.objectContaining({ id: "expired", reason: "EXPIRED" }),
      expect.objectContaining({ id: "revoked", reason: "REVOKED" }),
    ]);
    const sql = queryText(invitationQuery);
    expect(sql).toMatch(/"superseded_by_invitation_id" IS NULL/u);
    expect(sql).toMatch(/"expires_at" > CURRENT_TIMESTAMP/u);
  });

  it("non-owner never queries invitation email or history", async () => {
    requireWorkspaceAccess.mockResolvedValue({
      role: "PARTNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    const memberFindMany = vi.fn().mockResolvedValue([
      {
        id: "membership_1",
        role: "OWNER",
        user: { name: "擁有者" },
      },
    ]);
    const invitationQuery = vi.fn();

    const data = await getWorkspaceMembersData("workspace_1", {
      membership: { findMany: memberFindMany },
      $queryRaw: invitationQuery,
    });
    expect(data.pendingInvitations).toBeUndefined();
    expect(data.renewableInvitations).toBeUndefined();
    expect(data.members[0]).not.toHaveProperty("management");
    expect(memberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          role: true,
          user: { select: { name: true } },
        },
      }),
    );
    expect(invitationQuery).not.toHaveBeenCalled();
  });

  it("preserves outsider denial and sanitizes data errors", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    const client = {
      membership: { findMany: vi.fn() },
      $queryRaw: vi.fn(),
    };
    await expect(
      getWorkspaceMembersData("workspace_secret", client),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(client.membership.findMany).not.toHaveBeenCalled();

    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    client.membership.findMany.mockRejectedValueOnce(
      new Error("postgres://secret"),
    );
    await expect(
      getWorkspaceMembersData("workspace_1", client),
    ).rejects.toEqual(new WorkspaceMembersDataError());
  });
});
