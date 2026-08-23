import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const subjectPrefix = `user-access-it-${process.pid}-`;
let sequence = 0;

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      googleSubject: `${subjectPrefix}${label}-${sequence}`,
      email: `${subjectPrefix}${label}-${sequence}@example.test`,
    },
  });
}

describeDatabase("system user access PostgreSQL invariants", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { googleSubject: { startsWith: subjectPrefix } },
    });
    await prisma.$disconnect();
  });

  it("keeps new registrations active with empty access audit metadata", async () => {
    const user = await createUser("default");

    expect(user).toMatchObject({
      accessStatus: "ACTIVE",
      accessStatusChangedAt: null,
      lastLoginAt: null,
      version: 0,
    });
  });

  it("supports a versioned reversible status transition", async () => {
    const user = await createUser("transition");
    const changedAt = new Date("2026-08-24T01:00:00.000Z");

    await expect(
      prisma.user.updateMany({
        where: { id: user.id, version: 0 },
        data: {
          accessStatus: "SUSPENDED",
          accessStatusChangedAt: changedAt,
          version: { increment: 1 },
        },
      }),
    ).resolves.toEqual({ count: 1 });
    await expect(
      prisma.user.updateMany({
        where: { id: user.id, version: 0 },
        data: { accessStatus: "REMOVED" },
      }),
    ).resolves.toEqual({ count: 0 });
    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject({
      accessStatus: "SUSPENDED",
      accessStatusChangedAt: changedAt,
      version: 1,
    });
  });

  it("creates the status and registration-time lookup index", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = ${"users"}
        AND indexname = ${"users_access_status_created_at_idx"}
    `;

    expect(indexes).toHaveLength(1);
  });
});
