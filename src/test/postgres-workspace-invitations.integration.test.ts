import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import {
  hasPendingInvitationAfterProof,
  resolveCurrentUserIdentity,
  resolveCurrentUserIdentityWithClaims,
} from "@/lib/current-user-claim";
import {
  createWorkspaceInvitation,
  reinviteWorkspaceInvitation,
  revokePendingWorkspaceInvitation,
} from "@/lib/workspace-invitations";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
let sequence = 0;

type GenerationRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: "PARTNER" | "PLANNER" | "VIEWER";
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  operation_key: string;
  invited_by_user_id: string;
  accepted_by_user_id: string | null;
  accepted_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
  version: number;
  created_at: Date;
  superseded_by_invitation_id: string | null;
  superseded_at: Date | null;
};

async function databaseNow(
  client: Prisma.TransactionClient | PrismaClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ now: Date }>>`
    SELECT CURRENT_TIMESTAMP AS "now"
  `;
  if (!rows[0]?.now) throw new Error("Database clock unavailable.");
  return rows[0].now;
}

async function createUser(label: string, email?: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      googleSubject: `invitation-it-${label}-${sequence}`,
      email: email ?? `invitation-it-${label}-${sequence}@example.test`,
      name: `合成${label}`,
    },
  });
}

async function createWorkspace(ownerId: string, label: string) {
  return prisma.weddingWorkspace.create({
    data: {
      name: label,
      createdById: ownerId,
      memberships: { create: { userId: ownerId, role: "OWNER" } },
    },
  });
}

async function invite(
  workspaceId: string,
  ownerId: string,
  email: string,
  role: "PARTNER" | "PLANNER" | "VIEWER" = "PARTNER",
  operationKey = randomUUID(),
) {
  return createWorkspaceInvitation({
    workspaceId,
    currentUserId: ownerId,
    email,
    role,
    operationKey,
  });
}

function identity(
  googleSubject: string,
  email: string,
  emailVerifiedAt: Date,
) {
  return {
    googleSubject,
    emailVerifiedAt: emailVerifiedAt.getTime(),
    email,
    name: `受邀 ${googleSubject}`,
    image: null,
  };
}

async function generations(workspaceId: string, email: string) {
  return prisma.$queryRaw<GenerationRow[]>`
    SELECT
      "id",
      "workspace_id",
      "email",
      "role",
      "status",
      "operation_key"::text AS "operation_key",
      "invited_by_user_id",
      "accepted_by_user_id",
      "accepted_at",
      "revoked_at",
      "expires_at",
      "version",
      "created_at",
      "superseded_by_invitation_id",
      "superseded_at"
    FROM "workspace_invitations"
    WHERE "workspace_id" = ${workspaceId}
      AND "email" = ${email}
    ORDER BY "created_at", "id"
  `;
}

async function waitForRowLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS "waiting"
      FROM "pg_stat_activity"
      WHERE "datname" = current_database()
        AND "wait_event_type" = 'Lock'
        AND lower(coalesce("wait_event", '')) <> 'advisory'
    `;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the invitation membership lock waiter.");
}

describeDatabase.sequential("PostgreSQL workspace invitation invariants", () => {
  beforeEach(async () => {
    await prisma.weddingWorkspace.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    if (runDatabaseIntegration) {
      await prisma.weddingWorkspace.deleteMany();
      await prisma.user.deleteMany();
    }
    await prisma.$disconnect();
  });

  it("enforces reusable canonical User email, partial pending uniqueness, lineage, terminal state, and cascade", async () => {
    const reusedEmail = "reused@example.test";
    const first = await createUser("reuse-first", reusedEmail);
    const second = await createUser("reuse-second", reusedEmail);
    expect(first.googleSubject).not.toBe(second.googleSubject);
    expect(
      await prisma.user.count({ where: { email: reusedEmail } }),
    ).toBe(2);

    const workspace = await createWorkspace(first.id, "限制婚宴");
    await invite(workspace.id, first.id, "valid@example.test", "VIEWER");

    for (const statement of [
      prisma.$executeRaw`
        UPDATE "users"
        SET "email" = ${" Upper@example.test"}
        WHERE "id" = ${first.id}
      `,
      prisma.$executeRaw`
        UPDATE "workspace_invitations"
        SET "version" = 0
        WHERE "workspace_id" = ${workspace.id}
      `,
      prisma.$executeRaw`
        UPDATE "workspace_invitations"
        SET "expires_at" = "created_at"
        WHERE "workspace_id" = ${workspace.id}
      `,
      prisma.$executeRaw`
        UPDATE "workspace_invitations"
        SET "superseded_by_invitation_id" = "id",
            "superseded_at" = CURRENT_TIMESTAMP
        WHERE "workspace_id" = ${workspace.id}
      `,
    ]) {
      await expect(statement).rejects.toThrow();
    }

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN ('users', 'workspace_invitations')
    `;
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "users_email_idx",
        "workspace_invitations_one_pending_per_email_idx",
        "workspace_invitations_operation_key_key",
        "workspace_invitations_superseded_by_invitation_id_key",
      ]),
    );

    await prisma.weddingWorkspace.delete({ where: { id: workspace.id } });
    expect(
      await prisma.workspaceInvitation.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(0);
  });

  it("rejects a proof older than DB now minus five minutes", async () => {
    const owner = await createUser("old-proof-owner");
    const existing = await createUser(
      "old-proof-invitee",
      "old-proof@example.test",
    );
    const workspace = await createWorkspace(owner.id, "舊 proof");
    await invite(workspace.id, owner.id, existing.email);
    const now = await databaseNow();

    await expect(
      resolveCurrentUserIdentity(
        identity(
          existing.googleSubject,
          existing.email,
          new Date(now.getTime() - 5 * 60 * 1000 - 1),
        ),
      ),
    ).resolves.toMatchObject({ id: existing.id });
    expect(
      await prisma.membership.count({
        where: { workspaceId: workspace.id, userId: existing.id },
      }),
    ).toBe(0);
  });

  it("does not let an app clock ahead accept an invitation created after proof", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
    const owner = await createUser("ahead-owner");
    const workspace = await createWorkspace(owner.id, "App clock 超前");
    const email = "ahead-proof@example.test";
    const dbNow = await databaseNow();
    const proofBeforeInvitation = new Date(dbNow.getTime() - 1_000);
    await invite(workspace.id, owner.id, email);

    const resolved = await resolveCurrentUserIdentity(
      identity("ahead-proof-subject", email, proofBeforeInvitation),
    );
    expect(resolved).not.toBeNull();
    expect(
      await prisma.membership.count({
        where: { workspaceId: workspace.id, userId: resolved!.id },
      }),
    ).toBe(0);
    expect((await generations(workspace.id, email))[0].status).toBe("PENDING");
  });

  it("reveals only whether a pending invitation was created after the signed proof", async () => {
    const owner = await createUser("pending-confirmation-owner");
    const workspace = await createWorkspace(owner.id, "待確認邀請");
    const email = "pending-confirmation@example.test";
    const proofBeforeInvitation = new Date(
      (await databaseNow()).getTime() - 1_000,
    );
    await invite(workspace.id, owner.id, email);

    await expect(
      hasPendingInvitationAfterProof(
        email,
        proofBeforeInvitation.getTime(),
        prisma,
      ),
    ).resolves.toBe(true);
    await expect(
      hasPendingInvitationAfterProof(
        email,
        (await databaseNow()).getTime(),
        prisma,
      ),
    ).resolves.toBe(false);
  });

  it("accepts after a new DB-clock Google verification", async () => {
    const owner = await createUser("new-proof-owner");
    const workspace = await createWorkspace(owner.id, "重新驗證");
    const email = "new-proof@example.test";
    await invite(workspace.id, owner.id, email);

    const reverifiedAt = await databaseNow();
    const resolution = await resolveCurrentUserIdentityWithClaims(
      identity("new-proof-subject", email, reverifiedAt),
    );
    expect(resolution).toMatchObject({ acceptedInvitationCount: 1 });
    expect(resolution.user).not.toBeNull();
    expect(
      await prisma.membership.count({
        where: { workspaceId: workspace.id, userId: resolution.user!.id },
      }),
    ).toBe(1);
    expect((await generations(workspace.id, email))[0].status).toBe("ACCEPTED");
  });

  it("bulk-accepts multiple invitations while preserving an existing membership role", async () => {
    const owner = await createUser("bulk-claim-owner");
    const email = "bulk-claim@example.test";
    const invitee = await createUser("bulk-claim-invitee", email);
    const workspaces = await Promise.all([
      createWorkspace(owner.id, "批次邀請一"),
      createWorkspace(owner.id, "批次邀請二"),
      createWorkspace(owner.id, "批次邀請三"),
    ]);
    await prisma.membership.create({
      data: {
        workspaceId: workspaces[0].id,
        userId: invitee.id,
        role: "PLANNER",
      },
    });
    await Promise.all([
      invite(workspaces[0].id, owner.id, email, "VIEWER"),
      invite(workspaces[1].id, owner.id, email, "PARTNER"),
      invite(workspaces[2].id, owner.id, email, "VIEWER"),
    ]);

    const resolution = await resolveCurrentUserIdentityWithClaims(
      identity(invitee.googleSubject, email, await databaseNow()),
    );

    expect(resolution).toMatchObject({
      acceptedInvitationCount: 3,
      user: { id: invitee.id },
    });
    expect(
      await prisma.membership.findMany({
        where: {
          userId: invitee.id,
          workspaceId: { in: workspaces.map(({ id }) => id) },
        },
        orderBy: { workspaceId: "asc" },
        select: { workspaceId: true, role: true },
      }),
    ).toEqual(
      [
        { workspaceId: workspaces[0].id, role: "PLANNER" },
        { workspaceId: workspaces[1].id, role: "PARTNER" },
        { workspaceId: workspaces[2].id, role: "VIEWER" },
      ].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)),
    );
    expect(
      await prisma.workspaceInvitation.count({
        where: { email, status: "ACCEPTED" },
      }),
    ).toBe(3);
  });

  it("lets a new Google subject claim a reused email without letting the old subject claim", async () => {
    const email = "ownership-reused@example.test";
    const owner = await createUser("reuse-owner");
    const oldHolder = await createUser("reuse-old", email);
    const workspace = await createWorkspace(owner.id, "Email 新持有人");
    const proofBeforeInvitation = new Date(
      (await databaseNow()).getTime() - 1_000,
    );
    await invite(workspace.id, owner.id, email, "PLANNER");

    await resolveCurrentUserIdentity(
      identity(oldHolder.googleSubject, email, proofBeforeInvitation),
    );
    expect(
      await prisma.membership.count({
        where: { workspaceId: workspace.id, userId: oldHolder.id },
      }),
    ).toBe(0);

    const newHolder = await resolveCurrentUserIdentity(
      identity("reuse-new-subject", email, await databaseNow()),
    );
    expect(newHolder).not.toBeNull();
    expect(newHolder!.id).not.toBe(oldHolder.id);
    expect(
      await prisma.user.count({ where: { email } }),
    ).toBe(2);
    expect(
      await prisma.membership.count({
        where: { workspaceId: workspace.id, userId: newHolder!.id },
      }),
    ).toBe(1);
  });

  it("replays the same operation key after revoke and accept without reopening", async () => {
    const owner = await createUser("operation-replay");
    const workspace = await createWorkspace(owner.id, "操作重播");
    const email = "operation-replay@example.test";
    const revokedOperation = randomUUID();
    await invite(workspace.id, owner.id, email, "VIEWER", revokedOperation);
    const [pending] = await generations(workspace.id, email);
    await revokePendingWorkspaceInvitation({
      workspaceId: workspace.id,
      currentUserId: owner.id,
      invitationId: pending.id,
      version: pending.version,
    });

    await expect(
      invite(
        workspace.id,
        owner.id,
        email,
        "PARTNER",
        revokedOperation,
      ),
    ).resolves.toEqual({ outcome: "REPLAYED" });
    expect(await generations(workspace.id, email)).toHaveLength(1);

    const acceptedOperation = randomUUID();
    await invite(
      workspace.id,
      owner.id,
      email,
      "PARTNER",
      acceptedOperation,
    );
    await resolveCurrentUserIdentity(
      identity("operation-replay-claim", email, await databaseNow()),
    );
    await expect(
      invite(
        workspace.id,
        owner.id,
        email,
        "PLANNER",
        acceptedOperation,
      ),
    ).resolves.toEqual({ outcome: "REPLAYED" });
    const closed = await generations(workspace.id, email);
    expect(closed).toHaveLength(2);
    expect(closed.map(({ status }) => status).sort()).toEqual([
      "ACCEPTED",
      "REVOKED",
    ]);
  });

  it("keeps parallel different operation keys to at most one pending generation", async () => {
    const owner = await createUser("parallel-create");
    const workspace = await createWorkspace(owner.id, "平行建立");
    const email = "parallel-create@example.test";

    const outcomes = await Promise.all([
      invite(workspace.id, owner.id, email, "PARTNER", randomUUID()),
      invite(workspace.id, owner.id, email, "VIEWER", randomUUID()),
    ]);
    expect(outcomes.map(({ outcome }) => outcome).sort()).toEqual([
      "ALREADY_PENDING",
      "CREATED",
    ]);
    expect(
      await prisma.workspaceInvitation.count({
        where: { workspaceId: workspace.id, email, status: "PENDING" },
      }),
    ).toBe(1);
  });

  it("reinvite creates a new id and immutable lineage", async () => {
    const owner = await createUser("lineage");
    const workspace = await createWorkspace(owner.id, "不可變世代");
    const email = "lineage@example.test";
    await invite(workspace.id, owner.id, email, "VIEWER");
    const [initial] = await generations(workspace.id, email);
    await revokePendingWorkspaceInvitation({
      workspaceId: workspace.id,
      currentUserId: owner.id,
      invitationId: initial.id,
      version: initial.version,
    });
    const [revoked] = await generations(workspace.id, email);

    await expect(
      reinviteWorkspaceInvitation({
        workspaceId: workspace.id,
        currentUserId: owner.id,
        invitationId: revoked.id,
        version: revoked.version,
        role: "PLANNER",
      }),
    ).resolves.toEqual({ outcome: "REINVITED" });

    const [source, successor] = await generations(workspace.id, email);
    expect(successor.id).not.toBe(source.id);
    expect(source).toMatchObject({
      id: revoked.id,
      email: revoked.email,
      role: revoked.role,
      operation_key: revoked.operation_key,
      invited_by_user_id: revoked.invited_by_user_id,
      created_at: revoked.created_at,
      expires_at: revoked.expires_at,
      revoked_at: revoked.revoked_at,
      superseded_by_invitation_id: successor.id,
    });
    expect(source.superseded_at).not.toBeNull();
    expect(successor).toMatchObject({
      status: "PENDING",
      role: "PLANNER",
      superseded_by_invitation_id: null,
    });

    await expect(
      prisma.$executeRaw`
        UPDATE "workspace_invitations"
        SET "role" = 'PARTNER'::"MembershipRole"
        WHERE "id" = ${source.id}
      `,
    ).rejects.toThrow();
  });

  it("keeps a stale reinvite from creating a second generation", async () => {
    const owner = await createUser("stale-reinvite");
    const workspace = await createWorkspace(owner.id, "過期重邀表單");
    const email = "stale-reinvite@example.test";
    await invite(workspace.id, owner.id, email);
    const [initial] = await generations(workspace.id, email);
    await revokePendingWorkspaceInvitation({
      workspaceId: workspace.id,
      currentUserId: owner.id,
      invitationId: initial.id,
      version: initial.version,
    });
    const [revoked] = await generations(workspace.id, email);
    const request = {
      workspaceId: workspace.id,
      currentUserId: owner.id,
      invitationId: revoked.id,
      version: revoked.version,
      role: "PARTNER" as const,
    };

    await expect(reinviteWorkspaceInvitation(request)).resolves.toEqual({
      outcome: "REINVITED",
    });
    await expect(reinviteWorkspaceInvitation(request)).resolves.toEqual({
      outcome: "NOT_REINVITABLE",
    });
    expect(await generations(workspace.id, email)).toHaveLength(2);
  });

  it("allows a new create after an accepted generation", async () => {
    const owner = await createUser("accepted-new-create");
    const workspace = await createWorkspace(owner.id, "接受後再邀");
    const email = "accepted-new-create@example.test";
    await invite(workspace.id, owner.id, email);
    await resolveCurrentUserIdentity(
      identity("accepted-new-create-subject", email, await databaseNow()),
    );

    await expect(
      invite(workspace.id, owner.id, email, "VIEWER", randomUUID()),
    ).resolves.toEqual({ outcome: "CREATED" });
    expect(
      await prisma.workspaceInvitation.count({
        where: { workspaceId: workspace.id, email, status: "PENDING" },
      }),
    ).toBe(1);
    expect(await generations(workspace.id, email)).toHaveLength(2);
  });

  it("does not create an invitation after OWNER access is concurrently revoked", async () => {
    const owner = await createUser("revoked-owner");
    const workspace = await createWorkspace(owner.id, "撤權競態邀請");
    const email = "revoked-owner-invite@example.test";

    let markRevocationStarted!: () => void;
    const revocationStarted = new Promise<void>((resolve) => {
      markRevocationStarted = resolve;
    });
    let releaseRevocation!: () => void;
    const holdRevocation = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    const revocation = prisma.$transaction(async (transaction) => {
      await transaction.membership.delete({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: owner.id,
          },
        },
      });
      markRevocationStarted();
      await holdRevocation;
    });

    await revocationStarted;
    const createResult = invite(workspace.id, owner.id, email);
    try {
      await waitForRowLockWaiter();
    } finally {
      releaseRevocation();
    }
    await revocation;

    await expect(createResult).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
    expect(
      await prisma.workspaceInvitation.count({
        where: { workspaceId: workspace.id, email },
      }),
    ).toBe(0);
  });

  it("rejects accepted_at equal to or later than expires_at", async () => {
    const owner = await createUser("accepted-boundary-owner");
    const accepter = await createUser("accepted-boundary-user");
    const workspace = await createWorkspace(owner.id, "接受期限限制");
    const email = "accepted-boundary@example.test";
    await invite(workspace.id, owner.id, email);
    const [pending] = await generations(workspace.id, email);

    for (const offset of [0, 1]) {
      await expect(
        prisma.$executeRaw`
          UPDATE "workspace_invitations"
          SET
            "status" = 'ACCEPTED'::"WorkspaceInvitationStatus",
            "accepted_by_user_id" = ${accepter.id},
            "accepted_at" = "expires_at" + (${offset} * INTERVAL '1 millisecond'),
            "version" = "version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${pending.id}
        `,
      ).rejects.toThrow();
    }
  });

  it("settles expiry, revoke, and claim races in legal terminal states", async () => {
    const owner = await createUser("expiry-race-owner");
    const workspace = await createWorkspace(owner.id, "到期競態");
    const email = "expiry-race@example.test";
    const invitationId = randomUUID();
    const operationKey = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "workspace_invitations" (
        "id",
        "workspace_id",
        "email",
        "role",
        "status",
        "operation_key",
        "invited_by_user_id",
        "expires_at",
        "version",
        "created_at",
        "updated_at"
      ) VALUES (
        ${invitationId},
        ${workspace.id},
        ${email},
        'PLANNER'::"MembershipRole",
        'PENDING'::"WorkspaceInvitationStatus",
        ${operationKey}::uuid,
        ${owner.id},
        CURRENT_TIMESTAMP,
        1,
        CURRENT_TIMESTAMP - INTERVAL '7 days 1 second',
        CURRENT_TIMESTAMP
      )
    `;
    const [pending] = await generations(workspace.id, email);
    const proofBeforeSuccessor = await databaseNow();

    const [claimResult, revokeResult, reinviteResult] =
      await Promise.allSettled([
        resolveCurrentUserIdentity(
          identity("expiry-race-claim", email, proofBeforeSuccessor),
        ),
        revokePendingWorkspaceInvitation({
          workspaceId: workspace.id,
          currentUserId: owner.id,
          invitationId: pending.id,
          version: pending.version,
        }),
        reinviteWorkspaceInvitation({
          workspaceId: workspace.id,
          currentUserId: owner.id,
          invitationId: pending.id,
          version: pending.version,
          role: "VIEWER",
        }),
      ]);
    expect(claimResult.status).toBe("fulfilled");
    expect(revokeResult.status).toBe("fulfilled");
    expect(reinviteResult.status).toBe("fulfilled");

    const settled = await generations(workspace.id, email);
    expect(
      settled.filter(({ status }) => status === "PENDING"),
    ).toHaveLength(1);
    expect(
      settled.filter(({ status }) => status === "EXPIRED"),
    ).toHaveLength(1);
    expect(
      await prisma.membership.count({
        where: {
          workspaceId: workspace.id,
          user: { googleSubject: "expiry-race-claim" },
        },
      }),
    ).toBe(0);
  });
});
