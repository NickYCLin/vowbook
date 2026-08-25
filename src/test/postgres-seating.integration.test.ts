import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";

const authState = vi.hoisted(() => ({ userId: "" }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({ id: authState.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { updateGuestAction } from "@/actions/guests";
import { getSeatingPlan } from "@/lib/seating-plan";
import {
  adjustSeatingTablesAction,
  assignGuestToTableAction,
  createSeatingTableAction,
  deleteSeatingTableAction,
  unassignGuestFromTableAction,
  swapSeatingTableContentsAction,
  updateSeatingTableLayoutAction,
  updateSeatingTableAction,
} from "@/actions/seating-tables";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const idleState = { status: "idle" as const };
let sequence = 0;
let tablePositionSequence = 0;

function tableForm(
  name: string,
  capacity: number,
  expectedVersion = 0,
): FormData {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("capacity", String(capacity));
  formData.set("notes", "integration");
  formData.set("expectedVersion", String(expectedVersion));
  return formData;
}

function assignmentForm(tableId: string): FormData {
  const formData = new FormData();
  formData.set("tableId", tableId);
  return formData;
}

function layoutForm(
  layoutX: number | null,
  layoutY: number | null,
  expectedVersion: number,
): FormData {
  const formData = new FormData();
  formData.set("layoutX", layoutX === null ? "" : String(layoutX));
  formData.set("layoutY", layoutY === null ? "" : String(layoutY));
  formData.set("expectedVersion", String(expectedVersion));
  return formData;
}

function swapForm(
  targetTableId: string,
  expectedVersion: number,
  targetExpectedVersion: number,
): FormData {
  const formData = new FormData();
  formData.set("targetTableId", targetTableId);
  formData.set("expectedVersion", String(expectedVersion));
  formData.set("targetExpectedVersion", String(targetExpectedVersion));
  return formData;
}

function adjustmentForm(
  totalTableCount: number,
  defaultCapacity: number,
  snapshotFingerprint?: string,
): FormData {
  const formData = new FormData();
  formData.set("totalTableCount", String(totalTableCount));
  formData.set("defaultCapacity", String(defaultCapacity));
  if (snapshotFingerprint) {
    formData.set("snapshotFingerprint", snapshotFingerprint);
  }
  return formData;
}

function guestForm(
  name: string,
  partySize: number,
  expectedVersion: number,
): FormData {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("side", "SHARED");
  formData.set("attendanceStatus", "ATTENDING");
  formData.set("partySize", String(partySize));
  formData.set("notes", "integration");
  formData.set("expectedVersion", String(expectedVersion));
  return formData;
}

async function createWorkspace(label = "並行測試") {
  sequence += 1;
  const user = await prisma.user.create({
    data: {
      googleSubject: `postgres-it-${sequence}`,
      email: `postgres-it-${sequence}@example.test`,
    },
  });
  const workspace = await prisma.weddingWorkspace.create({
    data: {
      name: label,
      createdById: user.id,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  authState.userId = user.id;
  return { user, workspace };
}

async function createTable(workspaceId: string, name: string, capacity: number) {
  tablePositionSequence += 1;
  return prisma.seatingTable.create({
    data: { workspaceId, position: tablePositionSequence, name, capacity },
  });
}

async function createGuest(
  workspaceId: string,
  name: string,
  partySize: number,
  seatingTableId: string | null = null,
) {
  return prisma.guest.create({
    data: {
      workspaceId,
      name,
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize,
      seatingTableId,
    },
  });
}

async function assertCapacityInvariant(workspaceId: string, tableId: string) {
  const table = await prisma.seatingTable.findUnique({
    where: { id_workspaceId: { id: tableId, workspaceId } },
    include: { guests: { select: { partySize: true } } },
  });
  if (!table) {
    return;
  }
  const occupancy = table.guests.reduce((sum, guest) => sum + guest.partySize, 0);
  expect(occupancy).toBeLessThanOrEqual(table.capacity);
}

type DatabaseLockBarrier = {
  waitForWaiters: (expectedCount: number) => Promise<number>;
  waitForWaitersHoldingAdvisoryLock: (
    expectedCount: number,
    advisoryKey: string,
  ) => Promise<number>;
  release: () => Promise<void>;
};

async function createDatabaseLockBarrier(
  acquire: (transaction: Prisma.TransactionClient) => Promise<void>,
  { advisoryOnly = false }: { advisoryOnly?: boolean } = {},
): Promise<DatabaseLockBarrier> {
  const timeoutMs = 4_000;
  const pollIntervalMs = 25;
  let releaseHolder: (() => void) | undefined;
  let resolveReady:
    | ((barrier: DatabaseLockBarrier) => void)
    | undefined;
  let rejectReady: ((error: unknown) => void) | undefined;
  let resolveCompletion: (() => void) | undefined;
  let rejectCompletion: ((error: unknown) => void) | undefined;
  let released = false;
  const releaseSignal = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });
  const ready = new Promise<DatabaseLockBarrier>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const holderCompletion = prisma.$transaction(
    async (transaction) => {
      await acquire(transaction);
      const backend = await transaction.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid()::int AS pid
      `;
      const holderPid = backend[0]?.pid;
      if (!Number.isInteger(holderPid)) {
        throw new Error("Could not establish the database lock barrier.");
      }

      resolveReady?.({
        waitForWaiters: async (expectedCount) => {
          const deadline = Date.now() + timeoutMs;
          let observedCount = 0;

          do {
            const rows = await prisma.$queryRaw<
              Array<{ waiterCount: number }>
            >`
              WITH RECURSIVE blocked(pid) AS (
                SELECT waiting.pid
                FROM pg_stat_activity AS waiting
                WHERE ${holderPid} = ANY(pg_blocking_pids(waiting.pid))

                UNION

                SELECT waiting.pid
                FROM pg_stat_activity AS waiting
                INNER JOIN blocked AS blocker
                  ON blocker.pid = ANY(pg_blocking_pids(waiting.pid))
              )
              SELECT count(DISTINCT waiting.pid)::int AS "waiterCount"
              FROM blocked
              INNER JOIN pg_stat_activity AS waiting USING (pid)
              WHERE waiting.wait_event_type = 'Lock'
                AND (${advisoryOnly} = FALSE OR waiting.wait_event = 'advisory')
            `;
            observedCount = rows[0]?.waiterCount ?? 0;
            if (observedCount >= expectedCount) {
              return observedCount;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, pollIntervalMs),
            );
          } while (Date.now() < deadline);

          throw new Error(
            `Expected ${expectedCount} database lock waiter(s); observed ${observedCount} within ${timeoutMs}ms.`,
          );
        },
        waitForWaitersHoldingAdvisoryLock: async (
          expectedCount,
          advisoryKey,
        ) => {
          const deadline = Date.now() + timeoutMs;
          let observedCount = 0;

          do {
            const rows = await prisma.$queryRaw<Array<{ waiterCount: number }>>`
              WITH RECURSIVE blocked(pid) AS (
                SELECT waiting.pid
                FROM pg_stat_activity AS waiting
                WHERE ${holderPid} = ANY(pg_blocking_pids(waiting.pid))

                UNION

                SELECT waiting.pid
                FROM pg_stat_activity AS waiting
                INNER JOIN blocked AS blocker
                  ON blocker.pid = ANY(pg_blocking_pids(waiting.pid))
              )
              SELECT count(DISTINCT locks.pid)::int AS "waiterCount"
              FROM pg_locks AS locks
              INNER JOIN blocked ON blocked.pid = locks.pid
              WHERE locks.locktype = 'advisory'
                AND locks.mode = 'ExclusiveLock'
                AND locks.granted
                AND locks.objsubid = 1
                AND locks.classid::bigint = (
                  (hashtextextended(${advisoryKey}, 0) >> 32) & 4294967295
                )
                AND locks.objid::bigint = (
                  hashtextextended(${advisoryKey}, 0) & 4294967295
                )
            `;
            observedCount = rows[0]?.waiterCount ?? 0;
            if (observedCount >= expectedCount) {
              return observedCount;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, pollIntervalMs),
            );
          } while (Date.now() < deadline);

          throw new Error(
            `Expected ${expectedCount} row-lock waiter(s) holding a granted advisory lock; observed ${observedCount} within ${timeoutMs}ms.`,
          );
        },
        release: async () => {
          if (!released) {
            released = true;
            releaseHolder?.();
          }
          await completion;
        },
      });

      await releaseSignal;
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
  void holderCompletion.then(
    () => resolveCompletion?.(),
    (error) => {
      rejectReady?.(error);
      rejectCompletion?.(error);
    },
  );

  return ready;
}

describeDatabase.sequential("PostgreSQL seating concurrency and tenant invariants", () => {
  beforeEach(async () => {
    revalidatePath.mockClear();
    await prisma.weddingWorkspace.deleteMany();
    await prisma.user.deleteMany();
    tablePositionSequence = 0;
  });

  afterAll(async () => {
    if (runDatabaseIntegration) {
      await prisma.weddingWorkspace.deleteMany();
      await prisma.user.deleteMany();
    }
    await prisma.$disconnect();
  });

  it("keeps declined guests out of the assignable queue and rejects direct assignment", async () => {
    const { workspace } = await createWorkspace("不出席桌次限制");
    const table = await createTable(workspace.id, "親友桌", 10);
    const [attending, undecided, declined] = await Promise.all([
      prisma.guest.create({
        data: {
          workspaceId: workspace.id,
          name: "確認出席",
          side: "PARTNER_A",
          attendanceStatus: "ATTENDING",
          partySize: 2,
        },
      }),
      prisma.guest.create({
        data: {
          workspaceId: workspace.id,
          name: "尚未回覆",
          side: "PARTNER_B",
          attendanceStatus: "UNDECIDED",
          partySize: 1,
        },
      }),
      prisma.guest.create({
        data: {
          workspaceId: workspace.id,
          name: "不出席賓客",
          side: "SHARED",
          attendanceStatus: "DECLINED",
          partySize: 3,
        },
      }),
    ]);

    const seatingPlan = await getSeatingPlan(workspace.id);
    const unassignedGuestIds = seatingPlan.unassignedGuests.map((guest) => guest.id);
    expect(unassignedGuestIds).toEqual(
      expect.arrayContaining([attending.id, undecided.id]),
    );
    expect(unassignedGuestIds).not.toContain(declined.id);

    await expect(
      assignGuestToTableAction(
        workspace.id,
        declined.id,
        idleState,
        assignmentForm(table.id),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "此賓客已標記為不出席，無法安排座位。",
    });
    await expect(
      prisma.guest.findUniqueOrThrow({ where: { id: declined.id } }),
    ).resolves.toMatchObject({ seatingTableId: null });

    await expect(
      assignGuestToTableAction(
        workspace.id,
        attending.id,
        idleState,
        assignmentForm(table.id),
      ),
    ).resolves.toMatchObject({ status: "success" });
  });

  it("rejects legacy coordinate writes so table numbers keep fixed slots", async () => {
    const owner = await createWorkspace("場地座標操作方");
    const table = await createTable(owner.workspace.id, "主桌", 10);

    await expect(
      updateSeatingTableLayoutAction(
        owner.workspace.id,
        table.id,
        idleState,
        layoutForm(240, 680, table.version),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "桌號與位置固定，請改用交換桌名與賓客。",
    });
    await expect(
      prisma.seatingTable.findUniqueOrThrow({ where: { id: table.id } }),
    ).resolves.toMatchObject({ layoutX: null, layoutY: null, version: 0 });

    // 儲存層仍保留成對座標約束，供既有資料用整體重新排列清除。
    await expect(
      prisma.seatingTable.update({
        where: { id: table.id },
        data: { layoutX: 500, layoutY: null },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.seatingTable.update({
        where: { id: table.id },
        data: { layoutX: 1001, layoutY: 500 },
      }),
    ).rejects.toBeDefined();
  });

  it("keeps fixed table slots while atomically swapping names and assigned guests", async () => {
    const { workspace } = await createWorkspace("固定桌號內容交換");
    const originalA = await createTable(workspace.id, "主桌", 10);
    const originalB = await createTable(workspace.id, "親友桌", 8);
    const tableA = await prisma.seatingTable.update({
      where: { id: originalA.id },
      data: { layoutX: 100, layoutY: 200, notes: "第一桌位置" },
    });
    const tableB = await prisma.seatingTable.update({
      where: { id: originalB.id },
      data: { layoutX: 800, layoutY: 700, notes: "第二桌位置" },
    });
    const guestA = await createGuest(workspace.id, "主桌賓客", 3, tableA.id);
    const guestB = await createGuest(workspace.id, "親友桌賓客", 2, tableB.id);

    await expect(
      swapSeatingTableContentsAction(
        workspace.id,
        tableA.id,
        idleState,
        swapForm(tableB.id, tableA.version, tableB.version),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已交換兩桌的桌名與入座賓客；桌號保持不變。",
    });

    await expect(
      prisma.seatingTable.findUniqueOrThrow({ where: { id: tableA.id } }),
    ).resolves.toMatchObject({
      id: tableA.id,
      position: tableA.position,
      name: "親友桌",
      capacity: 10,
      notes: "第一桌位置",
      layoutX: 100,
      layoutY: 200,
      version: tableA.version + 1,
    });
    await expect(
      prisma.seatingTable.findUniqueOrThrow({ where: { id: tableB.id } }),
    ).resolves.toMatchObject({
      id: tableB.id,
      position: tableB.position,
      name: "主桌",
      capacity: 8,
      notes: "第二桌位置",
      layoutX: 800,
      layoutY: 700,
      version: tableB.version + 1,
    });
    await expect(
      prisma.guest.findUniqueOrThrow({ where: { id: guestA.id } }),
    ).resolves.toMatchObject({
      seatingTableId: tableB.id,
      version: guestA.version + 1,
    });
    await expect(
      prisma.guest.findUniqueOrThrow({ where: { id: guestB.id } }),
    ).resolves.toMatchObject({
      seatingTableId: tableA.id,
      version: guestB.version + 1,
    });
  });

  it("rejects a content swap atomically when a fixed table would overflow", async () => {
    const { workspace } = await createWorkspace("固定容量交換");
    const tableA = await createTable(workspace.id, "小桌", 4);
    const tableB = await createTable(workspace.id, "大桌", 8);
    const guestA = await createGuest(workspace.id, "小桌賓客", 2, tableA.id);
    const guestB = await createGuest(workspace.id, "大桌賓客", 6, tableB.id);

    await expect(
      swapSeatingTableContentsAction(
        workspace.id,
        tableA.id,
        idleState,
        swapForm(tableB.id, tableA.version, tableB.version),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "交換後會超過其中一桌的容量，請先調整座位或桌次容量。",
    });

    await expect(
      prisma.seatingTable.findUniqueOrThrow({ where: { id: tableA.id } }),
    ).resolves.toMatchObject({ name: "小桌", version: tableA.version });
    await expect(
      prisma.seatingTable.findUniqueOrThrow({ where: { id: tableB.id } }),
    ).resolves.toMatchObject({ name: "大桌", version: tableB.version });
    await expect(
      prisma.guest.findUniqueOrThrow({ where: { id: guestA.id } }),
    ).resolves.toMatchObject({ seatingTableId: tableA.id, version: guestA.version });
    await expect(
      prisma.guest.findUniqueOrThrow({ where: { id: guestB.id } }),
    ).resolves.toMatchObject({ seatingTableId: tableB.id, version: guestB.version });
  });

  it("allows at most one concurrent assignment when only one group fits", async () => {
    const { workspace } = await createWorkspace();
    const table = await createTable(workspace.id, "主桌", 5);
    const [guestA, guestB] = await Promise.all([
      createGuest(workspace.id, "甲方親友", 3),
      createGuest(workspace.id, "乙方親友", 3),
    ]);

    const results = await Promise.all([
      assignGuestToTableAction(
        workspace.id,
        guestA.id,
        idleState,
        assignmentForm(table.id),
      ),
      assignGuestToTableAction(
        workspace.id,
        guestB.id,
        idleState,
        assignmentForm(table.id),
      ),
    ]);

    expect(results.filter((result) => result.status === "success")).toHaveLength(1);
    expect(
      await prisma.guest.count({
        where: { workspaceId: workspace.id, seatingTableId: table.id },
      }),
    ).toBe(1);
    await assertCapacityInvariant(workspace.id, table.id);
  });

  it("keeps capacity valid when a content swap races a new assignment", async () => {
    const { workspace } = await createWorkspace("交換與排座位競態");
    const tableA = await createTable(workspace.id, "A 桌", 10);
    const tableB = await createTable(workspace.id, "B 桌", 10);
    const seated = await createGuest(workspace.id, "B 桌既有賓客", 8, tableB.id);
    const candidate = await createGuest(workspace.id, "同時排入賓客", 3);

    const [swapResult, assignmentResult] = await Promise.all([
      swapSeatingTableContentsAction(
        workspace.id,
        tableA.id,
        idleState,
        swapForm(tableB.id, tableA.version, tableB.version),
      ),
      assignGuestToTableAction(
        workspace.id,
        candidate.id,
        idleState,
        assignmentForm(tableA.id),
      ),
    ]);

    expect(swapResult).toMatchObject({ status: "success" });
    expect(["success", "error"]).toContain(assignmentResult.status);
    await expect(
      prisma.guest.findUniqueOrThrow({ where: { id: seated.id } }),
    ).resolves.toMatchObject({ seatingTableId: tableA.id });
    await assertCapacityInvariant(workspace.id, tableA.id);
    await assertCapacityInvariant(workspace.id, tableB.id);
  });

  it("keeps capacity valid when assignment races a capacity shrink", async () => {
    const { workspace } = await createWorkspace();
    const table = await createTable(workspace.id, "親友桌", 10);
    await createGuest(workspace.id, "已入席", 6, table.id);
    const candidate = await createGuest(workspace.id, "候補", 4);

    await Promise.all([
      updateSeatingTableAction(
        workspace.id,
        table.id,
        idleState,
        tableForm("親友桌", 6),
      ),
      assignGuestToTableAction(
        workspace.id,
        candidate.id,
        idleState,
        assignmentForm(table.id),
      ),
    ]);

    await assertCapacityInvariant(workspace.id, table.id);
  });

  it("keeps capacity valid when assignment races an assigned party-size increase", async () => {
    const { workspace } = await createWorkspace();
    const table = await createTable(workspace.id, "同事桌", 10);
    const assigned = await createGuest(workspace.id, "已安排群組", 4, table.id);
    const candidate = await createGuest(workspace.id, "新群組", 4);

    await Promise.all([
      updateGuestAction(
        workspace.id,
        assigned.id,
        idleState,
        guestForm("已安排群組", 7, assigned.version),
      ),
      assignGuestToTableAction(
        workspace.id,
        candidate.id,
        idleState,
        assignmentForm(table.id),
      ),
    ]);

    await assertCapacityInvariant(workspace.id, table.id);
  });

  it("keeps capacity valid when two assigned groups grow concurrently", async () => {
    const { workspace } = await createWorkspace();
    const table = await createTable(workspace.id, "家人桌", 10);
    const [guestA, guestB] = await Promise.all([
      createGuest(workspace.id, "群組甲", 3, table.id),
      createGuest(workspace.id, "群組乙", 3, table.id),
    ]);

    await Promise.all([
      updateGuestAction(
        workspace.id,
        guestA.id,
        idleState,
        guestForm("群組甲", 6, guestA.version),
      ),
      updateGuestAction(
        workspace.id,
        guestB.id,
        idleState,
        guestForm("群組乙", 6, guestB.version),
      ),
    ]);

    await assertCapacityInvariant(workspace.id, table.id);
  });

  it("stores one final table when the same guest is moved concurrently", async () => {
    const { workspace } = await createWorkspace();
    const [tableA, tableB] = await Promise.all([
      createTable(workspace.id, "A 桌", 10),
      createTable(workspace.id, "B 桌", 10),
    ]);
    const guest = await createGuest(workspace.id, "同一位賓客", 2);

    await Promise.all([
      assignGuestToTableAction(
        workspace.id,
        guest.id,
        idleState,
        assignmentForm(tableA.id),
      ),
      assignGuestToTableAction(
        workspace.id,
        guest.id,
        idleState,
        assignmentForm(tableB.id),
      ),
    ]);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect([tableA.id, tableB.id]).toContain(stored.seatingTableId);
    const totalAssignments = await prisma.guest.count({
      where: {
        id: guest.id,
        seatingTableId: { in: [tableA.id, tableB.id] },
      },
    });
    expect(totalAssignments).toBe(1);
    await assertCapacityInvariant(workspace.id, tableA.id);
    await assertCapacityInvariant(workspace.id, tableB.id);
  });

  it("queues delete behind assignment and returns a stale occupied confirmation", async () => {
    const { workspace } = await createWorkspace();
    const table = await createTable(workspace.id, "安排先勝桌", 10);
    const guest = await createGuest(workspace.id, "安排先勝賓客", 2);
    const preview = await deleteSeatingTableAction(
      workspace.id,
      table.id,
      idleState,
      new FormData(),
    );
    if (preview.status !== "confirmation" || !preview.confirmation.canConfirm) {
      throw new Error("expected an empty-table deletion preview");
    }
    const confirmForm = new FormData();
    confirmForm.set(
      "snapshotFingerprint",
      preview.confirmation.fingerprint,
    );
    const barrier = await createDatabaseLockBarrier(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        FROM "guests"
        WHERE "id" = ${guest.id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Could not lock the expected guest row.");
      }
    });
    const assignment = assignGuestToTableAction(
      workspace.id,
      guest.id,
      idleState,
      assignmentForm(table.id),
    );
    let deletion:
      | ReturnType<typeof deleteSeatingTableAction>
      | undefined;
    let barrierError: unknown;
    try {
      await barrier.waitForWaiters(1);
      deletion = deleteSeatingTableAction(
        workspace.id,
        table.id,
        preview,
        confirmForm,
      );
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }
    const [assignmentResult, deletionResult] = await Promise.all([
      assignment,
      deletion ?? Promise.reject(new Error("Confirmed deletion did not start.")),
    ]);
    if (barrierError) {
      throw barrierError;
    }

    const storedTable = await prisma.seatingTable.findUnique({
      where: { id: table.id },
    });
    const storedGuest = await prisma.guest.findUniqueOrThrow({
      where: { id: guest.id },
    });
    expect(assignmentResult).toEqual({
      status: "success",
      message: "已安排賓客桌次。",
    });
    expect(deletionResult).toMatchObject({
      status: "confirmation",
      stale: true,
      confirmation: { canConfirm: false },
    });
    expect(storedTable).not.toBeNull();
    expect(storedGuest.seatingTableId).toBe(table.id);
  });

  it("queues assignment behind confirmed delete and preserves the deletion", async () => {
    const { workspace } = await createWorkspace();
    const table = await createTable(workspace.id, "刪除先勝桌", 10);
    const guest = await createGuest(workspace.id, "刪除先勝賓客", 2);
    const preview = await deleteSeatingTableAction(
      workspace.id,
      table.id,
      idleState,
      new FormData(),
    );
    if (preview.status !== "confirmation" || !preview.confirmation.canConfirm) {
      throw new Error("expected an empty-table deletion preview");
    }
    const confirmForm = new FormData();
    confirmForm.set(
      "snapshotFingerprint",
      preview.confirmation.fingerprint,
    );
    const barrier = await createDatabaseLockBarrier(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        FROM "seating_tables"
        WHERE "id" = ${table.id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Could not lock the expected seating table row.");
      }
    });
    const deletion = deleteSeatingTableAction(
      workspace.id,
      table.id,
      preview,
      confirmForm,
    );
    let assignment:
      | ReturnType<typeof assignGuestToTableAction>
      | undefined;
    let barrierError: unknown;
    try {
      await barrier.waitForWaiters(1);
      assignment = assignGuestToTableAction(
        workspace.id,
        guest.id,
        idleState,
        assignmentForm(table.id),
      );
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }
    const [deletionResult, assignmentResult] = await Promise.all([
      deletion,
      assignment ?? Promise.reject(new Error("Assignment did not start.")),
    ]);
    if (barrierError) {
      throw barrierError;
    }

    const storedTable = await prisma.seatingTable.findUnique({
      where: { id: table.id },
    });
    const storedGuest = await prisma.guest.findUniqueOrThrow({
      where: { id: guest.id },
    });
    expect(deletionResult).toEqual({
      status: "success",
      message: "已刪除空桌。",
    });
    expect(assignmentResult).toEqual({
      status: "error",
      message: "桌次不存在或已被移除，請重新整理後再試。",
    });
    expect(storedTable).toBeNull();
    expect(storedGuest.seatingTableId).toBeNull();
  });

  it("revalidates the destination capacity when a guest update races a move", async () => {
    const { workspace } = await createWorkspace();
    const [tableA, tableB] = await Promise.all([
      createTable(workspace.id, "原桌", 5),
      createTable(workspace.id, "小桌", 3),
    ]);
    const guest = await createGuest(workspace.id, "移動群組", 2, tableA.id);

    await Promise.all([
      updateGuestAction(
        workspace.id,
        guest.id,
        idleState,
        guestForm("移動群組", 4, guest.version),
      ),
      assignGuestToTableAction(
        workspace.id,
        guest.id,
        idleState,
        assignmentForm(tableB.id),
      ),
    ]);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    if (stored.seatingTableId === tableB.id) {
      expect(stored.partySize).toBeLessThanOrEqual(tableB.capacity);
    }
    await assertCapacityInvariant(workspace.id, tableA.id);
    await assertCapacityInvariant(workspace.id, tableB.id);
  });

  it("rejects cross-workspace relations and lets two tables share one name", async () => {
    const first = await createWorkspace("第一婚宴");
    const second = await createWorkspace("第二婚宴");
    authState.userId = first.user.id;
    const table = await createTable(first.workspace.id, "唯一桌名", 10);
    const outsiderGuest = await createGuest(second.workspace.id, "另一婚宴賓客", 2);

    await expect(
      prisma.guest.update({
        where: { id: outsiderGuest.id },
        data: { seatingTableId: table.id },
      }),
    ).rejects.toBeDefined();

    const results = await Promise.all([
      createSeatingTableAction(
        first.workspace.id,
        idleState,
        tableForm("並行同名桌", 8),
      ),
      createSeatingTableAction(
        first.workspace.id,
        idleState,
        tableForm("並行同名桌", 8),
      ),
    ]);
    // 桌名沒有唯一限制：兩張都叫「並行同名桌」是合法的，桌號才是身分。
    expect(results.filter((result) => result.status === "success")).toHaveLength(2);
    expect(
      await prisma.seatingTable.count({
        where: { workspaceId: first.workspace.id, name: "並行同名桌" },
      }),
    ).toBe(2);

    await expect(
      prisma.seatingTable.create({
        data: {
          workspaceId: first.workspace.id,
          position: 9999,
          name: " 前後空白桌 ",
          capacity: 8,
        },
      }),
    ).rejects.toBeDefined();

    await expect(
      prisma.seatingTable.create({
        data: {
          workspaceId: first.workspace.id,
          position: 0,
          name: "位置不得為零",
          capacity: 8,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.seatingTable.create({
        data: {
          workspaceId: first.workspace.id,
          position: table.position,
          name: "位置衝突桌",
          capacity: 8,
        },
      }),
    ).rejects.toBeDefined();
  });

  it("sets, increases, and safely reduces the total while preserving stable tables", async () => {
    const { workspace } = await createWorkspace("桌數調整整合測試");

    await expect(
      adjustSeatingTablesAction(
        workspace.id,
        idleState,
        adjustmentForm(2, 6),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已將總桌數設定為 2 桌。",
    });
    const initialTables = await prisma.seatingTable.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { position: "asc" },
    });
    expect(initialTables.map(({ position, capacity }) => ({ position, capacity }))).toEqual([
      { position: 1, capacity: 6 },
      { position: 2, capacity: 6 },
    ]);

    await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(3, 9),
    );
    const increasedTables = await prisma.seatingTable.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { position: "asc" },
    });
    expect(increasedTables.slice(0, 2).map((table) => table.id)).toEqual(
      initialTables.map((table) => table.id),
    );
    expect(increasedTables.slice(0, 2).map((table) => table.capacity)).toEqual([6, 6]);
    expect(increasedTables[2]?.capacity).toBe(9);

    const emptyPreview = await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(2, 10),
    );
    expect(emptyPreview).toMatchObject({
      status: "confirmation",
      confirmation: { canConfirm: true, removedTableCount: 1 },
    });
    if (emptyPreview.status !== "confirmation") {
      throw new Error("expected empty shrink preview");
    }
    await expect(
      adjustSeatingTablesAction(
        workspace.id,
        emptyPreview,
        adjustmentForm(
          2,
          10,
          emptyPreview.confirmation.fingerprint,
        ),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已縮減為 2 桌，並移除 1 桌空桌。",
    });
    expect(
      await prisma.seatingTable.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { position: "asc" },
        select: { id: true },
      }),
    ).toEqual(initialTables.map((table) => ({ id: table.id })));

    const guest = await createGuest(
      workspace.id,
      "縮桌賓客",
      4,
      initialTables[1]!.id,
    );
    const preview = await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(1, 10),
    );
    expect(preview).toMatchObject({
      status: "confirmation",
      confirmation: {
        removedTableCount: 1,
        affectedGuestGroupCount: 1,
        affectedGuestPartySize: 4,
        canConfirm: false,
      },
    });
    expect(await prisma.seatingTable.count({ where: { workspaceId: workspace.id } })).toBe(2);
    expect((await prisma.guest.findUnique({ where: { id: guest.id } }))?.seatingTableId).toBe(
      initialTables[1]!.id,
    );

    if (preview.status !== "confirmation") {
      throw new Error("expected occupied reduction confirmation");
    }
    await expect(
      adjustSeatingTablesAction(
        workspace.id,
        preview,
        adjustmentForm(1, 10, preview.confirmation.fingerprint),
      ),
    ).resolves.toMatchObject({
      status: "confirmation",
      confirmation: { canConfirm: false },
    });
    expect(await prisma.seatingTable.count({ where: { workspaceId: workspace.id } })).toBe(2);
    expect(await prisma.guest.findUnique({ where: { id: guest.id } })).toMatchObject({
      seatingTableId: initialTables[1]!.id,
      version: 0,
    });

    await unassignGuestFromTableAction(
      workspace.id,
      guest.id,
      idleState,
      new FormData(),
    );
    const nowEmptyPreview = await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(1, 10),
    );
    if (
      nowEmptyPreview.status !== "confirmation" ||
      !nowEmptyPreview.confirmation.canConfirm
    ) {
      throw new Error("expected empty shrink preview after explicit move");
    }
    await expect(
      adjustSeatingTablesAction(
        workspace.id,
        nowEmptyPreview,
        adjustmentForm(
          1,
          10,
          nowEmptyPreview.confirmation.fingerprint,
        ),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(await prisma.seatingTable.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect(await prisma.guest.findUnique({ where: { id: guest.id } })).toMatchObject({
      seatingTableId: null,
      version: 1,
    });
  });

  it("refuses stale reduction confirmation and serializes parallel total changes", async () => {
    const { workspace } = await createWorkspace("快照與並行桌數");
    await adjustSeatingTablesAction(workspace.id, idleState, adjustmentForm(2, 10));
    const tables = await prisma.seatingTable.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { position: "asc" },
    });
    const guest = await createGuest(workspace.id, "快照賓客", 2, tables[1]!.id);
    const preview = await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(1, 10),
    );
    if (preview.status !== "confirmation") {
      throw new Error("expected occupied reduction confirmation");
    }
    await prisma.guest.update({
      where: { id: guest.id },
      data: { partySize: 3, version: { increment: 1 } },
    });
    const stale = await adjustSeatingTablesAction(
      workspace.id,
      preview,
      adjustmentForm(1, 10, preview.confirmation.fingerprint),
    );
    expect(stale).toMatchObject({
      status: "confirmation",
      message: "桌次或賓客安排已變更，請重新確認最新影響。",
      confirmation: { affectedGuestPartySize: 3 },
    });
    expect(await prisma.seatingTable.count({ where: { workspaceId: workspace.id } })).toBe(2);
    expect((await prisma.guest.findUnique({ where: { id: guest.id } }))?.seatingTableId).toBe(
      tables[1]!.id,
    );

    const parallel = await createWorkspace("並行調整");
    const barrier = await createDatabaseLockBarrier(
      async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`vowbook:seating:${parallel.workspace.id}`}, 0)
          )
        `;
      },
      { advisoryOnly: true },
    );
    const writers = [
      adjustSeatingTablesAction(parallel.workspace.id, idleState, adjustmentForm(5, 8)),
      adjustSeatingTablesAction(parallel.workspace.id, idleState, adjustmentForm(7, 8)),
    ];
    let barrierError: unknown;
    try {
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }
    const results = await Promise.all(writers);
    if (barrierError) {
      throw barrierError;
    }
    expect(results.some((result) => result.status === "success")).toBe(true);
    expect(
      results.every((result) => result.status !== "error"),
      JSON.stringify(results),
    ).toBe(true);
    const finalTables = await prisma.seatingTable.findMany({
      where: { workspaceId: parallel.workspace.id },
      orderBy: { position: "asc" },
    });
    expect([5, 7]).toContain(finalTables.length);
    expect(new Set(finalTables.map((table) => table.position)).size).toBe(
      finalTables.length,
    );
  });

  it("refreshes a queued no-op adjustment after the seating sequence lock", async () => {
    const { workspace } = await createWorkspace("排隊後重讀桌數");
    await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(5, 8),
    );
    const barrier = await createDatabaseLockBarrier(
      async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`vowbook:seating:${workspace.id}`}, 0)
          )
        `;
      },
      { advisoryOnly: true },
    );

    const writerA = adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(7, 8),
    );
    let writerB:
      | ReturnType<typeof adjustSeatingTablesAction>
      | undefined;
    let barrierError: unknown;
    try {
      await barrier.waitForWaiters(1);
      writerB = adjustSeatingTablesAction(
        workspace.id,
        idleState,
        adjustmentForm(5, 8),
      );
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }

    const writerAResult = await writerA;
    const writerBResult = writerB ? await writerB : undefined;
    if (barrierError) {
      throw barrierError;
    }
    if (!writerBResult) {
      throw new Error("The queued target=5 writer did not start.");
    }

    expect(writerAResult).toEqual({
      status: "success",
      message: "已將總桌數設定為 7 桌。",
    });
    expect(writerBResult).toMatchObject({
      status: "confirmation",
      stale: false,
      confirmation: {
        operation: "adjust-table-count",
        targetTableCount: 5,
        removedTableCount: 2,
        canConfirm: true,
      },
    });
    expect(writerBResult).not.toMatchObject({
      status: "success",
      message: "目前已是 5 桌，桌次沒有變更。",
    });

    const durableTables = await prisma.seatingTable.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    expect(durableTables).toHaveLength(7);
    expect(new Set(durableTables.map((table) => table.position)).size).toBe(
      durableTables.length,
    );
  });

  it("serializes confirmed shrink behind assignment and preserves the valid writer", async () => {
    const { workspace } = await createWorkspace("減桌與安排競速");
    await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(2, 10),
    );
    const tables = await prisma.seatingTable.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { position: "asc" },
    });
    const guest = await createGuest(workspace.id, "競速賓客", 2);
    const preview = await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(1, 10),
    );
    if (
      preview.status !== "confirmation" ||
      !preview.confirmation.canConfirm
    ) {
      throw new Error("expected an empty shrink preview");
    }

    const barrier = await createDatabaseLockBarrier(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        FROM "guests"
        WHERE "id" = ${guest.id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Could not lock the expected guest row.");
      }
    });
    const assignment = assignGuestToTableAction(
      workspace.id,
      guest.id,
      idleState,
      assignmentForm(tables[1]!.id),
    );
    let barrierError: unknown;
    let shrink:
      | ReturnType<typeof adjustSeatingTablesAction>
      | undefined;
    try {
      await barrier.waitForWaiters(1);
      shrink = adjustSeatingTablesAction(
        workspace.id,
        preview,
        adjustmentForm(
          1,
          10,
          preview.confirmation.fingerprint,
        ),
      );
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }
    const [assignmentResult, shrinkResult] = await Promise.all([
      assignment,
      shrink ?? Promise.reject(new Error("Confirmed shrink did not start.")),
    ]);
    if (barrierError) {
      throw barrierError;
    }

    const storedLastTable = await prisma.seatingTable.findUnique({
      where: { id: tables[1]!.id },
    });
    const storedGuest = await prisma.guest.findUniqueOrThrow({
      where: { id: guest.id },
    });
    expect(assignmentResult).toEqual({
      status: "success",
      message: "已安排賓客桌次。",
    });
    expect(shrinkResult).toMatchObject({
      status: "confirmation",
      stale: true,
      confirmation: { canConfirm: false },
    });
    expect(storedLastTable).not.toBeNull();
    expect(storedGuest.seatingTableId).toBe(tables[1]!.id);
  });

  it("moves a tail-table guest while shrink rereads without a table-to-guest deadlock", async () => {
    const { workspace } = await createWorkspace("移桌與減桌鎖序");
    await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(2, 10),
    );
    const tables = await prisma.seatingTable.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { position: "asc" },
    });
    const retainedTable = tables[0]!;
    const tailTable = tables[1]!;
    const guest = await createGuest(
      workspace.id,
      "從尾桌移動的賓客",
      2,
      tailTable.id,
    );
    const occupiedPreview = await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(1, 10),
    );
    if (
      occupiedPreview.status !== "confirmation" ||
      occupiedPreview.confirmation.canConfirm
    ) {
      throw new Error("expected an occupied shrink preview");
    }
    const [databaseStatsBefore] = await prisma.$queryRaw<
      Array<{ deadlocks: bigint }>
    >`SELECT "deadlocks"::bigint AS "deadlocks" FROM "pg_stat_database" WHERE "datname" = current_database()`;
    if (!databaseStatsBefore) {
      throw new Error("Could not read the database deadlock counter.");
    }

    const barrier = await createDatabaseLockBarrier(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        FROM "guests"
        WHERE "id" = ${guest.id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Could not lock the expected guest row.");
      }
    });
    const assignment = assignGuestToTableAction(
      workspace.id,
      guest.id,
      idleState,
      assignmentForm(retainedTable.id),
    );
    let staleShrink:
      | ReturnType<typeof adjustSeatingTablesAction>
      | undefined;
    let barrierError: unknown;
    try {
      await barrier.waitForWaiters(1);
      staleShrink = adjustSeatingTablesAction(
        workspace.id,
        occupiedPreview,
        adjustmentForm(
          1,
          10,
          occupiedPreview.confirmation.fingerprint,
        ),
      );
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }
    const [assignmentResult, staleShrinkResult] = await Promise.all([
      assignment,
      staleShrink ?? Promise.reject(new Error("Occupied shrink did not start.")),
    ]);
    if (barrierError) {
      throw barrierError;
    }
    const [databaseStatsAfter] = await prisma.$queryRaw<
      Array<{ deadlocks: bigint }>
    >`SELECT "deadlocks"::bigint AS "deadlocks" FROM "pg_stat_database" WHERE "datname" = current_database()`;
    if (!databaseStatsAfter) {
      throw new Error("Could not reread the database deadlock counter.");
    }
    expect(databaseStatsAfter.deadlocks).toBe(databaseStatsBefore.deadlocks);

    expect(assignmentResult).toEqual({
      status: "success",
      message: "已安排賓客桌次。",
    });
    expect(staleShrinkResult).toMatchObject({
      status: "confirmation",
      stale: true,
      message: "桌次或賓客安排已變更，請重新確認最新影響。",
      confirmation: {
        targetTableCount: 1,
        removedTableCount: 1,
        affectedGuestGroupCount: 0,
        canConfirm: true,
      },
    });
    expect(
      await prisma.seatingTable.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(2);
    expect(
      await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } }),
    ).toMatchObject({ seatingTableId: retainedTable.id, version: 1 });
  });

  it("requires a fresh empty preview after unassign races an occupied confirmation", async () => {
    const { workspace } = await createWorkspace("減桌與移出競速");
    await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(2, 10),
    );
    const tables = await prisma.seatingTable.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { position: "asc" },
    });
    const guest = await createGuest(
      workspace.id,
      "待移出賓客",
      2,
      tables[1]!.id,
    );
    const occupiedPreview = await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(1, 10),
    );
    if (occupiedPreview.status !== "confirmation") {
      throw new Error("expected occupied shrink preview");
    }

    const barrier = await createDatabaseLockBarrier(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        FROM "guests"
        WHERE "id" = ${guest.id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Could not lock the expected guest row.");
      }
    });
    const unassignment = unassignGuestFromTableAction(
      workspace.id,
      guest.id,
      idleState,
      new FormData(),
    );
    let barrierError: unknown;
    let staleConfirmation:
      | ReturnType<typeof adjustSeatingTablesAction>
      | undefined;
    try {
      await barrier.waitForWaiters(1);
      staleConfirmation = adjustSeatingTablesAction(
        workspace.id,
        occupiedPreview,
        adjustmentForm(
          1,
          10,
          occupiedPreview.confirmation.fingerprint,
        ),
      );
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }
    const [unassignmentResult, staleConfirmationResult] = await Promise.all([
      unassignment,
      staleConfirmation ??
        Promise.reject(new Error("Occupied confirmation did not start.")),
    ]);
    if (barrierError) {
      throw barrierError;
    }

    expect(staleConfirmationResult.status).toBe("confirmation");
    expect(unassignmentResult.status).toBe("success");
    expect(
      await prisma.seatingTable.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(2);
    expect(
      await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } }),
    ).toMatchObject({ seatingTableId: null, version: 1 });

    const freshPreview = await adjustSeatingTablesAction(
      workspace.id,
      idleState,
      adjustmentForm(1, 10),
    );
    expect(freshPreview).toMatchObject({
      status: "confirmation",
      confirmation: { canConfirm: true },
    });
  });

  it("keeps an occupied single-table delete confirmation stale when unassign wins the guest-row lock", async () => {
    const { workspace } = await createWorkspace("單桌刪除與移出競速");
    const table = await createTable(workspace.id, "待移出後刪除", 10);
    const guest = await createGuest(
      workspace.id,
      "單桌待移出賓客",
      2,
      table.id,
    );
    const occupiedPreview = await deleteSeatingTableAction(
      workspace.id,
      table.id,
      idleState,
      new FormData(),
    );
    if (
      occupiedPreview.status !== "confirmation" ||
      occupiedPreview.confirmation.canConfirm
    ) {
      throw new Error("expected an occupied single-table delete preview");
    }
    const confirmForm = new FormData();
    confirmForm.set(
      "snapshotFingerprint",
      occupiedPreview.confirmation.fingerprint,
    );

    const barrier = await createDatabaseLockBarrier(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        FROM "guests"
        WHERE "id" = ${guest.id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Could not lock the expected guest row.");
      }
    });
    const unassignment = unassignGuestFromTableAction(
      workspace.id,
      guest.id,
      idleState,
      new FormData(),
    );
    let confirmedDelete:
      | ReturnType<typeof deleteSeatingTableAction>
      | undefined;
    let barrierError: unknown;
    try {
      await barrier.waitForWaiters(1);
      confirmedDelete = deleteSeatingTableAction(
        workspace.id,
        table.id,
        occupiedPreview,
        confirmForm,
      );
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }

    const [unassignmentResult, staleDeleteResult] = await Promise.all([
      unassignment,
      confirmedDelete ??
        Promise.reject(new Error("Confirmed delete did not start.")),
    ]);
    if (barrierError) {
      throw barrierError;
    }

    expect(unassignmentResult).toEqual({
      status: "success",
      message: "已將賓客移出桌次。",
    });
    expect(staleDeleteResult).toMatchObject({
      status: "confirmation",
      stale: true,
      confirmation: { canConfirm: true },
    });
    expect(
      await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } }),
    ).toMatchObject({ seatingTableId: null, version: 1 });
    expect(
      await prisma.seatingTable.findUnique({ where: { id: table.id } }),
    ).not.toBeNull();

    const freshPreview = await deleteSeatingTableAction(
      workspace.id,
      table.id,
      idleState,
      new FormData(),
    );
    expect(freshPreview).toMatchObject({
      status: "confirmation",
      stale: false,
      confirmation: { canConfirm: true },
    });
  });

  it("allows only the valid CAS writer when table edit races confirmed delete", async () => {
    const { workspace } = await createWorkspace("桌次編刪競速");
    const table = await createTable(workspace.id, "可編刪空桌", 10);
    const preview = await deleteSeatingTableAction(
      workspace.id,
      table.id,
      idleState,
      new FormData(),
    );
    if (
      preview.status !== "confirmation" ||
      !preview.confirmation.canConfirm
    ) {
      throw new Error("expected empty delete preview");
    }
    const confirmForm = new FormData();
    confirmForm.set(
      "snapshotFingerprint",
      preview.confirmation.fingerprint,
    );

    const barrier = await createDatabaseLockBarrier(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        FROM "seating_tables"
        WHERE "id" = ${table.id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Could not lock the expected seating table row.");
      }
    });
    const writers = [
      updateSeatingTableAction(
        workspace.id,
        table.id,
        idleState,
        tableForm("競速後桌名", 9, table.version),
      ),
      deleteSeatingTableAction(
        workspace.id,
        table.id,
        preview,
        confirmForm,
      ),
    ] as const;
    let barrierError: unknown;
    try {
      await barrier.waitForWaiters(2);
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }
    const [editResult, deleteResult] = await Promise.all(writers);
    if (barrierError) {
      throw barrierError;
    }

    expect(
      [editResult, deleteResult].filter(
        (result) => result.status === "success",
      ),
    ).toHaveLength(1);
    const stored = await prisma.seatingTable.findUnique({
      where: { id: table.id },
    });
    if (stored) {
      expect(editResult.status).toBe("success");
      expect(deleteResult).toMatchObject({
        status: "confirmation",
        stale: true,
      });
      expect(stored).toMatchObject({ name: "競速後桌名", version: 1 });
    } else {
      expect(deleteResult.status).toBe("success");
      expect(editResult.status).toBe("error");
    }
  });

  it("keeps positions unique when batch adjustment races a rename", async () => {
    const namingProbe = await createWorkspace("預設桌名探測");
    await expect(
      adjustSeatingTablesAction(
        namingProbe.workspace.id,
        idleState,
        adjustmentForm(1, 8),
      ),
    ).resolves.toMatchObject({ status: "success" });
    const generatedName = (
      await prisma.seatingTable.findFirstOrThrow({
        where: { workspaceId: namingProbe.workspace.id },
        select: { name: true },
      })
    ).name;

    const { workspace } = await createWorkspace("批次新增與桌名競速");
    const customTable = await createTable(
      workspace.id,
      "保留的自訂桌名",
      10,
    );

    const barrier = await createDatabaseLockBarrier(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        FROM "seating_tables"
        WHERE "id" = ${customTable.id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new Error("Could not lock the expected seating table row.");
      }
    });
    const rename = updateSeatingTableAction(
      workspace.id,
      customTable.id,
      idleState,
      tableForm(generatedName, customTable.capacity, customTable.version),
    );
    // First prove that rename owns the workspace sequence lock while blocked on
    // the table row. Only then start the adjustment: it queues behind rename
    // without requiring a third Prisma pool connection to appear in
    // pg_stat_activity before the row-lock barrier opens.
    let adjustment:
      | ReturnType<typeof adjustSeatingTablesAction>
      | undefined;
    let barrierError: unknown;
    try {
      await barrier.waitForWaiters(1);
      // The same row-lock waiter must already own the workspace sequence lock;
      // otherwise a reordered implementation could let adjustment win it.
      await barrier.waitForWaitersHoldingAdvisoryLock(
        1,
        `vowbook:seating:${workspace.id}`,
      );
      adjustment = adjustSeatingTablesAction(
        workspace.id,
        idleState,
        adjustmentForm(2, 8),
      );
    } catch (error) {
      barrierError = error;
    } finally {
      await barrier.release();
    }
    const [renameResult, adjustmentResult] = await Promise.all([
      rename,
      adjustment ?? Promise.reject(new Error("batch adjustment did not start")),
    ]);
    if (barrierError) {
      throw barrierError;
    }

    // The sequence lock serializes the rename before the add. Names may now
    // collide on purpose — what still has to hold is that the add appends one
    // fresh position instead of colliding with the renamed row.
    expect(renameResult).toMatchObject({ status: "success" });
    expect(adjustmentResult).toMatchObject({ status: "success" });
    const storedTables = await prisma.seatingTable.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { position: "asc" },
      select: { name: true, position: true },
    });
    expect(storedTables).toHaveLength(2);
    expect(storedTables.map((table) => table.name)).toEqual([
      generatedName,
      generatedName,
    ]);
    expect(new Set(storedTables.map((table) => table.position)).size).toBe(2);
    expect(storedTables.map((table) => table.position)).toEqual([1, 2]);
  });

  it("rejects tampered fingerprints and revocation after preview with zero deletions", async () => {
    const owner = await createWorkspace("操作方婚宴");
    const target = await createWorkspace("目標婚宴");
    const targetTable = await createTable(target.workspace.id, "目標空桌", 8);

    authState.userId = owner.user.id;
    await expect(
      deleteSeatingTableAction(
        target.workspace.id,
        targetTable.id,
        idleState,
        new FormData(),
      ),
    ).resolves.toMatchObject({ status: "error" });
    expect(
      await prisma.seatingTable.count({ where: { id: targetTable.id } }),
    ).toBe(1);

    await prisma.membership.create({
      data: {
        workspaceId: target.workspace.id,
        userId: owner.user.id,
        role: "PLANNER",
      },
    });
    const preview = await deleteSeatingTableAction(
      target.workspace.id,
      targetTable.id,
      idleState,
      new FormData(),
    );
    if (preview.status !== "confirmation") {
      throw new Error("expected cross-membership delete preview");
    }

    const tamperedForm = new FormData();
    const fingerprint = preview.confirmation.fingerprint;
    const tamperedSuffix = fingerprint.endsWith("0") ? "1" : "0";
    tamperedForm.set(
      "snapshotFingerprint",
      `${fingerprint.slice(0, -1)}${tamperedSuffix}`,
    );
    await expect(
      deleteSeatingTableAction(
        target.workspace.id,
        targetTable.id,
        preview,
        tamperedForm,
      ),
    ).resolves.toMatchObject({
      status: "confirmation",
      stale: true,
    });
    expect(
      await prisma.seatingTable.count({ where: { id: targetTable.id } }),
    ).toBe(1);

    await prisma.membership.delete({
      where: {
        workspaceId_userId: {
          workspaceId: target.workspace.id,
          userId: owner.user.id,
        },
      },
    });
    const confirmForm = new FormData();
    confirmForm.set(
      "snapshotFingerprint",
      preview.confirmation.fingerprint,
    );
    await expect(
      deleteSeatingTableAction(
        target.workspace.id,
        targetTable.id,
        preview,
        confirmForm,
      ),
    ).resolves.toMatchObject({ status: "error" });
    expect(
      await prisma.seatingTable.count({ where: { id: targetTable.id } }),
    ).toBe(1);
  });

  it("denies VIEWER and cross-tenant total adjustment without writes", async () => {
    const owner = await createWorkspace("Owner tenant");
    const target = await createWorkspace("Target tenant");
    authState.userId = owner.user.id;
    await expect(
      adjustSeatingTablesAction(target.workspace.id, idleState, adjustmentForm(2, 10)),
    ).resolves.toMatchObject({ status: "error" });
    expect(await prisma.seatingTable.count({ where: { workspaceId: target.workspace.id } })).toBe(0);

    await prisma.membership.create({
      data: { workspaceId: target.workspace.id, userId: owner.user.id, role: "VIEWER" },
    });
    await expect(
      adjustSeatingTablesAction(target.workspace.id, idleState, adjustmentForm(2, 10)),
    ).resolves.toMatchObject({ status: "error" });
    expect(await prisma.seatingTable.count({ where: { workspaceId: target.workspace.id } })).toBe(0);
  });
});
