import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ userId: "" }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({ id: authState.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { createGuestAction } from "@/actions/guests";
import {
  importLineinRsvpRecords,
  parseNormalizedLineinRsvpJson,
} from "../../scripts/linein-rsvp-import.mjs";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const idleState = { status: "idle" as const };
const lineinFailClosedMigration = readFileSync(
  path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260802152000_linein_party_size_fail_closed",
    "migration.sql",
  ),
  "utf8",
);
const lineinPartySizeConstraint =
  "guest_rsvps_linein_default_no_party_size_check";
function extractLineinFailClosedMigrationStatements(migration: string) {
  const statements = [
    migration.match(/UPDATE "guest_rsvps"[\s\S]*?;\s*/u)?.[0],
    migration.match(
      /DO \$migration\$[\s\S]*?\$migration\$;\s*/u,
    )?.[0],
    migration.match(
      /ALTER TABLE "guest_rsvps"\s+VALIDATE CONSTRAINT "guest_rsvps_linein_default_no_party_size_check";\s*/u,
    )?.[0],
  ];
  if (statements.some((statement) => !statement)) {
    throw new Error("LINEIN fail-closed migration fixture is incomplete.");
  }

  const normalizeExecutableBody = (sql: string) =>
    sql
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .filter((line) => !/^\s*--/u.test(line))
      .join("\n")
      .replace(/\s+/gu, " ")
      .trim();
  if (
    normalizeExecutableBody(statements.join("\n")) !==
    normalizeExecutableBody(migration)
  ) {
    throw new Error(
      "LINEIN fail-closed migration fragments do not cover the complete executable artifact.",
    );
  }

  return statements as string[];
}

const lineinFailClosedMigrationStatements =
  extractLineinFailClosedMigrationStatements(lineinFailClosedMigration);
let sequence = 0;

function sourceRecord(externalUserId: string) {
  return {
    source: "LINEIN",
    externalUserId,
    name: "PostgreSQL 測試賓客",
    side: "PARTNER_A",
    relationshipLabel: "測試關係",
    phone: "0900-000-000",
    email: "postgres-rsvp@example.test",
    attendanceStatus: "ATTENDING",
    attendanceReply: "會出席",
    ceremonyAttendance: true,
    partySize: 3,
    childSeatCount: 1,
    vegetarianCount: 0,
    invitationDelivery: "PAPER",
    invitationReply: "希望收到紙本喜帖",
    mailingAddress: "測試市測試路 1 號",
    message: "祝福新人",
    respondedAt: "2026-07-22T08:30:00.000Z",
  };
}

async function createWorkspace(label: string) {
  sequence += 1;
  const user = await prisma.user.create({
    data: {
      googleSubject: `rsvp-it-${sequence}`,
      email: `rsvp-it-${sequence}@example.test`,
    },
  });
  const workspace = await prisma.weddingWorkspace.create({
    data: {
      name: label,
      createdById: user.id,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  return { user, workspace };
}

async function createGuest(workspaceId: string, name: string) {
  return prisma.guest.create({
    data: {
      workspaceId,
      name,
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize: 1,
    },
  });
}

async function waitForMembershipLockWaiter(): Promise<void> {
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
  throw new Error("Timed out waiting for the Membership row-lock waiter.");
}

function rsvpData(
  guestId: string,
  workspaceId: string,
  externalId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    guestId,
    workspaceId,
    source: "LINEIN" as const,
    sourceInstance: "default",
    sourceLabel: "拍拍印",
    sourceManaged: true,
    managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"] as (
      | "NAME"
      | "SIDE"
      | "ATTENDANCE_STATUS"
      | "PARTY_SIZE"
    )[],
    sourcePartySize: 3,
    externalId,
    relationshipLabel: "測試關係",
    contactPhone: "0900-000-000",
    contactEmail: null,
    ceremonyAttendance: null,
    childSeatCount: 0,
    vegetarianCount: 0,
    invitationDelivery: "DIGITAL" as const,
    mailingAddress: null,
    guestMessage: null,
    attendanceReply: "會出席",
    invitationReply: "電子喜帖",
    sourceSubmittedAt: new Date("2026-07-22T08:30:00.000Z"),
    ...overrides,
  };
}

function provenanceSnapshot(workspaceId: string) {
  return prisma.guestImportRecord.findMany({
    where: { workspaceId },
    orderBy: { externalId: "asc" },
    include: { guest: true },
  });
}

async function executeLineinFailClosedMigration() {
  await prisma.$transaction(
    lineinFailClosedMigrationStatements.map((statement) =>
      prisma.$executeRawUnsafe(statement),
    ),
  );
}

describe("LINEIN fail-closed focused migration fixture", () => {
  it("rejects an appended statement instead of silently omitting it", () => {
    expect(() =>
      extractLineinFailClosedMigrationStatements(
        `${lineinFailClosedMigration}\nUPDATE guests SET party_size = 99;\n`,
      ),
    ).toThrow();
  });
});

describeDatabase.sequential("PostgreSQL Guest RSVP tenant invariants", () => {
  beforeEach(async () => {
    revalidatePath.mockClear();
    authState.userId = "";
    await prisma.weddingWorkspace.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (runDatabaseIntegration) {
      await prisma.weddingWorkspace.deleteMany();
      await prisma.user.deleteMany();
    }
    await prisma.$disconnect();
  });

  it("defaults existing-style guests and enforces roster category invariants", async () => {
    const { workspace } = await createWorkspace("名單身份約束");

    const ordinaryGuest = await createGuest(workspace.id, "既有一般賓客");
    expect(ordinaryGuest.category).toBe("GUEST");

    await prisma.guest.create({
      data: {
        workspaceId: workspace.id,
        name: "新郎",
        category: "COUPLE",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: 1,
      },
    });
    await expect(
      prisma.guest.create({
        data: {
          workspaceId: workspace.id,
          name: "重複新郎",
          category: "COUPLE",
          side: "PARTNER_A",
          attendanceStatus: "ATTENDING",
          partySize: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.guest.create({
        data: {
          workspaceId: workspace.id,
          name: "共同方家人",
          category: "FAMILY",
          side: "SHARED",
          attendanceStatus: "ATTENDING",
          partySize: 1,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.guest.create({
        data: {
          workspaceId: workspace.id,
          name: "多人家人",
          category: "FAMILY",
          side: "PARTNER_B",
          attendanceStatus: "ATTENDING",
          partySize: 2,
        },
      }),
    ).rejects.toBeDefined();

    expect(
      await prisma.guest.count({
        where: { workspaceId: workspace.id, category: "COUPLE" },
      }),
    ).toBe(1);
  });

  it("round-trips an import and enforces source identity per workspace", async () => {
    const first = await createWorkspace("第一婚宴");
    const second = await createWorkspace("第二婚宴");
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord("shared-opaque-id")]),
    );

    await expect(
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: first.workspace.id,
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 1, applied: true });
    await expect(
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: first.workspace.id,
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ unchanged: 1, applied: true });
    await expect(
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: second.workspace.id,
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 1, applied: true });

    expect(
      await prisma.guestImportRecord.count({
        where: { source: "LINEIN", externalId: "shared-opaque-id" },
      }),
    ).toBe(2);
    expect(await prisma.guestImportBatch.count()).toBe(2);
    expect(await prisma.guestImportBatchRow.count()).toBe(2);
    const firstBatch = await prisma.guestImportBatch.findFirstOrThrow({
      where: { workspaceId: first.workspace.id, source: "LINEIN" },
      include: { rows: true },
    });
    expect(firstBatch).toMatchObject({
      sourceInstance: "default",
      sourceLabel: "拍拍印",
      mappingVersion: "linein-rsvp-v2",
      status: "SUCCEEDED",
      totalRows: 1,
      succeededRows: 1,
      skippedRows: 0,
      rerunCount: 1,
    });
    expect(firstBatch.rows).toHaveLength(1);
    expect(firstBatch.rows[0]).toMatchObject({
      status: "SUCCEEDED",
      attemptCount: 2,
    });
    expect(firstBatch.rows[0].sourcePayloadHash).toMatch(/^[a-f0-9]{64}$/u);
    await expect(
      prisma.guestImportRecord.findFirstOrThrow({
        where: { workspaceId: first.workspace.id, source: "LINEIN" },
        select: { managedFields: true, sourcePartySize: true, guest: true },
      }),
    ).resolves.toMatchObject({
      managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
      sourcePartySize: 3,
      guest: { partySize: 3 },
    });

    const duplicateGuest = await createGuest(first.workspace.id, "不可重複");
    await expect(
      prisma.guestImportRecord.create({
        data: rsvpData(
          duplicateGuest.id,
          first.workspace.id,
          "shared-opaque-id",
        ),
      }),
    ).rejects.toBeDefined();
  });

  it("preserves operational party size across LINEIN reruns and source updates", async () => {
    const { workspace } = await createWorkspace("Party size ownership 婚宴");
    const initialRecords = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord("party-size-ownership")]),
    );
    await importLineinRsvpRecords({
      client: prisma,
      workspaceId: workspace.id,
      records: initialRecords,
      apply: true,
    });
    const imported = await prisma.guestImportRecord.findFirstOrThrow({
      where: { workspaceId: workspace.id, source: "LINEIN" },
      select: { guestId: true },
    });
    await prisma.guest.update({
      where: { id: imported.guestId },
      data: { partySize: 5 },
    });

    await expect(
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: workspace.id,
        records: initialRecords,
        apply: true,
      }),
    ).resolves.toMatchObject({ unchanged: 1, update: 0 });

    const changedSourceRecords = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        { ...sourceRecord("party-size-ownership"), partySize: 4 },
      ]),
    );
    await expect(
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: workspace.id,
        records: changedSourceRecords,
        apply: true,
      }),
    ).resolves.toMatchObject({ unchanged: 0, update: 1 });

    await expect(
      prisma.guestImportRecord.findFirstOrThrow({
        where: { workspaceId: workspace.id, source: "LINEIN" },
        select: { managedFields: true, sourcePartySize: true, guest: true },
      }),
    ).resolves.toMatchObject({
      managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
      sourcePartySize: 4,
      guest: { partySize: 5 },
    });
  });

  it("normalizes only stale LINEIN/default provenance and is harmless on a second execution", async () => {
    const { workspace } = await createWorkspace("Fail-closed migration 婚宴");
    const oldGuestTimestamp = new Date("2026-01-02T03:04:05.000Z");
    const oldRecordTimestamp = new Date("2026-02-03T04:05:06.000Z");
    const guestSpecs = [
      {
        externalId: "a-target-full",
        name: "完整 target",
        side: "PARTNER_A" as const,
        attendanceStatus: "ATTENDING" as const,
        partySize: 7,
        notes: "完整 target Guest 備註",
        version: 11,
      },
      {
        externalId: "b-target-sole",
        name: "sole target",
        side: "PARTNER_B" as const,
        attendanceStatus: "DECLINED" as const,
        partySize: 8,
        notes: "sole target Guest 備註",
        version: 12,
      },
      {
        externalId: "c-linein-secondary",
        name: "secondary owner",
        side: "SHARED" as const,
        attendanceStatus: "UNDECIDED" as const,
        partySize: 9,
        notes: "secondary Guest 備註",
        version: 13,
      },
      {
        externalId: "d-future-source",
        name: "future owner",
        side: "PARTNER_A" as const,
        attendanceStatus: "ATTENDING" as const,
        partySize: 10,
        notes: "future Guest 備註",
        version: 14,
      },
    ];

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "guest_rsvps" DROP CONSTRAINT IF EXISTS "${lineinPartySizeConstraint}"`,
    );

    try {
      const guests = new Map<string, Awaited<ReturnType<typeof createGuest>>>();
      for (const spec of guestSpecs) {
        const guest = await prisma.guest.create({
          data: {
            workspaceId: workspace.id,
            name: spec.name,
            side: spec.side,
            attendanceStatus: spec.attendanceStatus,
            partySize: spec.partySize,
            notes: spec.notes,
            version: spec.version,
            createdAt: oldGuestTimestamp,
            updatedAt: oldGuestTimestamp,
          },
        });
        guests.set(spec.externalId, guest);
      }

      await prisma.guestImportRecord.createMany({
        data: [
          rsvpData(
            guests.get("a-target-full")!.id,
            workspace.id,
            "a-target-full",
            {
              managedFields: [
                "NAME",
                "SIDE",
                "ATTENDANCE_STATUS",
                "PARTY_SIZE",
              ],
              sourcePartySize: null,
              relationshipLabel: "完整來源關係",
              contactPhone: "0911-111-111",
              contactEmail: "target-full@example.test",
              ceremonyAttendance: true,
              childSeatCount: 2,
              vegetarianCount: 1,
              invitationDelivery: "PAPER",
              mailingAddress: "測試市完整路 1 號",
              guestMessage: "完整來源留言",
              attendanceReply: "完整出席回覆",
              invitationReply: "完整喜帖回覆",
              sourceSubmittedAt: new Date("2026-02-01T01:02:03.000Z"),
              createdAt: oldRecordTimestamp,
              updatedAt: oldRecordTimestamp,
            },
          ),
          rsvpData(
            guests.get("b-target-sole")!.id,
            workspace.id,
            "b-target-sole",
            {
              managedFields: ["PARTY_SIZE"],
              sourcePartySize: 4,
              relationshipLabel: "sole 來源關係",
              createdAt: oldRecordTimestamp,
              updatedAt: oldRecordTimestamp,
            },
          ),
          rsvpData(
            guests.get("c-linein-secondary")!.id,
            workspace.id,
            "c-linein-secondary",
            {
              sourceInstance: "secondary",
              managedFields: ["PARTY_SIZE"],
              sourcePartySize: 5,
              relationshipLabel: "secondary 來源關係",
              createdAt: oldRecordTimestamp,
              updatedAt: oldRecordTimestamp,
            },
          ),
          rsvpData(
            guests.get("d-future-source")!.id,
            workspace.id,
            "d-future-source",
            {
              source: "FUTURE_RSVP",
              sourceLabel: "未來來源",
              managedFields: ["PARTY_SIZE"],
              sourcePartySize: 6,
              relationshipLabel: "future 來源關係",
              createdAt: oldRecordTimestamp,
              updatedAt: oldRecordTimestamp,
            },
          ),
        ],
      });

      const beforeMigration = await provenanceSnapshot(workspace.id);
      await executeLineinFailClosedMigration();
      const afterFirstMigration = await provenanceSnapshot(workspace.id);
      const firstByExternalId = new Map(
        afterFirstMigration.map((record) => [record.externalId, record]),
      );
      const targetIds = new Set(["a-target-full", "b-target-sole"]);
      const expectedAfterFirst = beforeMigration.map((record) => {
        if (!targetIds.has(record.externalId)) return record;
        const actual = firstByExternalId.get(record.externalId)!;
        const managedFields = record.managedFields.filter(
          (field) => field !== "PARTY_SIZE",
        );
        expect(actual.updatedAt.getTime()).toBeGreaterThan(
          record.updatedAt.getTime(),
        );
        return {
          ...record,
          sourcePartySize: record.sourcePartySize ?? record.guest.partySize,
          managedFields,
          sourceManaged: managedFields.length > 0,
          updatedAt: actual.updatedAt,
        };
      });
      expect(afterFirstMigration).toEqual(expectedAfterFirst);

      await executeLineinFailClosedMigration();
      expect(await provenanceSnapshot(workspace.id)).toEqual(
        afterFirstMigration,
      );

      const constraints = await prisma.$queryRaw<
        Array<{ constraintName: string; validated: boolean }>
      >`
        SELECT conname AS "constraintName", convalidated AS "validated"
        FROM pg_constraint
        WHERE conrelid = '"guest_rsvps"'::regclass
          AND conname = ${lineinPartySizeConstraint}
      `;
      expect(constraints).toEqual([
        { constraintName: lineinPartySizeConstraint, validated: true },
      ]);

      const secondaryWriterGuest = await createGuest(
        workspace.id,
        "新 secondary owner",
      );
      const futureWriterGuest = await createGuest(
        workspace.id,
        "新 future owner",
      );
      await expect(
        prisma.guestImportRecord.createMany({
          data: [
            rsvpData(
              secondaryWriterGuest.id,
              workspace.id,
              "e-new-linein-secondary",
              {
                sourceInstance: "secondary",
                managedFields: ["PARTY_SIZE"],
              },
            ),
            rsvpData(
              futureWriterGuest.id,
              workspace.id,
              "f-new-future-source",
              {
                source: "FUTURE_RSVP",
                sourceLabel: "未來來源",
                managedFields: ["PARTY_SIZE"],
              },
            ),
          ],
        }),
      ).resolves.toEqual({ count: 2 });
    } finally {
      await executeLineinFailClosedMigration();
    }
  });

  it("rejects a stale v1 writer atomically before it can overwrite Guest party size", async () => {
    const { workspace } = await createWorkspace("Stale writer 婚宴");
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord("stale-v1-writer")]),
    );
    await importLineinRsvpRecords({
      client: prisma,
      workspaceId: workspace.id,
      records,
      apply: true,
    });
    const record = await prisma.guestImportRecord.findFirstOrThrow({
      where: { workspaceId: workspace.id, externalId: "stale-v1-writer" },
      include: { guest: true },
    });
    await prisma.guest.update({
      where: { id: record.guestId },
      data: { partySize: 5 },
    });
    const beforeWriter = await prisma.guestImportRecord.findUniqueOrThrow({
      where: { id: record.id },
      include: { guest: true },
    });

    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          UPDATE "guests"
          SET
            "party_size" = ${9},
            "version" = "version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${record.guestId}
            AND "workspace_id" = ${workspace.id}
        `;
        await transaction.$executeRaw`
          UPDATE "guest_rsvps"
          SET
            "source_managed" = TRUE,
            "managed_fields" = ARRAY[
              'NAME'::"GuestManagedField",
              'SIDE'::"GuestManagedField",
              'ATTENDANCE_STATUS'::"GuestManagedField",
              'PARTY_SIZE'::"GuestManagedField"
            ],
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${record.id}
            AND "workspace_id" = ${workspace.id}
        `;
      }),
    ).rejects.toBeDefined();

    await expect(
      prisma.guestImportRecord.findUniqueOrThrow({
        where: { id: record.id },
        include: { guest: true },
      }),
    ).resolves.toEqual(beforeWriter);
  });

  it("preserves an immutable batch row when its imported Guest is deleted", async () => {
    const fixture = await createWorkspace("Guest 匯入稽核保留");
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord("delete-audit-row")]),
    );

    await importLineinRsvpRecords({
      client: prisma,
      workspaceId: fixture.workspace.id,
      records,
      apply: true,
    });
    const batch = await prisma.guestImportBatch.findFirstOrThrow({
      where: { workspaceId: fixture.workspace.id },
      include: { rows: true },
    });
    const row = batch.rows[0];
    const importRecord = await prisma.guestImportRecord.findUniqueOrThrow({
      where: { id: row.guestImportRecordId ?? "" },
      select: { guestId: true },
    });

    await prisma.guest.delete({ where: { id: importRecord.guestId } });

    await expect(
      prisma.guestImportBatch.findUnique({ where: { id: batch.id } }),
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
      totalRows: 1,
      succeededRows: 1,
    });
    await expect(
      prisma.guestImportBatchRow.findUnique({ where: { id: row.id } }),
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
      externalId: "delete-audit-row",
      guestImportRecordId: null,
    });
  });

  it("does not create a Guest after an accepted editor membership is concurrently revoked", async () => {
    const owner = await createWorkspace("Guest 撤權競態");
    sequence += 1;
    const editor = await prisma.user.create({
      data: {
        googleSubject: `rsvp-revoked-editor-${sequence}`,
        email: `rsvp-revoked-editor-${sequence}@example.test`,
      },
    });
    await prisma.membership.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: editor.id,
        role: "PLANNER",
      },
    });
    authState.userId = editor.id;

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
            workspaceId: owner.workspace.id,
            userId: editor.id,
          },
        },
      });
      markRevocationStarted();
      await holdRevocation;
    });

    const formData = new FormData();
    formData.set("name", "撤權後不可新增");
    formData.set("side", "SHARED");
    formData.set("attendanceStatus", "ATTENDING");
    formData.set("partySize", "1");

    await revocationStarted;
    const createResult = createGuestAction(
      owner.workspace.id,
      idleState,
      formData,
    );
    try {
      await waitForMembershipLockWaiter();
    } finally {
      releaseRevocation();
    }
    await revocation;

    await expect(createResult).resolves.toMatchObject({ status: "error" });
    expect(
      await prisma.guest.count({ where: { workspaceId: owner.workspace.id } }),
    ).toBe(0);
  });

  it("attaches multiple sources to one canonical Guest without duplicating it", async () => {
    const { workspace } = await createWorkspace("Multi-source 婚宴");
    const guest = await createGuest(workspace.id, "Canonical 賓客");

    await prisma.guestImportRecord.createMany({
      data: [
        rsvpData(guest.id, workspace.id, "linein-id"),
        rsvpData(guest.id, workspace.id, "formstack-id", {
          source: "FORMSTACK",
          sourceLabel: "合成表單",
          sourceManaged: false,
          managedFields: [],
          sourcePartySize: null,
          relationshipLabel: null,
          contactPhone: null,
          contactEmail: null,
          ceremonyAttendance: null,
          childSeatCount: null,
          vegetarianCount: null,
          invitationDelivery: null,
          mailingAddress: null,
          guestMessage: null,
          attendanceReply: null,
          invitationReply: null,
          sourceSubmittedAt: null,
        }),
      ],
    });

    const canonicalGuests = await prisma.guest.findMany({
      where: { workspaceId: workspace.id },
      include: { importRecords: { orderBy: { source: "asc" } } },
    });
    expect(canonicalGuests).toHaveLength(1);
    expect(canonicalGuests[0].importRecords).toHaveLength(2);
    expect(canonicalGuests[0].importRecords.map((record) => record.source)).toEqual([
      "FORMSTACK",
      "LINEIN",
    ]);

    await expect(
      prisma.guestImportRecord.create({
        data: rsvpData(guest.id, workspace.id, "second-linein-id"),
      }),
    ).rejects.toBeDefined();
  });

  it("rejects a forged cross-workspace Guest relation", async () => {
    const first = await createWorkspace("第一婚宴");
    const second = await createWorkspace("第二婚宴");
    const secondGuest = await createGuest(second.workspace.id, "第二婚宴賓客");

    await expect(
      prisma.guestImportRecord.create({
        data: rsvpData(
          secondGuest.id,
          first.workspace.id,
          "forged-cross-workspace",
        ),
      }),
    ).rejects.toBeDefined();
    expect(await prisma.guestImportRecord.count()).toBe(0);
  });

  it("cascades through Guest delete and workspace delete", async () => {
    const first = await createWorkspace("Guest cascade");
    const guest = await createGuest(first.workspace.id, "待刪賓客");
    await prisma.guestImportRecord.create({
      data: rsvpData(guest.id, first.workspace.id, "guest-cascade"),
    });

    await prisma.guest.delete({ where: { id: guest.id } });
    expect(await prisma.guestImportRecord.count()).toBe(0);

    const workspaceGuest = await createGuest(first.workspace.id, "工作區待刪賓客");
    await prisma.guestImportRecord.create({
      data: rsvpData(
        workspaceGuest.id,
        first.workspace.id,
        "workspace-cascade",
      ),
    });
    await prisma.weddingWorkspace.delete({ where: { id: first.workspace.id } });
    expect(await prisma.guest.count()).toBe(0);
    expect(await prisma.guestImportRecord.count()).toBe(0);
  });

  it("enforces child-seat, vegetarian, and bounded-string checks", async () => {
    const { workspace } = await createWorkspace("Constraint 婚宴");

    for (const overrides of [
      { childSeatCount: -1 },
      { childSeatCount: 21 },
      { vegetarianCount: -1 },
      { vegetarianCount: 21 },
      { relationshipLabel: "關".repeat(101) },
      { contactPhone: "0".repeat(41) },
      { guestMessage: "祝".repeat(1001) },
    ]) {
      const guest = await createGuest(workspace.id, "Constraint 賓客");
      await expect(
        prisma.guestImportRecord.create({
          data: rsvpData(
            guest.id,
            workspace.id,
            `constraint-${guest.id}`,
            overrides,
          ),
        }),
      ).rejects.toBeDefined();
    }
  });

  it("rejects malformed generic source keys and labels", async () => {
    const { workspace } = await createWorkspace("Source constraint 婚宴");

    for (const overrides of [
      { source: "lowercase" },
      { source: "_LEADING_UNDERSCORE" },
      { sourceLabel: "" },
      { sourceLabel: " 前後空白 " },
      { sourceLabel: "源".repeat(121) },
    ]) {
      const guest = await createGuest(workspace.id, "Source constraint 賓客");
      await expect(
        prisma.guestImportRecord.create({
          data: rsvpData(
            guest.id,
            workspace.id,
            `source-constraint-${guest.id}`,
            overrides,
          ),
        }),
      ).rejects.toBeDefined();
    }
  });

  it("stores source time as TIMESTAMPTZ(3) and enforces UNKNOWN/PAPER invitation states", async () => {
    const { workspace } = await createWorkspace("Invitation constraint 婚宴");
    const unknownGuest = await createGuest(workspace.id, "未填喜帖");
    await expect(
      prisma.guestImportRecord.create({
        data: rsvpData(unknownGuest.id, workspace.id, "unknown-invitation", {
          invitationDelivery: "UNKNOWN",
          invitationReply: null,
        }),
      }),
    ).resolves.toBeDefined();

    for (const overrides of [
      { invitationDelivery: "UNKNOWN", invitationReply: "不得有回覆" },
      { invitationDelivery: "PAPER", mailingAddress: null, invitationReply: "紙本" },
      { invitationDelivery: "PAPER", mailingAddress: "地址", invitationReply: null },
    ]) {
      const guest = await createGuest(workspace.id, "無效喜帖狀態");
      await expect(
        prisma.guestImportRecord.create({
          data: rsvpData(
            guest.id,
            workspace.id,
            `invalid-invitation-${guest.id}`,
            overrides,
          ),
        }),
      ).rejects.toBeDefined();
    }

    const columns = await prisma.$queryRaw<
      Array<{ data_type: string; datetime_precision: number | null }>
    >`
      SELECT data_type, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'guest_rsvps'
        AND column_name = 'source_submitted_at'
    `;
    expect(columns).toEqual([
      { data_type: "timestamp with time zone", datetime_precision: 3 },
    ]);
  });

  it("serializes parallel double-imports to one Guest and one RSVP", async () => {
    const { workspace } = await createWorkspace("Parallel import 婚宴");
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord("parallel-source-id")]),
    );

    const results = await Promise.all([
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: workspace.id,
        records,
        apply: true,
      }),
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: workspace.id,
        records,
        apply: true,
      }),
    ]);

    expect(results.map((result) => result.create + result.unchanged).sort()).toEqual([
      1,
      1,
    ]);
    expect(await prisma.guest.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect(await prisma.guestImportRecord.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });

  it("refuses a mixed full snapshot when an existing LINEIN ID is absent", async () => {
    const { workspace } = await createWorkspace("Full snapshot 婚宴");
    const firstRecords = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord("first-source-id")]),
    );
    const secondRecords = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord("second-source-id")]),
    );
    await importLineinRsvpRecords({
      client: prisma,
      workspaceId: workspace.id,
      records: firstRecords,
      apply: true,
    });

    await expect(
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: workspace.id,
        records: secondRecords,
        apply: true,
      }),
    ).resolves.toMatchObject({ conflict: 1, applied: false });
    expect(await prisma.guest.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect(await prisma.guestImportRecord.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });

  it("keeps assigned operational party size stable across parallel source updates", async () => {
    const { workspace } = await createWorkspace("Capacity race 婚宴");
    const initialRecords = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        { ...sourceRecord("capacity-a"), partySize: 1 },
        { ...sourceRecord("capacity-b"), partySize: 1 },
      ]),
    );
    await importLineinRsvpRecords({
      client: prisma,
      workspaceId: workspace.id,
      records: initialRecords,
      apply: true,
    });
    const table = await prisma.seatingTable.create({
      data: {
        workspaceId: workspace.id,
        position: 1,
        name: "競速桌",
        capacity: 3,
      },
    });
    await prisma.guest.updateMany({
      where: { workspaceId: workspace.id },
      data: { seatingTableId: table.id },
    });

    const increaseA = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        { ...sourceRecord("capacity-a"), partySize: 2 },
        { ...sourceRecord("capacity-b"), partySize: 1 },
      ]),
    );
    const increaseB = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        { ...sourceRecord("capacity-a"), partySize: 1 },
        { ...sourceRecord("capacity-b"), partySize: 2 },
      ]),
    );
    const results = await Promise.all([
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: workspace.id,
        records: increaseA,
        apply: true,
      }),
      importLineinRsvpRecords({
        client: prisma,
        workspaceId: workspace.id,
        records: increaseB,
        apply: true,
      }),
    ]);

    const assigned = await prisma.guest.aggregate({
      where: { workspaceId: workspace.id, seatingTableId: table.id },
      _sum: { partySize: true },
    });
    expect(assigned._sum.partySize).toBe(2);
    expect(
      results.every((result) => result.applied && result.conflict === 0),
    ).toBe(true);
  });
});
