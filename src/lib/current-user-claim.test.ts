import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  hasPendingInvitationAfterProof,
  resolveCurrentUserIdentity,
  resolveCurrentUserIdentityWithClaims,
} from "./current-user-claim";

const proof = Date.parse("2026-07-29T02:00:00.000Z");

function transactionClient({
  fresh = true,
  claims = [
    {
      id: "invitation_1",
      workspace_id: "workspace_1",
      role: "PARTNER",
    },
  ],
  existingUser = null,
}: {
  fresh?: boolean;
  claims?: Array<{
    id: string;
    workspace_id: string;
    role: "PARTNER" | "PLANNER" | "VIEWER";
  }>;
  existingUser?: Record<string, unknown> | null;
} = {}) {
  const user = {
    id: "user_1",
    googleSubject: "google_123",
    email: "invitee@example.com",
    name: "受邀者",
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue(existingUser),
      upsert: vi.fn().mockResolvedValue(user),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([
        {
          database_now: new Date("2026-07-29T02:01:00.000Z"),
          fresh,
        },
      ])
      .mockResolvedValueOnce(claims),
    membership: {
      createMany: vi.fn().mockResolvedValue({ count: claims.length }),
    },
  };
  const client = {
    $transaction: vi.fn(
      async (
        operation: (transaction: typeof tx) => Promise<unknown>,
        options: unknown,
      ) => {
        expect(options).toEqual({ isolationLevel: "Serializable" });
        return operation(tx);
      },
    ),
  } as unknown as Pick<PrismaClient, "$transaction">;
  return { client, tx, user };
}

function queryText(mock: ReturnType<typeof vi.fn>, call = 0) {
  const strings = mock.mock.calls[call]?.[0] as TemplateStringsArray;
  return Array.from(strings).join("?");
}

describe("current-user DB-clock invitation claim", () => {
  it("checks freshness in PostgreSQL and repeats every proof gate in the claim CAS", async () => {
    const { client, tx, user } = transactionClient();

    await expect(
      resolveCurrentUserIdentityWithClaims(
        {
          googleSubject: "google_123",
          emailVerifiedAt: proof,
          email: "  Invitee@Example.COM ",
          name: "受邀者",
          image: null,
        },
        client,
      ),
    ).resolves.toEqual({ acceptedInvitationCount: 1, user });

    const freshnessSql = queryText(tx.$queryRaw, 0);
    expect(freshnessSql).toMatch(
      /SELECT\s+CURRENT_TIMESTAMP AS "database_now"/u,
    );
    expect(freshnessSql).toMatch(/\?::timestamptz <= CURRENT_TIMESTAMP/u);
    expect(freshnessSql).toMatch(
      /\?::timestamptz >=\s*CURRENT_TIMESTAMP - INTERVAL '5 minutes'/u,
    );

    const claimSql = queryText(tx.$queryRaw, 1);
    expect(claimSql).toMatch(
      /UPDATE "workspace_invitations"[\s\S]*"version" = "version" \+ 1/u,
    );
    expect(claimSql).toMatch(/\?::timestamptz <= CURRENT_TIMESTAMP/u);
    expect(claimSql).toMatch(
      /\?::timestamptz >=\s*CURRENT_TIMESTAMP - INTERVAL '5 minutes'/u,
    );
    expect(claimSql).toMatch(/"created_at" <= \?::timestamptz/u);
    expect(claimSql).toMatch(/"expires_at" > CURRENT_TIMESTAMP/u);
    expect(claimSql).toMatch(/"superseded_by_invitation_id" IS NULL/u);

    expect(tx.user.upsert).toHaveBeenCalledWith({
      where: { googleSubject: "google_123" },
      create: {
        googleSubject: "google_123",
        email: "invitee@example.com",
        name: "受邀者",
        image: null,
      },
      update: {
        email: "invitee@example.com",
        name: "受邀者",
        image: null,
      },
    });
    expect(tx.membership.createMany).toHaveBeenCalledOnce();
    expect(tx.membership.createMany).toHaveBeenCalledWith({
      data: [
        {
          workspaceId: "workspace_1",
          userId: "user_1",
          role: "PARTNER",
        },
      ],
      skipDuplicates: true,
    });
  });

  it.each([
    ["old", proof - 301_000],
    ["future", proof + 301_000],
    ["missing", undefined],
  ])(
    "uses only googleSubject for a DB-rejected %s proof",
    async (_label, emailVerifiedAt) => {
      const existing = {
        id: "existing_user",
        googleSubject: "google_123",
        email: "historical@example.com",
      };
      const { client, tx } = transactionClient({
        fresh: false,
        existingUser: existing,
      });

      await expect(
        resolveCurrentUserIdentity(
          {
            googleSubject: "google_123",
            emailVerifiedAt,
            email: "reused@example.com",
            name: "不應更新",
            image: null,
          },
          client,
        ),
      ).resolves.toBe(existing);

      expect(tx.user.findUnique).toHaveBeenCalledWith({
        where: { googleSubject: "google_123" },
      });
      expect(tx.user.upsert).not.toHaveBeenCalled();
      expect(tx.membership.createMany).not.toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
    },
  );

  it("creates no membership when the claim CAS rejects the generation", async () => {
    const { client, tx } = transactionClient({ claims: [] });
    await resolveCurrentUserIdentity(
      {
        googleSubject: "google_new",
        emailVerifiedAt: proof,
        email: "invitee@example.com",
        name: null,
        image: null,
      },
      client,
    );
    expect(tx.membership.createMany).not.toHaveBeenCalled();
  });

  it("bulk-creates memberships with one bounded create query", async () => {
    const claims = [
      { id: "invitation_1", workspace_id: "workspace_1", role: "PARTNER" as const },
      { id: "invitation_2", workspace_id: "workspace_2", role: "PLANNER" as const },
      { id: "invitation_3", workspace_id: "workspace_3", role: "VIEWER" as const },
    ];
    const { client, tx, user } = transactionClient({ claims });

    await expect(
      resolveCurrentUserIdentityWithClaims(
        {
          googleSubject: "google_123",
          emailVerifiedAt: proof,
          email: "invitee@example.com",
          name: "受邀者",
          image: null,
        },
        client,
      ),
    ).resolves.toEqual({ acceptedInvitationCount: 3, user });

    expect(tx.membership.createMany).toHaveBeenCalledOnce();
    expect(tx.membership.createMany).toHaveBeenCalledWith({
      data: claims.map((claim) => ({
        workspaceId: claim.workspace_id,
        userId: user.id,
        role: claim.role,
      })),
      skipDuplicates: true,
    });
  });
});

describe("pending invitation confirmation lookup", () => {
  it("returns only a boolean for an invitation created after the signed proof", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ pending: true }]);
    const client = { $queryRaw: queryRaw } as unknown as Pick<
      PrismaClient,
      "$queryRaw"
    >;

    await expect(
      hasPendingInvitationAfterProof(
        "  Invitee@Example.COM ",
        proof,
        client,
      ),
    ).resolves.toBe(true);

    const sql = queryText(queryRaw);
    expect(sql).toMatch(/SELECT\s+EXISTS/u);
    expect(sql).toMatch(/"created_at" > \?::timestamptz/u);
    expect(sql).toMatch(/"expires_at" > CURRENT_TIMESTAMP/u);
    expect(sql).toMatch(/"status" = 'PENDING'/u);
    expect(sql).toMatch(/"superseded_by_invitation_id" IS NULL/u);
    expect(sql).not.toMatch(/SELECT[\s\S]*"workspace_id"/u);
    expect(queryRaw.mock.calls[0].slice(1)).toEqual([
      "invitee@example.com",
      new Date(proof),
    ]);
  });

  it.each([
    ["missing email", null, proof],
    ["missing proof", "invitee@example.com", undefined],
    ["invalid proof", "invitee@example.com", Number.NaN],
  ])("does not query for %s", async (_label, email, verifiedAt) => {
    const queryRaw = vi.fn();
    const client = { $queryRaw: queryRaw } as unknown as Pick<
      PrismaClient,
      "$queryRaw"
    >;

    await expect(
      hasPendingInvitationAfterProof(email, verifiedAt, client),
    ).resolves.toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
