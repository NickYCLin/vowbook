import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const authState = vi.hoisted(() => ({ userId: "" }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({ id: authState.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  setGuestGiftExemptionAction,
  createWeddingGiftAction,
  deleteWeddingGiftAction,
  setWeddingGiftReturnAction,
  updateWeddingGiftAction,
} from "@/actions/wedding-gifts";
import { deleteGuestAction } from "@/actions/guests";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const idleState = { status: "idle" as const };
let sequence = 0;

function giftForm({
  amount = "12000",
  notes = "大學同學桌",
  expectedVersion,
}: {
  amount?: string;
  notes?: string;
  expectedVersion?: number;
} = {}) {
  const form = new FormData();
  form.set("amount", amount);
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
      googleSubject: `gift-it-${label}-${sequence}`,
      email: `gift-it-${label}-${sequence}@example.test`,
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

describeDatabase.sequential("PostgreSQL wedding gift invariants", () => {
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

  it("persists and cancels exemption without gifts and rejects stale or cross-workspace writes", async () => {
    const owner = await createUser("exemption");
    authState.userId = owner.id;
    const first = await createWorkspace(owner.id, "第一工作區");
    const second = await createWorkspace(owner.id, "第二工作區");
    const guest = await createGuest(first.id, "長輩朋友");
    expect(guest.giftExemptWithCake).toBe(false);
    const form = new FormData();
    form.set("expectedVersion", "0");
    form.set("giftExemptWithCake", "on");
    expect(await setGuestGiftExemptionAction(second.id, guest.id, idleState, form)).toMatchObject({ code: "STALE" });
    expect(await setGuestGiftExemptionAction(first.id, guest.id, idleState, form)).toMatchObject({ status: "success" });
    expect(await setGuestGiftExemptionAction(first.id, guest.id, idleState, form)).toMatchObject({ code: "STALE" });
    expect(await prisma.guest.findUnique({ where: { id: guest.id } })).toMatchObject({ giftExemptWithCake: true, version: 1, attendanceStatus: "UNDECIDED" });
    expect(await prisma.weddingGift.count({ where: { guestId: guest.id } })).toBe(0);
    form.set("expectedVersion", "1");
    form.set("giftExemptWithCake", "off");
    expect(await setGuestGiftExemptionAction(first.id, guest.id, idleState, form)).toMatchObject({ status: "success" });
    expect(await prisma.guest.findUnique({ where: { id: guest.id } })).toMatchObject({ giftExemptWithCake: false, version: 2 });
  });

  it("enforces direct workspace ownership, same-workspace guests, one record per group, and database checks", async () => {
    const owner = await createUser("owner");
    const first = await createWorkspace(owner.id, "第一工作區");
    const second = await createWorkspace(owner.id, "第二工作區");
    const firstGuest = await createGuest(first.id, "第一組賓客");
    const secondGuest = await createGuest(second.id, "第二組賓客");

    const gift = await prisma.weddingGift.create({
      data: {
        workspaceId: first.id,
        guestId: firstGuest.id,
        amount: 3600,
        notes: "同學桌",
      },
    });

    await expect(
      prisma.weddingGift.create({
        data: {
          workspaceId: first.id,
          guestId: firstGuest.id,
          amount: 6000,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.weddingGift.create({
        data: {
          workspaceId: first.id,
          guestId: secondGuest.id,
          amount: 6000,
        },
      }),
    ).rejects.toBeDefined();

    for (const data of [
      { amount: 0 },
      { amount: -1 },
      { amount: 1200, notes: " padded " },
      { amount: 1200, version: -1 },
    ]) {
      await expect(
        prisma.weddingGift.create({
          data: {
            workspaceId: second.id,
            guestId: secondGuest.id,
            ...data,
          },
        }),
      ).rejects.toBeDefined();
    }

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'wedding_gifts'
    `;
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "wedding_gifts_guest_id_workspace_id_key",
        "wedding_gifts_id_workspace_id_key",
        "wedding_gifts_ws_created_id_idx",
      ]),
    );

    await prisma.guest.delete({ where: { id: firstGuest.id } });
    expect(await prisma.weddingGift.count({ where: { id: gift.id } })).toBe(0);

    const secondGift = await prisma.weddingGift.create({
      data: {
        workspaceId: second.id,
        guestId: secondGuest.id,
        amount: 12_000,
      },
    });
    await prisma.weddingWorkspace.delete({ where: { id: second.id } });
    expect(await prisma.weddingGift.count({ where: { id: secondGift.id } })).toBe(
      0,
    );
  });

  it("authorizes CRUD, binds tenant ids server-side, and detects stale CAS writes", async () => {
    const owner = await createUser("owner");
    const first = await createWorkspace(owner.id, "第一工作區");
    const second = await createWorkspace(owner.id, "第二工作區");
    const firstGuest = await createGuest(first.id, "第一組賓客");
    const secondGuest = await createGuest(second.id, "第二組賓客");
    const foreignGift = await prisma.weddingGift.create({
      data: {
        workspaceId: second.id,
        guestId: secondGuest.id,
        amount: 6000,
      },
    });
    authState.userId = owner.id;

    const createForm = giftForm();
    createForm.set("workspaceId", second.id);
    createForm.set("guestId", secondGuest.id);
    await expect(
      createWeddingGiftAction(first.id, firstGuest.id, idleState, createForm),
    ).resolves.toMatchObject({
      status: "success",
      gift: { amount: 12_000, notes: "大學同學桌", version: 0 },
    });

    const stored = await prisma.weddingGift.findUniqueOrThrow({
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
      createWeddingGiftAction(first.id, firstGuest.id, idleState, giftForm()),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    await expect(
      updateWeddingGiftAction(
        first.id,
        foreignGift.id,
        idleState,
        giftForm({ expectedVersion: 0 }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    await expect(
      updateWeddingGiftAction(
        first.id,
        stored.id,
        idleState,
        giftForm({ amount: "20000", expectedVersion: 99 }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    await expect(
      updateWeddingGiftAction(
        first.id,
        stored.id,
        idleState,
        giftForm({ amount: "20000", notes: "更新", expectedVersion: 0 }),
      ),
    ).resolves.toMatchObject({
      status: "success",
      gift: { id: stored.id, amount: 20_000, notes: "更新", version: 1 },
    });

    const deleteForm = new FormData();
    deleteForm.set("expectedVersion", "1");
    await expect(
      deleteWeddingGiftAction(first.id, stored.id, idleState, deleteForm),
    ).resolves.toMatchObject({ status: "success" });
    expect(await prisma.weddingGift.count({ where: { id: stored.id } })).toBe(0);
    expect(await prisma.weddingGift.count({ where: { id: foreignGift.id } })).toBe(
      1,
    );
  });

  it("tracks the return gift with database-guarded notes and version CAS", async () => {
    const owner = await createUser("return-owner");
    const workspace = await createWorkspace(owner.id, "回禮工作區");
    const guest = await createGuest(workspace.id, "禮到人不到");
    authState.userId = owner.id;

    await expect(
      createWeddingGiftAction(workspace.id, guest.id, idleState, giftForm()),
    ).resolves.toMatchObject({ status: "success" });
    const stored = await prisma.weddingGift.findFirstOrThrow({
      where: { workspaceId: workspace.id, guestId: guest.id },
    });
    // 新登記的禮金一律不得被推定為已回禮。
    expect(stored).toMatchObject({
      returnGiftSentAt: null,
      returnGiftNote: null,
    });

    for (const returnGiftNote of [" 前後空白 ", "\t", "餅".repeat(201)]) {
      await expect(
        prisma.weddingGift.update({
          where: { id: stored.id },
          data: { returnGiftNote },
        }),
      ).rejects.toBeDefined();
    }

    const markSent = new FormData();
    markSent.set("expectedVersion", String(stored.version));
    markSent.set("returnGiftSent", "on");
    markSent.set("returnGiftNote", "  寄了 2 盒喜餅  ");
    await expect(
      setWeddingGiftReturnAction(
        workspace.id,
        stored.id,
        idleState,
        markSent,
      ),
    ).resolves.toMatchObject({ status: "success" });

    const sent = await prisma.weddingGift.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(sent.returnGiftNote).toBe("寄了 2 盒喜餅");
    expect(sent.returnGiftSentAt).toBeInstanceOf(Date);
    expect(sent.version).toBe(stored.version + 1);

    // 同一筆再標一次不得把回禮時間往後推。
    const markAgain = new FormData();
    markAgain.set("expectedVersion", String(sent.version));
    markAgain.set("returnGiftSent", "on");
    markAgain.set("returnGiftNote", "寄了 2 盒喜餅");
    await expect(
      setWeddingGiftReturnAction(workspace.id, stored.id, idleState, markAgain),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      (
        await prisma.weddingGift.findUniqueOrThrow({ where: { id: stored.id } })
      ).returnGiftSentAt?.getTime(),
    ).toBe(sent.returnGiftSentAt?.getTime());

    // 過期的 CAS token 一律拒絕。
    const stale = new FormData();
    stale.set("expectedVersion", String(sent.version));
    stale.set("returnGiftSent", "");
    await expect(
      setWeddingGiftReturnAction(workspace.id, stored.id, idleState, stale),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
  });

  it("refuses return-gift updates from a VIEWER and across workspaces", async () => {
    const owner = await createUser("return-rbac-owner");
    const viewer = await createUser("return-rbac-viewer");
    const first = await createWorkspace(owner.id, "第一工作區");
    const second = await createWorkspace(owner.id, "第二工作區");
    const guest = await createGuest(first.id, "第一組賓客");
    const gift = await prisma.weddingGift.create({
      data: { workspaceId: first.id, guestId: guest.id, amount: 3600 },
    });
    await prisma.membership.create({
      data: { workspaceId: first.id, userId: viewer.id, role: "VIEWER" },
    });

    const form = new FormData();
    form.set("expectedVersion", String(gift.version));
    form.set("returnGiftSent", "on");

    authState.userId = viewer.id;
    await expect(
      setWeddingGiftReturnAction(first.id, gift.id, idleState, form),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    authState.userId = owner.id;
    await expect(
      setWeddingGiftReturnAction(second.id, gift.id, idleState, form),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    expect(
      await prisma.weddingGift.findUniqueOrThrow({ where: { id: gift.id } }),
    ).toMatchObject({ returnGiftSentAt: null, version: gift.version });
  });

  it("serializes concurrent create and same-version update races to one success and one stale result", async () => {
    const owner = await createUser("concurrent-owner");
    const workspace = await createWorkspace(owner.id, "協作工作區");
    const guest = await createGuest(workspace.id, "同一邀請群組");
    authState.userId = owner.id;

    const createResults = await Promise.all([
      createWeddingGiftAction(
        workspace.id,
        guest.id,
        idleState,
        giftForm({ amount: "6000", notes: "第一位編輯者" }),
      ),
      createWeddingGiftAction(
        workspace.id,
        guest.id,
        idleState,
        giftForm({ amount: "10000", notes: "第二位編輯者" }),
      ),
    ]);
    expect(createResults.map((result) => result.status).sort()).toEqual([
      "error",
      "success",
    ]);
    expect(createResults.filter((result) => result.status === "error")).toEqual([
      expect.objectContaining({ code: "STALE" }),
    ]);
    expect(
      await prisma.weddingGift.count({
        where: { workspaceId: workspace.id, guestId: guest.id },
      }),
    ).toBe(1);

    const gift = await prisma.weddingGift.findFirstOrThrow({
      where: { workspaceId: workspace.id, guestId: guest.id },
    });
    const updateResults = await Promise.all([
      updateWeddingGiftAction(
        workspace.id,
        gift.id,
        idleState,
        giftForm({ amount: "12000", notes: "更新甲", expectedVersion: 0 }),
      ),
      updateWeddingGiftAction(
        workspace.id,
        gift.id,
        idleState,
        giftForm({ amount: "16000", notes: "更新乙", expectedVersion: 0 }),
      ),
    ]);
    expect(updateResults.map((result) => result.status).sort()).toEqual([
      "error",
      "success",
    ]);
    expect(updateResults.filter((result) => result.status === "error")).toEqual([
      expect.objectContaining({ code: "STALE" }),
    ]);

    const updated = await prisma.weddingGift.findUniqueOrThrow({
      where: { id: gift.id },
    });
    const successfulUpdate = updateResults.find(
      (result) => result.status === "success",
    );
    expect(updated.version).toBe(1);
    expect(updated.amount).toBe(successfulUpdate?.gift?.amount);
    expect(updated.notes).toBe(successfulUpdate?.gift?.notes);
  });

  it("never lets guest deletion silently cascade a concurrently created or updated gift", async () => {
    const owner = await createUser("delete-race-owner");
    const workspace = await createWorkspace(owner.id, "刪除競態工作區");
    authState.userId = owner.id;

    const createRaceGuest = await createGuest(workspace.id, "新增禮金競態");
    const deleteWithoutGift = new FormData();
    deleteWithoutGift.set("expectedVersion", String(createRaceGuest.version));
    deleteWithoutGift.set("expectedWeddingGiftId", "");
    deleteWithoutGift.set("expectedWeddingGiftVersion", "");
    const [deleteDuringCreate, createDuringDelete] = await Promise.all([
      deleteGuestAction(
        workspace.id,
        createRaceGuest.id,
        idleState,
        deleteWithoutGift,
      ),
      createWeddingGiftAction(
        workspace.id,
        createRaceGuest.id,
        idleState,
        giftForm({ amount: "6000", notes: "並行新增" }),
      ),
    ]);
    expect(
      [deleteDuringCreate.status, createDuringDelete.status].sort(),
    ).toEqual(["error", "success"]);
    expect(
      deleteDuringCreate.status === "error"
        ? deleteDuringCreate
        : createDuringDelete,
    ).toMatchObject({ status: "error" });
    const guestCountAfterCreateRace = await prisma.guest.count({
      where: { id: createRaceGuest.id },
    });
    const giftCountAfterCreateRace = await prisma.weddingGift.count({
      where: { guestId: createRaceGuest.id, workspaceId: workspace.id },
    });
    expect([guestCountAfterCreateRace, giftCountAfterCreateRace]).toEqual(
      deleteDuringCreate.status === "success" ? [0, 0] : [1, 1],
    );

    const updateRaceGuest = await createGuest(workspace.id, "更新禮金競態");
    const updateRaceGift = await prisma.weddingGift.create({
      data: {
        workspaceId: workspace.id,
        guestId: updateRaceGuest.id,
        amount: 3_600,
      },
    });
    const deleteWithGift = new FormData();
    deleteWithGift.set("expectedVersion", String(updateRaceGuest.version));
    deleteWithGift.set("expectedWeddingGiftId", updateRaceGift.id);
    deleteWithGift.set(
      "expectedWeddingGiftVersion",
      String(updateRaceGift.version),
    );
    const [deleteDuringUpdate, updateDuringDelete] = await Promise.all([
      deleteGuestAction(
        workspace.id,
        updateRaceGuest.id,
        idleState,
        deleteWithGift,
      ),
      updateWeddingGiftAction(
        workspace.id,
        updateRaceGift.id,
        idleState,
        giftForm({
          amount: "10000",
          notes: "並行更新",
          expectedVersion: updateRaceGift.version,
        }),
      ),
    ]);
    expect(
      [deleteDuringUpdate.status, updateDuringDelete.status].sort(),
    ).toEqual(["error", "success"]);
    const persistedGuest = await prisma.guest.findUnique({
      where: { id: updateRaceGuest.id },
    });
    const persistedGift = await prisma.weddingGift.findUnique({
      where: { id: updateRaceGift.id },
    });
    if (deleteDuringUpdate.status === "success") {
      expect(persistedGuest).toBeNull();
      expect(persistedGift).toBeNull();
    } else {
      expect(persistedGuest).not.toBeNull();
      expect(persistedGift).toMatchObject({
        amount: 10_000,
        notes: "並行更新",
        version: 1,
      });
    }
  });

  it("denies a viewer before writing", async () => {
    const owner = await createUser("owner");
    const viewer = await createUser("viewer");
    const workspace = await createWorkspace(owner.id, "唯讀工作區");
    const guest = await createGuest(workspace.id, "唯讀賓客");
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
    });
    authState.userId = viewer.id;

    await expect(
      createWeddingGiftAction(workspace.id, guest.id, idleState, giftForm()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(
      await prisma.weddingGift.count({ where: { workspaceId: workspace.id } }),
    ).toBe(0);
  });
});
