import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const authState = vi.hoisted(() => ({ userId: "" }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({ id: authState.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  cancelGuestCheckInAction,
  checkInGuestAction,
  updateGuestCheckInAction,
} from "@/actions/guest-check-ins";
import { deleteGuestAction } from "@/actions/guests";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const idleState = { status: "idle" as const };
let sequence = 0;

function checkInForm({
  headcount = "3",
  notes = "同組到齊",
  expectedVersion,
}: {
  headcount?: string;
  notes?: string;
  expectedVersion?: number;
} = {}) {
  const form = new FormData();
  form.set("headcount", headcount);
  form.set("notes", notes);
  if (expectedVersion !== undefined) {
    form.set("expectedVersion", String(expectedVersion));
  }
  return form;
}

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      googleSubject: `check-in-it-${label}-${sequence}`,
      email: `check-in-it-${label}-${sequence}@example.test`,
    },
  });
}

async function createWorkspace(userId: string, name: string) {
  return prisma.weddingWorkspace.create({
    data: {
      name,
      createdById: userId,
      memberships: { create: { userId, role: "OWNER" } },
    },
  });
}

async function createGuest(workspaceId: string, name: string) {
  return prisma.guest.create({
    data: { workspaceId, name, side: "SHARED" },
  });
}

describeDatabase.sequential("PostgreSQL guest check-in invariants", () => {
  beforeEach(async () => {
    revalidatePath.mockClear();
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

  it("enforces one arrival per group, same-workspace guests, and the database checks", async () => {
    const owner = await createUser("owner");
    const first = await createWorkspace(owner.id, "第一工作區");
    const second = await createWorkspace(owner.id, "第二工作區");
    const firstGuest = await createGuest(first.id, "第一組賓客");
    const secondGuest = await createGuest(second.id, "第二組賓客");

    const checkIn = await prisma.guestCheckIn.create({
      data: { workspaceId: first.id, guestId: firstGuest.id, headcount: 3 },
    });

    await expect(
      prisma.guestCheckIn.create({
        data: { workspaceId: first.id, guestId: firstGuest.id, headcount: 2 },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.guestCheckIn.create({
        data: { workspaceId: first.id, guestId: secondGuest.id, headcount: 2 },
      }),
    ).rejects.toBeDefined();

    for (const data of [
      { headcount: 0 },
      { headcount: -1 },
      { headcount: 21 },
      { headcount: 2, notes: " padded " },
      { headcount: 2, version: -1 },
    ]) {
      await expect(
        prisma.guestCheckIn.create({
          data: { workspaceId: second.id, guestId: secondGuest.id, ...data },
        }),
      ).rejects.toBeDefined();
    }

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'guest_check_ins'
    `;
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "guest_check_ins_guest_id_workspace_id_key",
        "guest_check_ins_id_workspace_id_key",
        "guest_check_ins_ws_checked_in_id_idx",
      ]),
    );

    await prisma.guest.delete({ where: { id: firstGuest.id } });
    expect(
      await prisma.guestCheckIn.count({ where: { id: checkIn.id } }),
    ).toBe(0);

    const secondCheckIn = await prisma.guestCheckIn.create({
      data: { workspaceId: second.id, guestId: secondGuest.id, headcount: 1 },
    });
    await prisma.weddingWorkspace.delete({ where: { id: second.id } });
    expect(
      await prisma.guestCheckIn.count({ where: { id: secondCheckIn.id } }),
    ).toBe(0);
  });

  it("authorizes CRUD, binds tenant ids server-side, and detects stale CAS writes", async () => {
    const owner = await createUser("owner");
    const first = await createWorkspace(owner.id, "第一工作區");
    const second = await createWorkspace(owner.id, "第二工作區");
    const firstGuest = await createGuest(first.id, "第一組賓客");
    const secondGuest = await createGuest(second.id, "第二組賓客");
    const foreignCheckIn = await prisma.guestCheckIn.create({
      data: { workspaceId: second.id, guestId: secondGuest.id, headcount: 2 },
    });
    authState.userId = owner.id;

    const createForm = checkInForm();
    createForm.set("workspaceId", second.id);
    createForm.set("guestId", secondGuest.id);
    await expect(
      checkInGuestAction(first.id, firstGuest.id, idleState, createForm),
    ).resolves.toMatchObject({
      status: "success",
      checkIn: { headcount: 3, notes: "同組到齊", version: 0 },
    });

    const stored = await prisma.guestCheckIn.findUniqueOrThrow({
      where: {
        guestId_workspaceId: {
          guestId: firstGuest.id,
          workspaceId: first.id,
        },
      },
    });
    expect(stored).toMatchObject({
      workspaceId: first.id,
      guestId: firstGuest.id,
    });

    await expect(
      checkInGuestAction(first.id, firstGuest.id, idleState, checkInForm()),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    await expect(
      checkInGuestAction(first.id, secondGuest.id, idleState, checkInForm()),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    await expect(
      updateGuestCheckInAction(
        first.id,
        foreignCheckIn.id,
        idleState,
        checkInForm({ expectedVersion: 0 }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    await expect(
      updateGuestCheckInAction(
        first.id,
        stored.id,
        idleState,
        checkInForm({ headcount: "5", expectedVersion: 99 }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    await expect(
      updateGuestCheckInAction(
        first.id,
        stored.id,
        idleState,
        checkInForm({ headcount: "5", notes: "臨時多兩位", expectedVersion: 0 }),
      ),
    ).resolves.toMatchObject({
      status: "success",
      checkIn: { id: stored.id, headcount: 5, notes: "臨時多兩位", version: 1 },
    });

    const cancelForm = new FormData();
    cancelForm.set("expectedVersion", "1");
    await expect(
      cancelGuestCheckInAction(first.id, stored.id, idleState, cancelForm),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.guestCheckIn.count({ where: { id: stored.id } }),
    ).toBe(0);
    expect(
      await prisma.guestCheckIn.count({ where: { id: foreignCheckIn.id } }),
    ).toBe(1);
  });

  it("refuses every check-in mutation for a VIEWER", async () => {
    const owner = await createUser("viewer-owner");
    const viewer = await createUser("viewer");
    const workspace = await createWorkspace(owner.id, "唯讀工作區");
    const guest = await createGuest(workspace.id, "唯讀賓客");
    const checkIn = await prisma.guestCheckIn.create({
      data: { workspaceId: workspace.id, guestId: guest.id, headcount: 2 },
    });
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
    });
    authState.userId = viewer.id;

    const cancelForm = new FormData();
    cancelForm.set("expectedVersion", "0");
    for (const result of await Promise.all([
      checkInGuestAction(workspace.id, guest.id, idleState, checkInForm()),
      updateGuestCheckInAction(
        workspace.id,
        checkIn.id,
        idleState,
        checkInForm({ expectedVersion: 0 }),
      ),
      cancelGuestCheckInAction(workspace.id, checkIn.id, idleState, cancelForm),
    ])) {
      expect(result).toMatchObject({ status: "error", code: "FORBIDDEN" });
    }

    const unchanged = await prisma.guestCheckIn.findUniqueOrThrow({
      where: { id: checkIn.id },
    });
    expect(unchanged).toMatchObject({ headcount: 2, version: 0 });
  });

  it("serializes concurrent check-in and same-version update races to one success", async () => {
    const owner = await createUser("concurrent-owner");
    const workspace = await createWorkspace(owner.id, "協作工作區");
    const guest = await createGuest(workspace.id, "同一邀請群組");
    authState.userId = owner.id;

    const createResults = await Promise.all([
      checkInGuestAction(
        workspace.id,
        guest.id,
        idleState,
        checkInForm({ headcount: "2", notes: "第一位接待" }),
      ),
      checkInGuestAction(
        workspace.id,
        guest.id,
        idleState,
        checkInForm({ headcount: "4", notes: "第二位接待" }),
      ),
    ]);
    expect(createResults.map((result) => result.status).sort()).toEqual([
      "error",
      "success",
    ]);
    expect(
      await prisma.guestCheckIn.count({
        where: { workspaceId: workspace.id, guestId: guest.id },
      }),
    ).toBe(1);

    const checkIn = await prisma.guestCheckIn.findFirstOrThrow({
      where: { workspaceId: workspace.id, guestId: guest.id },
    });
    const updateResults = await Promise.all([
      updateGuestCheckInAction(
        workspace.id,
        checkIn.id,
        idleState,
        checkInForm({ headcount: "6", notes: "更新甲", expectedVersion: 0 }),
      ),
      updateGuestCheckInAction(
        workspace.id,
        checkIn.id,
        idleState,
        checkInForm({ headcount: "8", notes: "更新乙", expectedVersion: 0 }),
      ),
    ]);
    expect(updateResults.map((result) => result.status).sort()).toEqual([
      "error",
      "success",
    ]);

    const updated = await prisma.guestCheckIn.findUniqueOrThrow({
      where: { id: checkIn.id },
    });
    const successfulUpdate = updateResults.find(
      (result) => result.status === "success",
    );
    expect(updated.version).toBe(1);
    expect(updated.headcount).toBe(successfulUpdate?.checkIn?.headcount);
    expect(updated.notes).toBe(successfulUpdate?.checkIn?.notes);
  });

  it("never lets guest deletion silently cascade an arrival the operator did not see", async () => {
    const owner = await createUser("cascade-owner");
    const workspace = await createWorkspace(owner.id, "刪除競態工作區");
    const guest = await createGuest(workspace.id, "已報到賓客");
    const checkIn = await prisma.guestCheckIn.create({
      data: { workspaceId: workspace.id, guestId: guest.id, headcount: 3 },
    });
    authState.userId = owner.id;

    const staleDelete = new FormData();
    staleDelete.set("expectedVersion", String(guest.version));
    staleDelete.set("expectedWeddingGiftId", "");
    staleDelete.set("expectedWeddingGiftVersion", "");
    staleDelete.set("expectedGuestCheckInId", "");
    staleDelete.set("expectedGuestCheckInVersion", "");
    await expect(
      deleteGuestAction(workspace.id, guest.id, idleState, staleDelete),
    ).resolves.toMatchObject({ status: "error" });
    expect(
      await prisma.guestCheckIn.count({ where: { id: checkIn.id } }),
    ).toBe(1);

    const acknowledgedDelete = new FormData();
    acknowledgedDelete.set("expectedVersion", String(guest.version));
    acknowledgedDelete.set("expectedWeddingGiftId", "");
    acknowledgedDelete.set("expectedWeddingGiftVersion", "");
    acknowledgedDelete.set("expectedGuestCheckInId", checkIn.id);
    acknowledgedDelete.set(
      "expectedGuestCheckInVersion",
      String(checkIn.version),
    );
    await expect(
      deleteGuestAction(workspace.id, guest.id, idleState, acknowledgedDelete),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.guestCheckIn.count({ where: { id: checkIn.id } }),
    ).toBe(0);
  });
});
