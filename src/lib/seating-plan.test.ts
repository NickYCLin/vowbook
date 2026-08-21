import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  findTables,
  findGuests,
  transaction,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  findTables: vi.fn(),
  findGuests: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    seatingTable: { findMany: findTables },
    guest: { findMany: findGuests },
    $transaction: transaction,
  },
}));

import { SeatingPlanDataError, getSeatingPlan } from "./seating-plan";

describe("getSeatingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    findTables.mockResolvedValue([]);
    findGuests.mockResolvedValue([]);
    transaction.mockImplementation(async (operation) =>
      operation({
        seatingTable: { findMany: findTables },
        guest: { findMany: findGuests },
      }),
    );
  });

  it("authenticates, authorizes, then scopes tables and unassigned guests", async () => {
    await expect(getSeatingPlan("workspace_1")).resolves.toMatchObject({
      role: "VIEWER",
      tables: [],
      unassignedGuests: [],
    });

    expect(requireCurrentUser).toHaveBeenCalledWith();
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "read",
    );
    expect(findTables).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
      orderBy: [{ position: "asc" }],
      select: {
        id: true,
        position: true,
        version: true,
        layoutX: true,
        layoutY: true,
        name: true,
        capacity: true,
        notes: true,
        guests: {
          where: { workspaceId: "workspace_1" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, name: true, partySize: true, side: true },
        },
      },
    });
    expect(findGuests).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        seatingTableId: null,
        attendanceStatus: { not: "DECLINED" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        partySize: true,
        version: true,
        side: true,
        attendanceStatus: true,
        notes: true,
        importRecords: {
          select: { sourceManaged: true, managedFields: true },
        },
      },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      findTables.mock.invocationCallOrder[0],
    );
  });

  it("returns persisted and legacy-null floor-plan coordinates without writing defaults", async () => {
    findTables.mockResolvedValueOnce([
      {
        id: "table_persisted",
        position: 1,
        version: 2,
        layoutX: 200,
        layoutY: 700,
        name: "主桌",
        capacity: 10,
        notes: null,
        guests: [],
      },
      {
        id: "table_legacy",
        position: 2,
        version: 0,
        layoutX: null,
        layoutY: null,
        name: "親友桌",
        capacity: 8,
        notes: null,
        guests: [],
      },
    ]);

    await expect(getSeatingPlan("workspace_1")).resolves.toMatchObject({
      tables: [
        { id: "table_persisted", number: 1, layoutX: 200, layoutY: 700 },
        { id: "table_legacy", number: 2, layoutX: null, layoutY: null },
      ],
    });
  });

  it("numbers tables by seating order and skips the avoided numbers", async () => {
    // 桌號跟著順位走，不是 position 欄位本身：中間刪掉一桌之後 position 會
    // 留洞，桌號還是得連著編。
    findTables.mockResolvedValueOnce(
      [1, 2, 3, 7, 9, 20].map((position, index) => ({
        id: `table_${index}`,
        position,
        version: 0,
        layoutX: null,
        layoutY: null,
        name: "男方同事",
        capacity: 10,
        notes: null,
        guests: [],
      })),
    );

    const plan = await getSeatingPlan("workspace_1");

    expect(plan.tables.map((table) => table.number)).toEqual([
      1, 2, 3, 5, 6, 7,
    ]);
  });

  it("flags source-managed party sizes without leaking the import records", async () => {
    findGuests.mockResolvedValueOnce([
      {
        id: "guest_managed",
        name: "匯入賓客",
        category: "GUEST",
        partySize: 4,
        version: 2,
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        notes: null,
        importRecords: [
          { sourceManaged: true, managedFields: ["NAME", "PARTY_SIZE"] },
        ],
      },
      {
        id: "guest_unmanaged",
        name: "手動賓客",
        category: "GUEST",
        partySize: 2,
        version: 1,
        side: "PARTNER_A",
        attendanceStatus: "UNDECIDED",
        notes: "臨時加人",
        // 有匯入紀錄但來源沒有接管人數，仍然可以就地編輯。
        importRecords: [{ sourceManaged: false, managedFields: ["PARTY_SIZE"] }],
      },
    ]);

    const { unassignedGuests } = await getSeatingPlan("workspace_1");

    expect(unassignedGuests).toEqual([
      {
        id: "guest_managed",
        name: "匯入賓客",
        category: "GUEST",
        partySize: 4,
        version: 2,
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        notes: null,
        partySizeManaged: true,
      },
      {
        id: "guest_unmanaged",
        name: "手動賓客",
        category: "GUEST",
        partySize: 2,
        version: 1,
        side: "PARTNER_A",
        attendanceStatus: "UNDECIDED",
        notes: "臨時加人",
        partySizeManaged: false,
      },
    ]);
    expect(unassignedGuests[0]).not.toHaveProperty("importRecords");
  });

  it("preserves access denial for the page to translate to 404", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(getSeatingPlan("workspace_secret")).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
    expect(findTables).not.toHaveBeenCalled();
    expect(findGuests).not.toHaveBeenCalled();
  });

  it("sanitizes membership and read failures", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new Error("membership database secret"),
    );
    await expect(getSeatingPlan("workspace_1")).rejects.toEqual(
      new SeatingPlanDataError("目前無法載入桌次安排，請稍後再試。"),
    );

    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1" },
    });
    findTables.mockRejectedValueOnce(new Error("postgres://secret"));
    await expect(getSeatingPlan("workspace_1")).rejects.toEqual(
      new SeatingPlanDataError("目前無法載入桌次安排，請稍後再試。"),
    );
  });
});
