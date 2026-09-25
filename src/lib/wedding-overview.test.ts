import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  transaction,
  guestFindMany,
  tableFindMany,
  taskFindMany,
  budgetFindMany,
  staffCount,
  timelineCount,
  membershipCount,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  transaction: vi.fn(),
  guestFindMany: vi.fn(),
  tableFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  budgetFindMany: vi.fn(),
  staffCount: vi.fn(),
  timelineCount: vi.fn(),
  membershipCount: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import {
  getWeddingOverview,
  WeddingOverviewDataError,
} from "./wedding-overview";

describe("getWeddingOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: {
        id: "workspace_1",
        name: "合成婚宴",
        weddingDate: new Date("2027-05-20T00:00:00.000Z"),
        timezone: "Asia/Taipei",
      },
    });
    guestFindMany.mockResolvedValue([]);
    tableFindMany.mockResolvedValue([]);
    taskFindMany.mockResolvedValue([]);
    budgetFindMany.mockResolvedValue([]);
    staffCount.mockResolvedValue(0);
    timelineCount.mockResolvedValue(0);
    membershipCount.mockResolvedValue(1);
    transaction.mockImplementation(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback({
          guest: { findMany: guestFindMany },
          seatingTable: { findMany: tableFindMany },
          weddingTask: { findMany: taskFindMany },
          budgetItem: { findMany: budgetFindMany },
          weddingStaffAssignment: { count: staffCount },
          weddingTimelineItem: { count: timelineCount },
          membership: { count: membershipCount },
        }),
    );
  });

  it("authorizes and reads every aggregate in one tenant-scoped RepeatableRead snapshot", async () => {
    await expect(getWeddingOverview("workspace_1")).resolves.toMatchObject({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    const transactionClient = transaction.mock.calls[0][0]
      ? expect.any(Object)
      : undefined;
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "read",
      transactionClient,
    );
    for (const query of [
      guestFindMany,
      tableFindMany,
      taskFindMany,
      budgetFindMany,
          staffCount,
      timelineCount,
      membershipCount,
    ]) {
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: "workspace_1" } }),
      );
      expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
        query.mock.invocationCallOrder[0],
      );
    }

    const guestSelect = guestFindMany.mock.calls[0][0].select;
    expect(guestSelect).not.toHaveProperty("name");
    expect(guestSelect.importRecords.select).toEqual({
      relationshipLabel: true,
      source: true,
      sourceInstance: true,
      sourceManaged: true,
      childSeatCount: true,
      vegetarianCount: true,
      invitationDelivery: true,
    });
    expect(guestSelect.importRecords.select).not.toHaveProperty("externalId");
    expect(guestSelect.importRecords.select).not.toHaveProperty("contactPhone");
    expect(guestSelect.importRecords.select).not.toHaveProperty("contactEmail");
    expect(guestSelect.importRecords.select).not.toHaveProperty("mailingAddress");
    expect(guestSelect.weddingGift.select).toEqual({ amount: true });
    expect(budgetFindMany.mock.calls[0][0].select).toMatchObject({
      preparationStatus: true,
      dueDate: true,
    });
  });

  it("excludes gift-exempt guests from missing-record counts while preserving actual gifts", async () => {
    const base = { category: "GUEST", side: "SHARED", attendanceStatus: "DECLINED", partySize: 1, seatingTableId: null, importRecords: [], weddingGift: null };
    guestFindMany.mockResolvedValue([
      { ...base, giftExemptWithCake: true },
      { ...base, importRecords: [{ source: "MANUAL", sourceInstance: "guest-details", sourceManaged: false, relationshipLabel: "父親" }] },
      { ...base },
      { ...base, giftExemptWithCake: true, weddingGift: { amount: 1200 } },
    ]);
    const data = await getWeddingOverview("workspace_1");
    expect(data.guests.gifts).toEqual({ recordedCount: 1, unrecordedGeneralGroupCount: 1, totalAmount: "1200" });
  });

  it("returns precise guest, seating, task, budget, and operations summaries", async () => {
    guestFindMany.mockResolvedValue([
      {
        category: "GUEST",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: 2,
        seatingTableId: "table_1",
        importRecords: [
          {
            source: "LINEIN",
            sourceInstance: "default",
            sourceManaged: true,
            childSeatCount: 1,
            vegetarianCount: 0,
            invitationDelivery: "PAPER",
          },
        ],
        weddingGift: { amount: 1200 },
      },
      {
        category: "GUEST",
        side: "PARTNER_B",
        attendanceStatus: "ATTENDING",
        partySize: 3,
        seatingTableId: null,
        importRecords: [
          {
            source: "LINEIN",
            sourceInstance: "default",
            sourceManaged: true,
            childSeatCount: 2,
            vegetarianCount: 1,
            invitationDelivery: "PAPER",
          },
          {
            source: "MANUAL",
            sourceInstance: "guest-details",
            sourceManaged: false,
            childSeatCount: 1,
            vegetarianCount: 2,
            invitationDelivery: "DIGITAL",
          },
        ],
        weddingGift: null,
      },
      {
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "DECLINED",
        partySize: 1,
        seatingTableId: null,
        importRecords: [
          {
            source: "MANUAL",
            sourceInstance: "guest-details",
            sourceManaged: false,
            childSeatCount: null,
            vegetarianCount: null,
            invitationDelivery: "NONE",
          },
        ],
        weddingGift: { amount: 3600 },
      },
      {
        category: "GUEST",
        side: "PARTNER_A",
        attendanceStatus: "UNDECIDED",
        partySize: 1,
        seatingTableId: null,
        importRecords: [
          {
            source: "LINEIN",
            sourceInstance: "default",
            sourceManaged: true,
            childSeatCount: 1,
            vegetarianCount: 1,
            invitationDelivery: "PAPER",
          },
          {
            source: "MANUAL",
            sourceInstance: "guest-details",
            sourceManaged: false,
            childSeatCount: null,
            vegetarianCount: null,
            invitationDelivery: "UNKNOWN",
          },
        ],
        weddingGift: null,
      },
      {
        category: "COUPLE",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: 2,
        seatingTableId: "table_1",
        importRecords: [],
        weddingGift: { amount: 6600 },
      },
      {
        category: "FAMILY",
        side: "PARTNER_B",
        attendanceStatus: "ATTENDING",
        partySize: 4,
        seatingTableId: "table_2",
        importRecords: [
          {
            source: "MANUAL",
            sourceInstance: "guest-details",
            sourceManaged: false,
            childSeatCount: 1,
            vegetarianCount: 1,
            invitationDelivery: null,
          },
        ],
        weddingGift: null,
      },
    ]);
    tableFindMany.mockResolvedValue([{ capacity: 10 }, { capacity: 8 }]);
    taskFindMany.mockResolvedValue([
      { status: "TODO", dueDate: new Date("2026-08-28T00:00:00.000Z") },
      {
        status: "IN_PROGRESS",
        dueDate: new Date("2026-08-30T00:00:00.000Z"),
      },
      { status: "DONE", dueDate: new Date("2026-08-01T00:00:00.000Z") },
    ]);
    budgetFindMany.mockResolvedValue([
      {
        kind: "GROUP",
        plannedAmount: 0,
        actualAmount: null,
        balanceAmount: null,
        bookingStatus: "PLANNING",
        preparationStatus: "NEEDS_ACTION",
        dueDate: null,
        paid: false,
      },
      {
        kind: "EXPENSE",
        plannedAmount: 100,
        actualAmount: null,
        balanceAmount: null,
        bookingStatus: "PLANNING",
        preparationStatus: "NEEDS_ACTION",
        dueDate: null,
        paid: false,
      },
      {
        kind: "EXPENSE",
        plannedAmount: 200,
        actualAmount: 100,
        balanceAmount: 100,
        bookingStatus: "BOOKED_BALANCE_DUE",
        preparationStatus: "NEEDS_ACTION",
        dueDate: new Date("2026-08-28T00:00:00.000Z"),
        paid: false,
      },
      {
        kind: "EXPENSE",
        plannedAmount: 300,
        actualAmount: 300,
        balanceAmount: 0,
        bookingStatus: "PAID",
        preparationStatus: "NEEDS_ACTION",
        dueDate: null,
        paid: true,
      },
      {
        kind: "EXPENSE",
        plannedAmount: 800,
        actualAmount: 800,
        balanceAmount: 0,
        bookingStatus: "PAID",
        preparationStatus: "ALREADY_OWNED",
        dueDate: null,
        paid: true,
      },
      {
        kind: "EXPENSE",
        plannedAmount: 900,
        actualAmount: 90,
        balanceAmount: 810,
        bookingStatus: "BOOKED_BALANCE_DUE",
        preparationStatus: "NOT_PLANNED",
        dueDate: new Date("2026-08-01T00:00:00.000Z"),
        paid: false,
      },
    ]);
    staffCount.mockResolvedValue(4);
    timelineCount.mockResolvedValue(6);
    membershipCount.mockResolvedValue(3);

    const data = await getWeddingOverview(
      "workspace_1",
      new Date("2026-08-29T04:00:00.000Z"),
    );

    expect(data.guests).toEqual({
      generalGroupTotal: 4,
      respondedGroupTotal: 3,
      attendingGroupTotal: 2,
      declinedGroupTotal: 1,
      undecidedGroupTotal: 1,
      attendingHeadcount: 11,
      assignedAttendingHeadcount: 8,
      unassignedAttendingHeadcount: 3,
      childSeatCount: 3,
      vegetarianCount: 3,
      bySide: {
        PARTNER_A: {
          groupTotal: 2,
          attendingGroupTotal: 1,
          attendingHeadcount: 2,
        },
        PARTNER_B: {
          groupTotal: 1,
          attendingGroupTotal: 1,
          attendingHeadcount: 3,
        },
        SHARED: {
          groupTotal: 1,
          attendingGroupTotal: 0,
          attendingHeadcount: 0,
        },
      },
      invitations: { PAPER: 1, DIGITAL: 1, NONE: 1, UNKNOWN: 1, UNSET: 2 },
      gifts: {
        recordedCount: 3,
        unrecordedGeneralGroupCount: 2,
        totalAmount: "11400",
      },
    });
    expect(data.seating).toEqual({
      tableTotal: 2,
      capacityTotal: 18,
      assignedHeadcount: 8,
      remainingCapacity: 7,
    });
    expect(data.tasks).toEqual({
      total: 3,
      todo: 1,
      inProgress: 1,
      done: 1,
      overdue: 1,
    });
    expect(data.budget).toEqual({
      itemCount: 3,
      planningCount: 1,
      balanceDueCount: 1,
      overdueBalanceDueCount: 1,
      paidCount: 1,
      plannedTotal: "600",
      actualTotal: "400",
      balanceDueTotal: "100",
      selfProvidedCount: 1,
      notPlannedCount: 1,
    });
    expect(data.operations).toEqual({
      staffTotal: 4,
      timelineItemTotal: 6,
      memberTotal: 3,
    });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("includes confirmed guests awaiting assignment in the capacity delta", async () => {
    guestFindMany.mockResolvedValue([
      {
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: 12,
        seatingTableId: null,
        importRecords: [],
        weddingGift: null,
      },
    ]);
    tableFindMany.mockResolvedValue([{ capacity: 10 }]);

    const data = await getWeddingOverview("workspace_1");

    expect(data.seating).toEqual({
      tableTotal: 1,
      capacityTotal: 10,
      assignedHeadcount: 0,
      remainingCapacity: -2,
    });
  });

  it("preserves outsider denial and sanitizes snapshot failures", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      getWeddingOverview("workspace_secret"),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    guestFindMany.mockRejectedValueOnce(new Error("postgres://secret"));
    await expect(getWeddingOverview("workspace_1")).rejects.toEqual(
      new WeddingOverviewDataError("目前無法載入婚宴總覽，請稍後再試。"),
    );
  });
});
