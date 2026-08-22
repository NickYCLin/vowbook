import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  executeRaw,
  tableCreate,
  tableCreateMany,
  tableFindMany,
  tableFindUnique,
  tableUpdate,
  tableUpdateMany,
  tableDelete,
  tableDeleteMany,
  guestFindUnique,
  guestFindMany,
  guestAggregate,
  guestUpdate,
  guestUpdateMany,
  queryRaw,
  transaction,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  executeRaw: vi.fn(),
  tableCreate: vi.fn(),
  tableCreateMany: vi.fn(),
  tableFindMany: vi.fn(),
  tableFindUnique: vi.fn(),
  tableUpdate: vi.fn(),
  tableUpdateMany: vi.fn(),
  tableDelete: vi.fn(),
  tableDeleteMany: vi.fn(),
  guestFindUnique: vi.fn(),
  guestFindMany: vi.fn(),
  guestAggregate: vi.fn(),
  guestUpdate: vi.fn(),
  guestUpdateMany: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

const transactionClient = {
  $executeRaw: executeRaw,
  $queryRaw: queryRaw,
  seatingTable: {
    create: tableCreate,
    createMany: tableCreateMany,
    findMany: tableFindMany,
    findUnique: tableFindUnique,
    update: tableUpdate,
    updateMany: tableUpdateMany,
    delete: tableDelete,
    deleteMany: tableDeleteMany,
  },
  guest: {
    findUnique: guestFindUnique,
    findMany: guestFindMany,
    aggregate: guestAggregate,
    update: guestUpdate,
    updateMany: guestUpdateMany,
  },
};

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    seatingTable: {
      create: tableCreate,
      findUnique: tableFindUnique,
      update: tableUpdate,
      updateMany: tableUpdateMany,
      delete: tableDelete,
    },
    guest: {
      findUnique: guestFindUnique,
      aggregate: guestAggregate,
      update: guestUpdate,
      updateMany: guestUpdateMany,
    },
    $transaction: transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  adjustSeatingTablesAction,
  assignGuestToTableAction,
  createSeatingTableAction,
  deleteSeatingTableAction,
  unassignGuestFromTableAction,
  resetSeatingTableLayoutsAction,
  swapSeatingTableContentsAction,
  updateSeatingTableLayoutAction,
  updateSeatingTableAction,
} from "./seating-tables";

const idleState = { status: "idle" as const };

function validTableFormData(expectedVersion = 0) {
  const formData = new FormData();
  formData.set("name", "  主   桌  ");
  formData.set("capacity", "12");
  formData.set("notes", "  靠近舞台  ");
  formData.set("expectedVersion", String(expectedVersion));
  return formData;
}

function layoutFormData(
  layoutX: string,
  layoutY: string,
  expectedVersion = 0,
) {
  const formData = new FormData();
  formData.set("layoutX", layoutX);
  formData.set("layoutY", layoutY);
  formData.set("expectedVersion", String(expectedVersion));
  return formData;
}

function swapFormData(
  targetTableId: string,
  expectedVersion = 0,
  targetExpectedVersion = 0,
) {
  const formData = new FormData();
  formData.set("targetTableId", targetTableId);
  formData.set("expectedVersion", String(expectedVersion));
  formData.set("targetExpectedVersion", String(targetExpectedVersion));
  return formData;
}

const layoutTableRows = [
  {
    id: "table_1",
    workspaceId: "workspace_1",
    position: 1,
    version: 0,
    name: "主桌",
    capacity: 10,
    notes: "靠近舞台",
    layoutX: null,
    layoutY: null,
  },
  {
    id: "table_2",
    workspaceId: "workspace_1",
    position: 2,
    version: 0,
    name: "親友桌",
    capacity: 8,
    notes: "靠近入口",
    layoutX: null,
    layoutY: null,
  },
];

const invalidPersistedLayoutRows = [
  {
    ...layoutTableRows[0],
    capacity: 10,
    notes: null,
    layoutX: 500,
    layoutY: 500,
  },
  {
    ...layoutTableRows[1],
    capacity: 10,
    notes: null,
    layoutX: 500,
    layoutY: 500,
  },
];

const layoutConflictMessage =
  "目前場地配置無法安全排列，請調整桌次位置後再試。";

describe("seating table server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    tableCreate.mockResolvedValue({ id: "table_1" });
    tableCreateMany.mockResolvedValue({ count: 2 });
    tableFindMany.mockResolvedValue([]);
    tableFindUnique.mockResolvedValue({ id: "table_1", capacity: 12, version: 0 });
    tableUpdate.mockResolvedValue({ id: "table_1" });
    tableUpdateMany.mockResolvedValue({ count: 1 });
    tableDelete.mockResolvedValue({ id: "table_1" });
    tableDeleteMany.mockResolvedValue({ count: 1 });
    guestFindUnique.mockResolvedValue({
      id: "guest_1",
      partySize: 3,
      attendanceStatus: "ATTENDING",
      seatingTableId: null,
    });
    guestFindMany.mockResolvedValue([]);
    guestAggregate.mockResolvedValue({ _sum: { partySize: 4 } });
    guestUpdate.mockResolvedValue({ id: "guest_1" });
    guestUpdateMany.mockResolvedValue({ count: 1 });
    queryRaw.mockResolvedValue([{ id: "table_1" }]);
    transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  it("creates only after session edit access and ignores forged ownership", async () => {
    const formData = validTableFormData();
    formData.set("workspaceId", "workspace_attacker");
    formData.set("userId", "attacker");
    formData.set("role", "OWNER");

    await expect(
      createSeatingTableAction("workspace_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已新增桌次。" });

    expect(requireCurrentUser).toHaveBeenCalledWith();
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    expect(tableCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        position: 1,
        name: "主 桌",
        capacity: 12,
        notes: "靠近舞台",
      },
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw.mock.calls[1]?.[0].strings.join(" ")).toContain(
      'UPDATE "wedding_workspaces"',
    );
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rejects create before write when the candidate whole layout cannot resolve", async () => {
    tableFindMany.mockResolvedValueOnce(invalidPersistedLayoutRows);

    await expect(
      createSeatingTableAction("workspace_1", idleState, validTableFormData()),
    ).resolves.toEqual({
      status: "error",
      message: layoutConflictMessage,
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(tableCreate).not.toHaveBeenCalled();
  });

  it("sets an initial total with stable positions and safe unique default names", async () => {
    const formData = new FormData();
    formData.set("totalTableCount", "2");
    formData.set("defaultCapacity", "10");

    await expect(
      adjustSeatingTablesAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "success",
      message: "已將總桌數設定為 2 桌。",
    });
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw.mock.calls[1]?.[0].strings.join(" ")).toContain(
      'UPDATE "wedding_workspaces"',
    );
    expect(tableCreateMany).toHaveBeenCalledWith({
      data: [
        {
          workspaceId: "workspace_1",
          position: 1,
          name: "待命名桌",
          capacity: 10,
        },
        {
          workspaceId: "workspace_1",
          position: 2,
          name: "待命名桌",
          capacity: 10,
        },
      ],
    });
  });

  it("rejects a bulk count increase before write when the candidate whole layout cannot resolve", async () => {
    tableFindMany.mockResolvedValueOnce(invalidPersistedLayoutRows);
    const formData = new FormData();
    formData.set("totalTableCount", "3");
    formData.set("defaultCapacity", "10");

    await expect(
      adjustSeatingTablesAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: layoutConflictMessage,
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(tableCreateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["P2034", { code: "P2034" }],
    ["P2010/40P01", { code: "P2010", meta: { code: "40P01" } }],
  ])(
    "retries a transient %s transaction conflict with a fresh Serializable transaction",
    async (_label, conflict) => {
      transaction
        .mockRejectedValueOnce(conflict)
        .mockImplementationOnce(async (operation) =>
          operation(transactionClient),
        );

      await expect(
        createSeatingTableAction(
          "workspace_1",
          idleState,
          validTableFormData(),
        ),
      ).resolves.toEqual({ status: "success", message: "已新增桌次。" });
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
        isolationLevel: "Serializable",
      });
      expect(transaction).toHaveBeenNthCalledWith(2, expect.any(Function), {
        isolationLevel: "Serializable",
      });
      expect(requireWorkspaceAccess).toHaveBeenCalledTimes(1);
      expect(requireLockedWorkspaceAccess).toHaveBeenCalledTimes(1);
    },
  );

  it("retries a transient unique-position race with a fresh Serializable transaction", async () => {
    tableCreateMany
      .mockRejectedValueOnce({
        code: "P2002",
        meta: { target: ["workspace_id", "position"] },
      })
      .mockResolvedValueOnce({ count: 2 });
    const formData = new FormData();
    formData.set("totalTableCount", "2");
    formData.set("defaultCapacity", "10");

    await expect(
      adjustSeatingTablesAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "success",
      message: "已將總桌數設定為 2 桌。",
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(transaction).toHaveBeenNthCalledWith(2, expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(requireWorkspaceAccess).toHaveBeenCalledTimes(1);
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledTimes(2);
  });

  it("retries a transient default-name race with a fresh Serializable transaction", async () => {
    tableCreateMany
      .mockRejectedValueOnce({
        code: "P2002",
        meta: { target: ["workspace_id", "name"] },
      })
      .mockResolvedValueOnce({ count: 2 });
    const formData = new FormData();
    formData.set("totalTableCount", "2");
    formData.set("defaultCapacity", "10");

    await expect(
      adjustSeatingTablesAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "success",
      message: "已將總桌數設定為 2 桌。",
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(requireWorkspaceAccess).toHaveBeenCalledTimes(1);
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledTimes(2);
  });

  it("reports a bounded adjustment name race as a concurrent change", async () => {
    tableCreateMany.mockRejectedValue({
      code: "P2002",
      meta: { target: ["workspace_id", "name"] },
    });
    const formData = new FormData();
    formData.set("totalTableCount", "2");
    formData.set("defaultCapacity", "10");

    await expect(
      adjustSeatingTablesAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: "同時有其他座位變更，請重新確認後再試。",
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("increases without changing existing ids or capacities", async () => {
    const updatedAt = new Date("2026-07-31T08:00:00.000Z");
    tableFindMany.mockResolvedValue([
      {
        id: "stable_table",
        position: 4,
        name: "待命名桌 A",
        capacity: 6,
        notes: "人工容量",
        updatedAt,
      },
    ]);
    const formData = new FormData();
    formData.set("totalTableCount", "3");
    formData.set("defaultCapacity", "12");

    await expect(
      adjustSeatingTablesAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "success",
      message: "已將總桌數設定為 3 桌。",
    });
    expect(tableUpdate).not.toHaveBeenCalled();
    expect(tableCreateMany).toHaveBeenCalledWith({
      data: [
        {
          workspaceId: "workspace_1",
          position: 5,
          name: "待命名桌",
          capacity: 12,
        },
        {
          workspaceId: "workspace_1",
          position: 6,
          name: "待命名桌",
          capacity: 12,
        },
      ],
    });
  });

  it("previews every highest-position empty table before a matching confirmation deletes it", async () => {
    tableFindMany.mockResolvedValue([
      {
        id: "table_1",
        position: 1,
        version: 2,
        name: "主桌",
        capacity: 6,
        notes: null,
      },
      {
        id: "table_2",
        position: 3,
        version: 4,
        name: "人工命名空桌",
        capacity: 8,
        notes: "保留到確認畫面",
      },
    ]);
    guestFindMany.mockResolvedValue([]);
    const formData = new FormData();
    formData.set("totalTableCount", "1");
    formData.set("defaultCapacity", "10");

    const preview = await adjustSeatingTablesAction(
      "workspace_1",
      idleState,
      formData,
    );
    expect(preview).toMatchObject({
      status: "confirmation",
      stale: false,
      message: "縮減桌數會永久移除所列空桌，請確認後再繼續。",
      confirmation: {
        operation: "adjust-table-count",
        targetTableCount: 1,
        removedTableCount: 1,
        affectedGuestGroupCount: 0,
        affectedGuestPartySize: 0,
        canConfirm: true,
        fingerprint: expect.stringMatching(
          /^vowbook-seating-removal-v1:[a-f0-9]{64}$/u,
        ),
        tables: [
          {
            position: 3,
            name: "人工命名空桌",
            capacity: 8,
            notes: "保留到確認畫面",
            affectedGuestGroupCount: 0,
            affectedGuestPartySize: 0,
          },
        ],
      },
    });
    const tableSnapshotLockSql = queryRaw.mock.calls
      .map(([statement]) =>
        Array.isArray(statement?.strings) ? statement.strings.join(" ") : "",
      )
      .find((statement) => statement.includes('FROM "seating_tables"'));
    expect(tableSnapshotLockSql).toMatch(/FOR UPDATE/u);
    expect(tableSnapshotLockSql).not.toMatch(/FOR NO KEY UPDATE/u);
    expect(tableDeleteMany).not.toHaveBeenCalled();

    const confirmForm = new FormData();
    confirmForm.set("totalTableCount", "1");
    confirmForm.set("defaultCapacity", "10");
    confirmForm.set(
      "snapshotFingerprint",
      preview.status === "confirmation"
        ? preview.confirmation.fingerprint
        : "unexpected",
    );
    await expect(
      adjustSeatingTablesAction("workspace_1", preview, confirmForm),
    ).resolves.toEqual({
      status: "success",
      message: "已縮減為 1 桌，並移除 1 桌空桌。",
    });
    expect(tableDeleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", id: { in: ["table_2"] } },
    });
  });

  it("blocks an occupied reduction even when its current fingerprint is submitted", async () => {
    tableFindMany.mockResolvedValue([
      {
        id: "table_1",
        position: 1,
        version: 0,
        name: "主桌",
        capacity: 10,
        notes: null,
      },
      {
        id: "table_2",
        position: 2,
        version: 3,
        name: "親友桌",
        capacity: 10,
        notes: "靠近出口",
      },
    ]);
    guestFindMany.mockResolvedValue([
      {
        id: "guest_1",
        version: 3,
        partySize: 4,
        seatingTableId: "table_2",
      },
    ]);
    const firstForm = new FormData();
    firstForm.set("totalTableCount", "1");
    firstForm.set("defaultCapacity", "10");

    const preview = await adjustSeatingTablesAction(
      "workspace_1",
      idleState,
      firstForm,
    );
    expect(preview).toMatchObject({
      status: "confirmation",
      stale: false,
      message: "待移除桌次仍有賓客，請先移動賓客後再縮減桌數。",
      confirmation: {
        targetTableCount: 1,
        removedTableCount: 1,
        affectedGuestGroupCount: 1,
        affectedGuestPartySize: 4,
        canConfirm: false,
        tables: [
          expect.objectContaining({
            name: "親友桌",
            notes: "靠近出口",
            affectedGuestGroupCount: 1,
            affectedGuestPartySize: 4,
          }),
        ],
      },
    });
    expect(tableDeleteMany).not.toHaveBeenCalled();

    const confirmForm = new FormData();
    confirmForm.set("totalTableCount", "1");
    confirmForm.set("defaultCapacity", "10");
    confirmForm.set(
      "snapshotFingerprint",
      preview.status === "confirmation"
        ? preview.confirmation.fingerprint
        : "unexpected",
    );
    await expect(
      adjustSeatingTablesAction("workspace_1", preview, confirmForm),
    ).resolves.toMatchObject({
      status: "confirmation",
      stale: false,
      message: "待移除桌次仍有賓客，請先移動賓客後再縮減桌數。",
      confirmation: {
        canConfirm: false,
      },
    });
    expect(guestUpdateMany).not.toHaveBeenCalled();
    expect(tableDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects a stale reduction fingerprint without writes and returns a fresh preview", async () => {
    const firstUpdatedAt = new Date("2026-07-31T08:00:00.000Z");
    const changedUpdatedAt = new Date("2026-07-31T08:01:00.000Z");
    tableFindMany.mockResolvedValue([
      {
        id: "table_1",
        position: 1,
        version: 0,
        name: "主桌",
        capacity: 10,
        notes: null,
        updatedAt: firstUpdatedAt,
      },
      {
        id: "table_2",
        position: 2,
        version: 0,
        name: "親友桌",
        capacity: 10,
        notes: null,
        updatedAt: firstUpdatedAt,
      },
    ]);
    guestFindMany.mockResolvedValue([
      {
        id: "guest_1",
        version: 1,
        partySize: 2,
        seatingTableId: "table_2",
        updatedAt: firstUpdatedAt,
      },
    ]);
    const firstForm = new FormData();
    firstForm.set("totalTableCount", "1");
    firstForm.set("defaultCapacity", "10");
    const firstPreview = await adjustSeatingTablesAction(
      "workspace_1",
      idleState,
      firstForm,
    );
    expect(firstPreview.status).toBe("confirmation");

    guestFindMany.mockResolvedValue([
      {
        id: "guest_1",
        version: 2,
        partySize: 3,
        seatingTableId: "table_2",
        updatedAt: changedUpdatedAt,
      },
    ]);
    const staleForm = new FormData();
    staleForm.set("totalTableCount", "1");
    staleForm.set("defaultCapacity", "10");
    staleForm.set(
      "snapshotFingerprint",
      firstPreview.status === "confirmation"
        ? firstPreview.confirmation.fingerprint
        : "unexpected",
    );

    const freshPreview = await adjustSeatingTablesAction(
      "workspace_1",
      firstPreview,
      staleForm,
    );
    expect(freshPreview).toMatchObject({
      status: "confirmation",
      stale: true,
      message: "桌次或賓客安排已變更，請重新確認最新影響。",
      confirmation: {
        affectedGuestGroupCount: 1,
        affectedGuestPartySize: 3,
      },
    });
    if (
      firstPreview.status === "confirmation" &&
      freshPreview.status === "confirmation"
    ) {
      expect(freshPreview.confirmation.fingerprint).not.toBe(
        firstPreview.confirmation.fingerprint,
      );
    }
    expect(guestUpdateMany).not.toHaveBeenCalled();
    expect(tableDeleteMany).not.toHaveBeenCalled();
  });

  it("binds the fingerprint to the absolute target and rejects tampering without writes", async () => {
    tableFindMany.mockResolvedValue([
      {
        id: "table_1",
        position: 1,
        version: 0,
        name: "第一桌",
        capacity: 10,
        notes: null,
      },
      {
        id: "table_2",
        position: 2,
        version: 0,
        name: "第二桌",
        capacity: 10,
        notes: null,
      },
    ]);
    guestFindMany.mockResolvedValue([]);
    const previewForm = new FormData();
    previewForm.set("totalTableCount", "1");
    previewForm.set("defaultCapacity", "10");
    const preview = await adjustSeatingTablesAction(
      "workspace_1",
      idleState,
      previewForm,
    );

    const tamperedForm = new FormData();
    tamperedForm.set("totalTableCount", "0");
    tamperedForm.set("defaultCapacity", "10");
    tamperedForm.set(
      "snapshotFingerprint",
      preview.status === "confirmation"
        ? preview.confirmation.fingerprint
        : "unexpected",
    );
    await expect(
      adjustSeatingTablesAction("workspace_1", preview, tamperedForm),
    ).resolves.toMatchObject({
      status: "confirmation",
      stale: true,
      confirmation: {
        targetTableCount: 0,
        removedTableCount: 2,
      },
    });
    expect(tableDeleteMany).not.toHaveBeenCalled();
  });

  it("denies VIEWER mutations before validation or database access", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      createSeatingTableAction("workspace_1", idleState, new FormData()),
    ).resolves.toEqual({
      status: "error",
      message: "無權存取此婚宴工作區。",
    });
    await expect(
      updateSeatingTableLayoutAction(
        "workspace_1",
        "table_1",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "無權存取此婚宴工作區。",
    });
    await expect(
      deleteSeatingTableAction(
        "workspace_1",
        "table_1",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "無權存取此婚宴工作區。",
    });
    expect(tableCreate).not.toHaveBeenCalled();
    expect(tableDelete).not.toHaveBeenCalled();
  });

  it("reuses one placeholder name for every added table now that names may repeat", async () => {
    // 以前要編出 A／B／C 是為了閃開桌名的唯一限制。桌次的身分改由桌號承擔
    // 之後，那串流水字母只是雜訊，兩張新桌就都叫「待命名桌」。
    tableFindMany.mockResolvedValue([
      {
        id: "table_a",
        position: 1,
        version: 0,
        name: "待命名桌",
        capacity: 10,
        notes: null,
      },
      {
        id: "table_c",
        position: 2,
        version: 0,
        name: "待命名桌",
        capacity: 10,
        notes: null,
      },
    ]);

    await expect(
      adjustSeatingTablesAction(
        "workspace_1",
        idleState,
        (() => {
          const data = new FormData();
          data.set("totalTableCount", "4");
          data.set("defaultCapacity", "8");
          return data;
        })(),
      ),
    ).resolves.toMatchObject({ status: "success" });

    expect(tableCreateMany).toHaveBeenCalledWith({
      data: [
        {
          workspaceId: "workspace_1",
          position: 3,
          name: "待命名桌",
          capacity: 8,
        },
        {
          workspaceId: "workspace_1",
          position: 4,
          name: "待命名桌",
          capacity: 8,
        },
      ],
    });
  });

  it("denies a mutation revoked after the early access check but before the write", async () => {
    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      createSeatingTableAction("workspace_1", idleState, validTableFormData()),
    ).resolves.toEqual({
      status: "error",
      message: "無權存取此婚宴工作區。",
    });
    expect(tableCreate).not.toHaveBeenCalled();
  });

  it("updates capacity in a Serializable transaction and rejects shrinking below assigned seats", async () => {
    tableFindMany.mockResolvedValueOnce([
      { ...layoutTableRows[0], capacity: 10, notes: null },
    ]);
    guestAggregate.mockResolvedValue({ _sum: { partySize: 8 } });
    const formData = validTableFormData();
    formData.set("capacity", "7");

    await expect(
      updateSeatingTableAction("workspace_1", "table_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: "桌次容量不可低於目前已安排的 8 位。",
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(guestAggregate).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", seatingTableId: "table_1" },
      _sum: { partySize: true },
    });
    expect(tableUpdateMany).not.toHaveBeenCalled();
  });

  it("updates a table with workspace-scoped CAS, increments version, and revalidates both views", async () => {
    tableFindMany.mockResolvedValueOnce([
      { ...layoutTableRows[0], capacity: 10, notes: null },
    ]);
    guestAggregate.mockResolvedValue({ _sum: { partySize: 4 } });

    await expect(
      updateSeatingTableAction(
        "workspace_1",
        "table_1",
        idleState,
        validTableFormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新桌次。" });

    expect(tableUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "table_1",
        workspaceId: "workspace_1",
        version: 0,
      },
      data: {
        name: "主 桌",
        capacity: 12,
        notes: "靠近舞台",
        version: { increment: 1 },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/guests",
    );
  });

  it("rejects a name edit before write when 主桌 selection leaves an invalid whole layout", async () => {
    tableFindMany.mockResolvedValueOnce(invalidPersistedLayoutRows);

    await expect(
      updateSeatingTableAction(
        "workspace_1",
        "table_1",
        idleState,
        validTableFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: layoutConflictMessage,
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(tableUpdateMany).not.toHaveBeenCalled();
  });

  it("persists paired layout coordinates with transaction-local access and workspace-scoped CAS", async () => {
    tableFindMany.mockResolvedValueOnce(layoutTableRows);

    await expect(
      updateSeatingTableLayoutAction(
        "workspace_1",
        "table_1",
        idleState,
        layoutFormData("250", "750"),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新場地位置。" });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw.mock.calls[0][0].join(" ")).toContain(
      "pg_advisory_xact_lock",
    );
    expect(executeRaw.mock.calls[1]?.[0].strings.join(" ")).toContain(
      'UPDATE "wedding_workspaces"',
    );
    expect(executeRaw.mock.calls[0][1]).toBe(
      "vowbook:seating:workspace_1",
    );
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tableFindMany.mock.invocationCallOrder[0],
    );
    expect(tableFindMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        position: true,
        version: true,
        name: true,
        capacity: true,
        notes: true,
        layoutX: true,
        layoutY: true,
      },
    });
    expect(tableUpdateMany).toHaveBeenCalledWith({
      where: { id: "table_1", workspaceId: "workspace_1", version: 0 },
      data: { layoutX: 250, layoutY: 750, version: { increment: 1 } },
    });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
  });

  it("resets both layout coordinates to null", async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        ...layoutTableRows[0],
        layoutX: 500,
        layoutY: 710,
      },
      {
        ...layoutTableRows[1],
        layoutX: 500,
        layoutY: 220,
      },
    ]);

    await expect(
      updateSeatingTableLayoutAction(
        "workspace_1",
        "table_1",
        idleState,
        layoutFormData("", ""),
      ),
    ).resolves.toEqual({ status: "success", message: "已還原自動排列。" });

    expect(tableUpdateMany).toHaveBeenCalledWith({
      where: { id: "table_1", workspaceId: "workspace_1", version: 0 },
      data: { layoutX: null, layoutY: null, version: { increment: 1 } },
    });
  });

  it("resets every manually placed table in one absolute bulk update", async () => {
    tableUpdateMany.mockResolvedValueOnce({ count: 3 });

    await expect(
      resetSeatingTableLayoutsAction("workspace_1", idleState, new FormData()),
    ).resolves.toEqual({
      status: "success",
      message: "已將 3 桌還原自動排列。",
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    // 序列鎖在前、工作區鎖定檢查在後，跟單桌操作同一套順序。
    expect(executeRaw.mock.calls[0][0].join(" ")).toContain(
      "pg_advisory_xact_lock",
    );
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    );
    // 絕對語意：只動還有手動座標的桌次，不吃用戶端版本。
    expect(tableUpdateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        OR: [{ layoutX: { not: null } }, { layoutY: { not: null } }],
      },
      data: { layoutX: null, layoutY: null, version: { increment: 1 } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
  });

  it("reports when there was nothing to reset", async () => {
    tableUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      resetSeatingTableLayoutsAction("workspace_1", idleState, new FormData()),
    ).resolves.toEqual({
      status: "success",
      message: "所有桌次都已是自動排列。",
    });
  });

  it("denies a bulk layout reset without edit access", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      resetSeatingTableLayoutsAction("workspace_1", idleState, new FormData()),
    ).resolves.toEqual({
      status: "error",
      message: "無權存取此婚宴工作區。",
    });
    expect(tableUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps table numbers and layout fixed while swapping labels and guests", async () => {
    tableFindMany.mockResolvedValueOnce(layoutTableRows);
    guestFindMany.mockResolvedValueOnce([
      { id: "guest_main", version: 2, partySize: 3, seatingTableId: "table_1" },
      { id: "guest_friends", version: 5, partySize: 2, seatingTableId: "table_2" },
    ]);

    await expect(
      swapSeatingTableContentsAction(
        "workspace_1",
        "table_1",
        idleState,
        swapFormData("table_2"),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已交換兩桌的桌名與入座賓客；桌號保持不變。",
    });

    // 桌次 id、position、layout、capacity 與 notes 都不寫；只換桌名。
    expect(tableUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "table_1", workspaceId: "workspace_1", version: 0 },
      data: { name: "親友桌", version: { increment: 1 } },
    });
    expect(tableUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "table_2", workspaceId: "workspace_1", version: 0 },
      data: { name: "主桌", version: { increment: 1 } },
    });
    expect(guestUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        workspaceId: "workspace_1",
        id: { in: ["guest_main"] },
        seatingTableId: "table_1",
      },
      data: { seatingTableId: "table_2", version: { increment: 1 } },
    });
    expect(guestUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        workspaceId: "workspace_1",
        id: { in: ["guest_friends"] },
        seatingTableId: "table_2",
      },
      data: { seatingTableId: "table_1", version: { increment: 1 } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/guests",
    );
  });

  it("refuses a content swap with itself, an unknown table, or a stale version", async () => {
    await expect(
      swapSeatingTableContentsAction(
        "workspace_1",
        "table_1",
        idleState,
        swapFormData("table_1"),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "請選擇另一張要交換內容的桌次。",
    });

    tableFindMany.mockResolvedValueOnce(layoutTableRows);
    await expect(
      swapSeatingTableContentsAction(
        "workspace_1",
        "table_1",
        idleState,
        swapFormData("table_missing"),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "桌次不存在或已被移除，請重新整理後再試。",
    });

    // 對方的版本過期也要擋下來，否則會覆寫別人剛改的桌名或座位。
    tableFindMany.mockResolvedValueOnce([
      layoutTableRows[0],
      { ...layoutTableRows[1], version: 4 },
    ]);
    await expect(
      swapSeatingTableContentsAction(
        "workspace_1",
        "table_1",
        idleState,
        swapFormData("table_2"),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "桌次已由其他人更新，請重新載入後再試。",
    });

    expect(tableUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a content swap when either fixed table capacity would overflow", async () => {
    tableFindMany.mockResolvedValueOnce([
      { ...layoutTableRows[0], capacity: 4 },
      { ...layoutTableRows[1], capacity: 10 },
    ]);
    guestFindMany.mockResolvedValueOnce([
      { id: "guest_main", version: 0, partySize: 2, seatingTableId: "table_1" },
      { id: "guest_friends", version: 0, partySize: 6, seatingTableId: "table_2" },
    ]);

    await expect(
      swapSeatingTableContentsAction(
        "workspace_1",
        "table_1",
        idleState,
        swapFormData("table_2"),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "交換後會超過其中一桌的容量，請先調整座位或桌次容量。",
    });

    expect(tableUpdateMany).not.toHaveBeenCalled();
    expect(guestUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects reset before write when another persisted pair keeps the full layout unresolvable", async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        ...layoutTableRows[0],
        layoutX: 0,
        layoutY: 0,
      },
      ...invalidPersistedLayoutRows.map((table, index) => ({
        ...table,
        id: `invalid_${index}`,
        position: index + 2,
      })),
    ]);

    await expect(
      updateSeatingTableLayoutAction(
        "workspace_1",
        "table_1",
        idleState,
        layoutFormData("", ""),
      ),
    ).resolves.toEqual({
      status: "error",
      message: layoutConflictMessage,
    });

    expect(tableUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects stale, cross-workspace, and partially specified layout writes", async () => {
    tableFindMany.mockResolvedValueOnce([
      { ...layoutTableRows[0], version: 4 },
      layoutTableRows[1],
    ]);
    await expect(
      updateSeatingTableLayoutAction(
        "workspace_1",
        "table_1",
        idleState,
        layoutFormData("500", "710", 3),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "桌次已由其他人更新，請重新載入後再試。",
    });

    tableFindMany.mockResolvedValueOnce([]);
    await expect(
      updateSeatingTableLayoutAction(
        "workspace_1",
        "table_from_workspace_2",
        idleState,
        layoutFormData("250", "750"),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "桌次不存在或已被移除，請重新整理後再試。",
    });

    const partial = layoutFormData("250", "");
    await expect(
      updateSeatingTableLayoutAction(
        "workspace_1",
        "table_1",
        idleState,
        partial,
      ),
    ).resolves.toEqual({
      status: "error",
      message: "場地座標必須成對設定。",
    });
    expect(tableUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a crafted invalid full layout after locking the workspace and before CAS update", async () => {
    tableFindMany.mockResolvedValueOnce([
      layoutTableRows[0],
      {
        ...layoutTableRows[1],
        layoutX: 500,
        layoutY: 710,
      },
    ]);
    const crafted = layoutFormData("500", "710");
    crafted.set("workspaceId", "workspace_attacker");
    crafted.set("userId", "attacker");
    crafted.set("role", "OWNER");

    await expect(
      updateSeatingTableLayoutAction(
        "workspace_1",
        "table_1",
        idleState,
        crafted,
      ),
    ).resolves.toEqual({
      status: "error",
      message: layoutConflictMessage,
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(tableFindMany).toHaveBeenCalledTimes(1);
    expect(tableUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale table edit with a clear message and no write", async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        ...layoutTableRows[0],
        version: 4,
        capacity: 12,
        notes: null,
      },
    ]);

    await expect(
      updateSeatingTableAction(
        "workspace_1",
        "table_1",
        idleState,
        validTableFormData(3),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "桌次已由其他人更新，請重新載入後再試。",
    });

    expect(guestAggregate).not.toHaveBeenCalled();
    expect(tableUpdateMany).not.toHaveBeenCalled();
  });

  it("assigns an unassigned guest without exceeding capacity", async () => {
    const formData = new FormData();
    formData.set("tableId", "table_1");
    formData.set("workspaceId", "workspace_attacker");
    guestAggregate.mockResolvedValue({ _sum: { partySize: 7 } });

    await expect(
      assignGuestToTableAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已安排賓客桌次。" });

    expect(guestFindUnique).toHaveBeenCalledWith({
      where: {
        id_workspaceId: { id: "guest_1", workspaceId: "workspace_1" },
      },
      select: {
        id: true,
        partySize: true,
        attendanceStatus: true,
        seatingTableId: true,
      },
    });
    expect(tableFindUnique).toHaveBeenCalledWith({
      where: {
        id_workspaceId: { id: "table_1", workspaceId: "workspace_1" },
      },
      select: { id: true, capacity: true },
    });
    const assignmentLockSql = queryRaw.mock.calls
      .map(([statement]) =>
        Array.isArray(statement?.strings) ? statement.strings.join(" ") : "",
      )
      .find((statement) => statement.includes("FOR KEY SHARE"));
    expect(assignmentLockSql).toContain('FROM "seating_tables"');
    expect(assignmentLockSql).toContain('"workspace_id" =');
    expect(assignmentLockSql).toContain('"id" =');
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      guestUpdate.mock.invocationCallOrder[0],
    );
    expect(guestUpdate).toHaveBeenCalledWith({
      where: {
        id_workspaceId: { id: "guest_1", workspaceId: "workspace_1" },
      },
      data: { seatingTableId: "table_1", version: { increment: 1 } },
    });
  });

  it("rejects a declined guest submitted through a stale assignment form", async () => {
    const formData = new FormData();
    formData.set("tableId", "table_1");
    guestFindUnique.mockResolvedValue({
      id: "guest_1",
      partySize: 3,
      attendanceStatus: "DECLINED",
      seatingTableId: null,
    });

    await expect(
      assignGuestToTableAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: "此賓客已標記為不出席，無法安排座位。",
    });

    expect(tableFindUnique).not.toHaveBeenCalled();
    expect(guestAggregate).not.toHaveBeenCalled();
    expect(guestUpdate).not.toHaveBeenCalled();
  });

  it("rejects over-capacity assignment and does not leak cross-workspace records", async () => {
    const formData = new FormData();
    formData.set("tableId", "table_from_workspace_2");
    guestAggregate.mockResolvedValue({ _sum: { partySize: 10 } });

    await expect(
      assignGuestToTableAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: "此桌剩餘座位不足，請重新安排。",
    });
    expect(guestUpdate).not.toHaveBeenCalled();

    tableFindUnique.mockResolvedValueOnce(null);
    await expect(
      assignGuestToTableAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: "桌次不存在或已被移除，請重新整理後再試。",
    });
    expect(tableFindUnique).toHaveBeenLastCalledWith({
      where: {
        id_workspaceId: {
          id: "table_from_workspace_2",
          workspaceId: "workspace_1",
        },
      },
      select: { id: true, capacity: true },
    });
  });

  it("does not double-count a guest when the same table is saved again", async () => {
    const formData = new FormData();
    formData.set("tableId", "table_1");
    guestFindUnique.mockResolvedValue({
      id: "guest_1",
      partySize: 3,
      seatingTableId: "table_1",
    });
    guestAggregate.mockResolvedValue({ _sum: { partySize: 10 } });

    await expect(
      assignGuestToTableAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "桌次安排沒有變更。" });
    expect(guestUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/guests",
    );
  });

  it("unassigns by composite selector and previews then confirms an empty-table deletion", async () => {
    await expect(
      unassignGuestFromTableAction(
        "workspace_1",
        "guest_1",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "已將賓客移出桌次。" });
    expect(guestUpdate).toHaveBeenCalledWith({
      where: {
        id_workspaceId: { id: "guest_1", workspaceId: "workspace_1" },
      },
      data: { seatingTableId: null, version: { increment: 1 } },
    });

    tableFindMany.mockResolvedValue([
      {
        id: "table_1",
        position: 1,
        version: 5,
        name: "待刪空桌",
        capacity: 12,
        notes: "人工備註",
      },
    ]);
    guestFindMany.mockResolvedValue([]);
    const preview = await deleteSeatingTableAction(
      "workspace_1",
      "table_1",
      idleState,
      new FormData(),
    );
    expect(preview).toMatchObject({
      status: "confirmation",
      stale: false,
      message: "刪除桌次會永久移除此空桌，請確認後再繼續。",
      confirmation: {
        operation: "delete-table",
        targetTableCount: 0,
        removedTableCount: 1,
        affectedGuestGroupCount: 0,
        affectedGuestPartySize: 0,
        canConfirm: true,
        tables: [
          {
            name: "待刪空桌",
            capacity: 12,
            notes: "人工備註",
          },
        ],
      },
    });
    expect(tableDeleteMany).not.toHaveBeenCalled();

    const confirmForm = new FormData();
    confirmForm.set(
      "snapshotFingerprint",
      preview.status === "confirmation"
        ? preview.confirmation.fingerprint
        : "unexpected",
    );
    await expect(
      deleteSeatingTableAction(
        "workspace_1",
        "table_1",
        preview,
        confirmForm,
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已刪除空桌。",
    });
    expect(tableDeleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", id: { in: ["table_1"] } },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(guestUpdate).toHaveBeenCalledTimes(1);
    expect(guestUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a reduction candidate before returning a commit-capable confirmation", async () => {
    tableFindMany.mockResolvedValue([
      ...invalidPersistedLayoutRows,
      {
        id: "table_removed",
        workspaceId: "workspace_1",
        position: 3,
        version: 0,
        name: "待移除桌",
        capacity: 10,
        notes: null,
        layoutX: null,
        layoutY: null,
      },
    ]);
    guestFindMany.mockResolvedValue([]);
    const formData = new FormData();
    formData.set("totalTableCount", "2");
    formData.set("defaultCapacity", "10");

    await expect(
      adjustSeatingTablesAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: layoutConflictMessage,
    });

    expect(tableDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects a delete candidate before returning a commit-capable confirmation", async () => {
    tableFindMany.mockResolvedValue([
      ...invalidPersistedLayoutRows,
      {
        id: "table_removed",
        workspaceId: "workspace_1",
        position: 3,
        version: 0,
        name: "待移除桌",
        capacity: 10,
        notes: null,
        layoutX: null,
        layoutY: null,
      },
    ]);
    guestFindMany.mockResolvedValue([]);

    await expect(
      deleteSeatingTableAction(
        "workspace_1",
        "table_removed",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: layoutConflictMessage,
    });

    expect(tableDeleteMany).not.toHaveBeenCalled();
  });

  it("blocks occupied single-table deletion and never unassigns its guests", async () => {
    tableFindMany.mockResolvedValue([
      {
        id: "table_1",
        position: 1,
        version: 2,
        name: "有人桌",
        capacity: 10,
        notes: null,
      },
    ]);
    guestFindMany.mockResolvedValue([
      {
        id: "guest_1",
        version: 7,
        partySize: 3,
        seatingTableId: "table_1",
      },
    ]);

    const preview = await deleteSeatingTableAction(
      "workspace_1",
      "table_1",
      idleState,
      new FormData(),
    );
    expect(preview).toMatchObject({
      status: "confirmation",
      message: "此桌仍有 1 組、3 位賓客，請先移動賓客後再刪除桌次。",
      confirmation: {
        operation: "delete-table",
        canConfirm: false,
        affectedGuestGroupCount: 1,
        affectedGuestPartySize: 3,
      },
    });

    const forgedConfirm = new FormData();
    forgedConfirm.set(
      "snapshotFingerprint",
      preview.status === "confirmation"
        ? preview.confirmation.fingerprint
        : "unexpected",
    );
    await expect(
      deleteSeatingTableAction(
        "workspace_1",
        "table_1",
        preview,
        forgedConfirm,
      ),
    ).resolves.toMatchObject({
      status: "confirmation",
      confirmation: { canConfirm: false },
    });
    expect(tableDeleteMany).not.toHaveBeenCalled();
    expect(guestUpdateMany).not.toHaveBeenCalled();
  });

  it("rolls back when the confirmed removal row count does not match the snapshot", async () => {
    tableFindMany.mockResolvedValue([
      {
        id: "table_1",
        position: 1,
        version: 0,
        name: "空桌",
        capacity: 10,
        notes: null,
      },
    ]);
    guestFindMany.mockResolvedValue([]);
    const preview = await deleteSeatingTableAction(
      "workspace_1",
      "table_1",
      idleState,
      new FormData(),
    );
    const confirmForm = new FormData();
    confirmForm.set(
      "snapshotFingerprint",
      preview.status === "confirmation"
        ? preview.confirmation.fingerprint
        : "unexpected",
    );
    tableDeleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      deleteSeatingTableAction(
        "workspace_1",
        "table_1",
        preview,
        confirmForm,
      ),
    ).resolves.toEqual({
      status: "error",
      message: "桌次已變更，未刪除任何資料；請重新預覽後再試。",
    });
  });

  it("returns a safe conflict message after bounded serialization retries", async () => {
    transaction.mockRejectedValue(Object.assign(new Error("write conflict"), { code: "P2034" }));

    await expect(
      updateSeatingTableAction(
        "workspace_1",
        "table_1",
        idleState,
        validTableFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "同時有其他座位變更，請重新確認後再試。",
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("accepts a table name that another table already uses", async () => {
    // 桌名沒有唯一限制了：好幾桌都叫「男方同事」是常態，桌號才是身分。
    tableFindMany.mockResolvedValueOnce([
      { ...layoutTableRows[0], name: "婚宴桌", capacity: 10, notes: null },
    ]);
    await expect(
      createSeatingTableAction("workspace_1", idleState, validTableFormData()),
    ).resolves.toMatchObject({ status: "success" });
  });

  it("does not misreport a position race as a duplicate table name", async () => {
    tableCreate.mockRejectedValue({
      code: "P2002",
      meta: { target: "seating_tables_workspace_id_position_key" },
    });

    await expect(
      createSeatingTableAction("workspace_1", idleState, validTableFormData()),
    ).resolves.toEqual({
      status: "error",
      message: "同時有其他座位變更，請重新確認後再試。",
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("sanitizes membership and database errors", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(new Error("membership secret"));
    await expect(
      createSeatingTableAction("workspace_1", idleState, validTableFormData()),
    ).resolves.toEqual({
      status: "error",
      message: "目前無法確認工作區權限，請稍後再試。",
    });

    requireWorkspaceAccess.mockResolvedValueOnce({ role: "OWNER" });
    tableCreate.mockRejectedValueOnce(new Error("database secret"));
    await expect(
      createSeatingTableAction("workspace_1", idleState, validTableFormData()),
    ).resolves.toEqual({
      status: "error",
      message: "目前無法新增桌次，請稍後再試。",
    });
  });
});
