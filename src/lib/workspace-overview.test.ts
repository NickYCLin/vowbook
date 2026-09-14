import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  transaction,
  rootMembershipFindMany,
  rootGuestGroupBy,
  rootTableGroupBy,
  rootTaskGroupBy,
  rootBudgetGroupBy,
  membershipFindMany,
  guestGroupBy,
  tableGroupBy,
  taskGroupBy,
  budgetGroupBy,
} = vi.hoisted(() => ({
  transaction: vi.fn(),
  rootMembershipFindMany: vi.fn(),
  rootGuestGroupBy: vi.fn(),
  rootTableGroupBy: vi.fn(),
  rootTaskGroupBy: vi.fn(),
  rootBudgetGroupBy: vi.fn(),
  membershipFindMany: vi.fn(),
  guestGroupBy: vi.fn(),
  tableGroupBy: vi.fn(),
  taskGroupBy: vi.fn(),
  budgetGroupBy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    membership: { findMany: rootMembershipFindMany },
    guest: { groupBy: rootGuestGroupBy },
    seatingTable: { groupBy: rootTableGroupBy },
    weddingTask: { groupBy: rootTaskGroupBy },
    budgetItem: { groupBy: rootBudgetGroupBy },
  },
}));

import {
  daysUntilWedding,
  listWorkspaceOverviewsForUser,
} from "./workspace-overview";

const memberships = [
  {
    id: "membership_1",
    userId: "user_1",
    workspaceId: "workspace_1",
    role: "OWNER",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    workspace: {
      id: "workspace_1",
      name: "第一場婚宴",
      weddingDate: null,
      timezone: "Asia/Taipei",
      updatedAt: new Date("2026-01-01T01:00:00.000Z"),
    },
  },
  {
    id: "membership_2",
    userId: "user_1",
    workspaceId: "workspace_2",
    role: "VIEWER",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    workspace: {
      id: "workspace_2",
      name: "第二場婚宴",
      weddingDate: null,
      timezone: "Asia/Taipei",
      updatedAt: new Date("2026-02-01T01:00:00.000Z"),
    },
  },
];

describe("listWorkspaceOverviewsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    membershipFindMany.mockResolvedValue(memberships);
    guestGroupBy.mockResolvedValue([
      {
        workspaceId: "workspace_1",
        category: "GUEST",
        attendanceStatus: "ATTENDING",
        _count: { _all: 2 },
        _sum: { partySize: 5 },
      },
      {
        workspaceId: "workspace_1",
        category: "GUEST",
        attendanceStatus: "DECLINED",
        _count: { _all: 1 },
        _sum: { partySize: 1 },
      },
      {
        workspaceId: "workspace_1",
        category: "COUPLE",
        attendanceStatus: "ATTENDING",
        _count: { _all: 1 },
        _sum: { partySize: 2 },
      },
      {
        workspaceId: "workspace_2",
        category: "GUEST",
        attendanceStatus: "UNDECIDED",
        _count: { _all: 4 },
        _sum: { partySize: 4 },
      },
    ]);
    tableGroupBy.mockResolvedValue([
      { workspaceId: "workspace_1", _count: { _all: 3 } },
    ]);
    taskGroupBy.mockResolvedValue([
      { workspaceId: "workspace_1", status: "TODO", _count: { _all: 2 } },
      { workspaceId: "workspace_1", status: "DONE", _count: { _all: 1 } },
    ]);
    budgetGroupBy.mockResolvedValue([
      {
        workspaceId: "workspace_1",
        _sum: { plannedAmount: 100_000, actualAmount: 40_000 },
      },
      {
        workspaceId: "workspace_2",
        _sum: { plannedAmount: null, actualAmount: null },
      },
    ]);

    transaction.mockImplementation(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback({
          membership: { findMany: membershipFindMany },
          guest: { groupBy: guestGroupBy },
          seatingTable: { groupBy: tableGroupBy },
          weddingTask: { groupBy: taskGroupBy },
          budgetItem: { groupBy: budgetGroupBy },
        }),
    );

    // Keep the pre-fix implementation runnable so the contract fails on the
    // missing transaction instead of an incidental undefined mock.
    rootMembershipFindMany.mockResolvedValue(memberships);
    rootGuestGroupBy.mockResolvedValue([]);
    rootTableGroupBy.mockResolvedValue([]);
    rootTaskGroupBy.mockResolvedValue([]);
    rootBudgetGroupBy.mockResolvedValue([]);
  });

  it("authorizes memberships before reading every aggregate from one RepeatableRead client", async () => {
    await expect(listWorkspaceOverviewsForUser("user_1")).resolves.toEqual([
      {
        membershipId: "membership_1",
        role: "OWNER",
        workspace: memberships[0].workspace,
        stats: {
          guestTotal: 3,
          guestResponded: 3,
          guestAttending: 2,
          attendingHeadcount: 7,
          tableTotal: 3,
          taskTotal: 3,
          taskDone: 1,
          budgetPlanned: 100_000,
          budgetActual: 40_000,
        },
      },
      {
        membershipId: "membership_2",
        role: "VIEWER",
        workspace: memberships[1].workspace,
        stats: {
          guestTotal: 4,
          guestResponded: 0,
          guestAttending: 0,
          attendingHeadcount: 0,
          tableTotal: 0,
          taskTotal: 0,
          taskDone: 0,
          budgetPlanned: 0,
          budgetActual: 0,
        },
      },
    ]);

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(membershipFindMany).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: {
        id: true,
        workspaceId: true,
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            weddingDate: true,
            timezone: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const query of [
      guestGroupBy,
      tableGroupBy,
      taskGroupBy,
      budgetGroupBy,
    ]) {
      expect(membershipFindMany.mock.invocationCallOrder[0]).toBeLessThan(
        query.mock.invocationCallOrder[0],
      );
    }

    expect(guestGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: { in: ["workspace_1", "workspace_2"] } },
      }),
    );
    expect(tableGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: { in: ["workspace_1", "workspace_2"] } },
      }),
    );
    expect(taskGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: { in: ["workspace_1", "workspace_2"] } },
      }),
    );
    expect(budgetGroupBy).toHaveBeenCalledWith({
      by: ["workspaceId"],
      where: {
        workspaceId: { in: ["workspace_1", "workspace_2"] },
        kind: "EXPENSE",
        preparationStatus: "NEEDS_ACTION",
      },
      _sum: { plannedAmount: true, actualAmount: true },
    });

    expect(rootMembershipFindMany).not.toHaveBeenCalled();
    expect(rootGuestGroupBy).not.toHaveBeenCalled();
    expect(rootTableGroupBy).not.toHaveBeenCalled();
    expect(rootTaskGroupBy).not.toHaveBeenCalled();
    expect(rootBudgetGroupBy).not.toHaveBeenCalled();
  });

  it("does not issue aggregate queries when the user has no memberships", async () => {
    membershipFindMany.mockResolvedValueOnce([]);

    await expect(listWorkspaceOverviewsForUser("user_without_workspace")).resolves.toEqual(
      [],
    );

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_without_workspace" } }),
    );
    expect(guestGroupBy).not.toHaveBeenCalled();
    expect(tableGroupBy).not.toHaveBeenCalled();
    expect(taskGroupBy).not.toHaveBeenCalled();
    expect(budgetGroupBy).not.toHaveBeenCalled();
  });
});

describe("daysUntilWedding", () => {
  it("uses the workspace calendar day instead of the UTC runtime day", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "UTC";

    try {
      const weddingDate = new Date("2027-05-20T00:00:00.000Z");

      expect(
        daysUntilWedding(
          weddingDate,
          new Date("2027-05-19T15:59:59.999Z"),
          "Asia/Taipei",
        ),
      ).toBe(1);
      expect(
        daysUntilWedding(
          weddingDate,
          new Date("2027-05-19T16:00:00.000Z"),
          "Asia/Taipei",
        ),
      ).toBe(0);
      expect(
        daysUntilWedding(
          weddingDate,
          new Date("2027-05-20T16:00:00.000Z"),
          "Asia/Taipei",
        ),
      ).toBeNull();
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });

  it("returns null when the wedding date is not configured", () => {
    expect(
      daysUntilWedding(
        null,
        new Date("2027-05-19T16:00:00.000Z"),
        "Asia/Taipei",
      ),
    ).toBeNull();
  });
});
