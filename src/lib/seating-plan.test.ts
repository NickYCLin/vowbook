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
          select: {
            id: true,
            name: true,
            partySize: true,
            side: true,
            notes: true,
            importRecords: {
              orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
              select: {
                source: true,
                sourceInstance: true,
                sourceManaged: true,
                childSeatCount: true,
              },
            },
          },
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

  it("returns each seated guest's effective child-seat count without exposing provenance", async () => {
    findTables.mockResolvedValueOnce([
      {
        id: "table_main",
        position: 1,
        version: 2,
        layoutX: null,
        layoutY: null,
        name: "主桌",
        capacity: 10,
        notes: null,
        guests: [
          {
            id: "guest_manual",
            name: "人工調整",
            partySize: 3,
            side: "SHARED",
            notes: null,
            importRecords: [
              {
                source: "LINEIN",
                sourceInstance: "default",
                sourceManaged: true,
                childSeatCount: 2,
              },
              {
                source: "MANUAL",
                sourceInstance: "guest-details",
                sourceManaged: false,
                childSeatCount: 1,
              },
            ],
          },
          {
            id: "guest_cleared",
            name: "已取消需求",
            partySize: 2,
            side: "PARTNER_A",
            notes: null,
            importRecords: [
              {
                source: "LINEIN",
                sourceInstance: "default",
                sourceManaged: true,
                childSeatCount: 2,
              },
              {
                source: "MANUAL",
                sourceInstance: "guest-details",
                sourceManaged: false,
                childSeatCount: null,
              },
            ],
          },
          {
            id: "guest_imported",
            name: "沿用匯入",
            partySize: 2,
            side: "PARTNER_B",
            notes: null,
            importRecords: [
              {
                source: "MANUAL",
                sourceInstance: "legacy",
                sourceManaged: false,
                childSeatCount: 1,
              },
              {
                source: "LINEIN",
                sourceInstance: "default",
                sourceManaged: true,
                childSeatCount: 2,
              },
            ],
          },
        ],
      },
    ]);

    const plan = await getSeatingPlan("workspace_1");

    expect(plan.tables[0]?.guests).toEqual([
      expect.objectContaining({ id: "guest_manual", childSeatCount: 1 }),
      expect.objectContaining({ id: "guest_cleared", childSeatCount: null }),
      expect.objectContaining({ id: "guest_imported", childSeatCount: 2 }),
    ]);
    expect(plan.tables[0]?.guests[0]).not.toHaveProperty("importRecords");
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
