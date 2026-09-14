import "server-only";

import { Prisma, type WeddingWorkspace } from "@prisma/client";
import { effectiveGuestDetailValue } from "@/domain/guest-detail-value";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

type GuestSideValue = "PARTNER_A" | "PARTNER_B" | "SHARED";
type InvitationDeliveryValue = "PAPER" | "DIGITAL" | "NONE" | "UNKNOWN";
type InvitationSummaryValue = InvitationDeliveryValue | "UNSET";

type OverviewGuestImportRecord = {
  source: string;
  sourceInstance: string;
  sourceManaged: boolean;
  childSeatCount: number | null;
  vegetarianCount: number | null;
  invitationDelivery: InvitationDeliveryValue | null;
};

type OverviewGuestRecord = {
  category: "GUEST" | "COUPLE" | "FAMILY";
  side: GuestSideValue;
  attendanceStatus: "UNDECIDED" | "ATTENDING" | "DECLINED";
  partySize: number;
  seatingTableId: string | null;
  importRecords: OverviewGuestImportRecord[];
  weddingGift: { amount: number } | null;
};

type OverviewTableRecord = { capacity: number };
type OverviewTaskRecord = {
  status: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate: Date | null;
};
type OverviewBudgetRecord = {
  kind: "GROUP" | "EXPENSE";
  plannedAmount: number;
  actualAmount: number | null;
  balanceAmount: number | null;
  dueDate: Date | null;
  bookingStatus: "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID";
  preparationStatus: "NEEDS_ACTION" | "ALREADY_OWNED" | "NOT_PLANNED";
  paid: boolean;
};
type OverviewWorkspace = Pick<
  WeddingWorkspace,
  "id" | "name" | "weddingDate" | "timezone"
>;

type OverviewTransaction = {
  membership: {
    findUnique(args: unknown): Promise<{
      role: string;
      workspace: OverviewWorkspace;
    } | null>;
    count(args: unknown): Promise<number>;
  };
  guest: { findMany(args: unknown): Promise<OverviewGuestRecord[]> };
  seatingTable: { findMany(args: unknown): Promise<OverviewTableRecord[]> };
  weddingTask: { findMany(args: unknown): Promise<OverviewTaskRecord[]> };
  budgetItem: { findMany(args: unknown): Promise<OverviewBudgetRecord[]> };
  weddingStaffAssignment: { count(args: unknown): Promise<number> };
  weddingTimelineItem: { count(args: unknown): Promise<number> };
};

type OverviewPrismaClient = {
  $transaction<T>(
    callback: (transaction: OverviewTransaction) => Promise<T>,
    options: { isolationLevel: string },
  ): Promise<T>;
};

type SideSummary = {
  groupTotal: number;
  attendingGroupTotal: number;
  attendingHeadcount: number;
};

export type WeddingOverviewData = {
  role: "OWNER" | "PARTNER" | "PLANNER" | "VIEWER";
  workspace: Pick<WeddingWorkspace, "id" | "name">;
  guests: {
    generalGroupTotal: number;
    respondedGroupTotal: number;
    attendingGroupTotal: number;
    declinedGroupTotal: number;
    undecidedGroupTotal: number;
    attendingHeadcount: number;
    assignedAttendingHeadcount: number;
    unassignedAttendingHeadcount: number;
    childSeatCount: number;
    vegetarianCount: number;
    bySide: Record<GuestSideValue, SideSummary>;
    invitations: Record<InvitationSummaryValue, number>;
    gifts: {
      recordedCount: number;
      unrecordedGeneralGroupCount: number;
      totalAmount: string;
    };
  };
  seating: {
    tableTotal: number;
    capacityTotal: number;
    assignedHeadcount: number;
    remainingCapacity: number;
  };
  tasks: {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
    overdue: number;
  };
  budget: {
    itemCount: number;
    planningCount: number;
    balanceDueCount: number;
    overdueBalanceDueCount: number;
    paidCount: number;
    plannedTotal: string;
    actualTotal: string;
    balanceDueTotal: string;
    selfProvidedCount: number;
    notPlannedCount: number;
  };
  operations: {
    staffTotal: number;
    timelineItemTotal: number;
    memberTotal: number;
  };
};

export class WeddingOverviewDataError extends Error {
  constructor(message = "目前無法載入婚宴總覽，請稍後再試。") {
    super(message);
    this.name = "WeddingOverviewDataError";
  }
}

const guestSelect = {
  category: true,
  side: true,
  attendanceStatus: true,
  partySize: true,
  seatingTableId: true,
  importRecords: {
    orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
    select: {
      source: true,
      sourceInstance: true,
      sourceManaged: true,
      childSeatCount: true,
      vegetarianCount: true,
      invitationDelivery: true,
    },
  },
  weddingGift: { select: { amount: true } },
} as const;

const emptySideSummary = (): SideSummary => ({
  groupTotal: 0,
  attendingGroupTotal: 0,
  attendingHeadcount: 0,
});

function checkedNonNegativeInteger(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new WeddingOverviewDataError();
  }
  return value;
}

function sumIntegers(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    total += checkedNonNegativeInteger(value);
    if (!Number.isSafeInteger(total)) throw new WeddingOverviewDataError();
  }
  return total;
}

function sumTwdAmounts(values: Iterable<number>): string {
  let total = BigInt(0);
  for (const value of values) {
    total += BigInt(checkedNonNegativeInteger(value));
  }
  return total.toString();
}

function dateKeyInTimezone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") =>
    parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new WeddingOverviewDataError();
  return `${year}-${month}-${day}`;
}

function summarizeGuests(guests: OverviewGuestRecord[]) {
  const bySide: Record<GuestSideValue, SideSummary> = {
    PARTNER_A: emptySideSummary(),
    PARTNER_B: emptySideSummary(),
    SHARED: emptySideSummary(),
  };
  const invitations: Record<InvitationSummaryValue, number> = {
    PAPER: 0,
    DIGITAL: 0,
    NONE: 0,
    UNKNOWN: 0,
    UNSET: 0,
  };
  let generalGroupTotal = 0;
  let respondedGroupTotal = 0;
  let attendingGroupTotal = 0;
  let declinedGroupTotal = 0;
  let undecidedGroupTotal = 0;
  let attendingHeadcount = 0;
  let assignedAttendingHeadcount = 0;
  let unassignedAttendingHeadcount = 0;
  let childSeatCount = 0;
  let vegetarianCount = 0;
  let recordedGiftCount = 0;
  let unrecordedGeneralGiftGroupCount = 0;
  const giftAmounts: number[] = [];

  for (const guest of guests) {
    if (guest.weddingGift) {
      recordedGiftCount += 1;
      giftAmounts.push(guest.weddingGift.amount);
    } else if (guest.category === "GUEST") {
      unrecordedGeneralGiftGroupCount += 1;
    }

    const partySize = checkedNonNegativeInteger(guest.partySize);
    const isAttending = guest.attendanceStatus === "ATTENDING";
    if (isAttending) {
      attendingHeadcount += partySize;
      if (guest.seatingTableId) assignedAttendingHeadcount += partySize;
      else unassignedAttendingHeadcount += partySize;
      childSeatCount +=
        effectiveGuestDetailValue(
          guest.importRecords,
          (record) => record.childSeatCount,
        ) ?? 0;
      vegetarianCount +=
        effectiveGuestDetailValue(
          guest.importRecords,
          (record) => record.vegetarianCount,
        ) ?? 0;
    }

    const delivery = effectiveGuestDetailValue(
      guest.importRecords,
      (record) => record.invitationDelivery,
    );
    invitations[delivery ?? "UNSET"] += 1;

    if (guest.category !== "GUEST") continue;
    generalGroupTotal += 1;
    bySide[guest.side].groupTotal += 1;
    if (isAttending) {
      attendingGroupTotal += 1;
      bySide[guest.side].attendingGroupTotal += 1;
      bySide[guest.side].attendingHeadcount += partySize;
    }
    if (guest.attendanceStatus === "UNDECIDED") undecidedGroupTotal += 1;
    else respondedGroupTotal += 1;
    if (guest.attendanceStatus === "DECLINED") declinedGroupTotal += 1;

  }

  return {
    generalGroupTotal,
    respondedGroupTotal,
    attendingGroupTotal,
    declinedGroupTotal,
    undecidedGroupTotal,
    attendingHeadcount,
    assignedAttendingHeadcount,
    unassignedAttendingHeadcount,
    childSeatCount,
    vegetarianCount,
    bySide,
    invitations,
    gifts: {
      recordedCount: recordedGiftCount,
      unrecordedGeneralGroupCount: unrecordedGeneralGiftGroupCount,
      totalAmount: sumTwdAmounts(giftAmounts),
    },
  };
}

function summarizeTasks(
  tasks: OverviewTaskRecord[],
  today: string,
): WeddingOverviewData["tasks"] {
  return {
    total: tasks.length,
    todo: tasks.filter((task) => task.status === "TODO").length,
    inProgress: tasks.filter((task) => task.status === "IN_PROGRESS").length,
    done: tasks.filter((task) => task.status === "DONE").length,
    overdue: tasks.filter(
      (task) =>
        task.status !== "DONE" &&
        task.dueDate !== null &&
        task.dueDate.toISOString().slice(0, 10) < today,
    ).length,
  };
}

function summarizeBudget(
  records: OverviewBudgetRecord[],
  today: string,
): WeddingOverviewData["budget"] {
  const expenses = records.filter((record) => record.kind === "EXPENSE");
  const trackedExpenses = expenses.filter(
    (record) => record.preparationStatus === "NEEDS_ACTION",
  );
  const balanceDue = trackedExpenses.filter(
    (record) => record.bookingStatus === "BOOKED_BALANCE_DUE",
  );
  return {
    itemCount: trackedExpenses.length,
    planningCount: trackedExpenses.filter(
      (record) => record.bookingStatus === "PLANNING",
    ).length,
    balanceDueCount: balanceDue.length,
    overdueBalanceDueCount: balanceDue.filter(
      (record) =>
        record.dueDate !== null &&
        record.dueDate.toISOString().slice(0, 10) < today,
    ).length,
    paidCount: trackedExpenses.filter((record) => record.paid).length,
    plannedTotal: sumTwdAmounts(
      trackedExpenses.map((record) => record.plannedAmount),
    ),
    actualTotal: sumTwdAmounts(
      trackedExpenses.flatMap((record) =>
        record.actualAmount === null ? [] : [record.actualAmount],
      ),
    ),
    balanceDueTotal: sumTwdAmounts(
      balanceDue.flatMap((record) =>
        record.balanceAmount === null ? [] : [record.balanceAmount],
      ),
    ),
    selfProvidedCount: expenses.filter(
      (record) => record.preparationStatus === "ALREADY_OWNED",
    ).length,
    notPlannedCount: expenses.filter(
      (record) => record.preparationStatus === "NOT_PLANNED",
    ).length,
  };
}

export async function getWeddingOverview(
  workspaceId: string,
  now = new Date(),
): Promise<WeddingOverviewData> {
  const currentUser = await requireCurrentUser();
  const overviewPrisma = prisma as unknown as OverviewPrismaClient;

  try {
    return await overviewPrisma.$transaction(
      async (transaction) => {
        const access = await requireWorkspaceAccess<
          OverviewWorkspace
        >(workspaceId, currentUser.id, "read", transaction);

        const [
          guests,
          tables,
          tasks,
          budgetItems,
          staffTotal,
          timelineItemTotal,
          memberTotal,
        ] = await Promise.all([
          transaction.guest.findMany({
            where: { workspaceId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: guestSelect,
          }),
          transaction.seatingTable.findMany({
            where: { workspaceId },
            orderBy: [{ position: "asc" }],
            select: { capacity: true },
          }),
          transaction.weddingTask.findMany({
            where: { workspaceId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { status: true, dueDate: true },
          }),
          transaction.budgetItem.findMany({
            where: { workspaceId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              kind: true,
              plannedAmount: true,
              actualAmount: true,
              balanceAmount: true,
              dueDate: true,
              bookingStatus: true,
              preparationStatus: true,
              paid: true,
            },
          }),
          transaction.weddingStaffAssignment.count({ where: { workspaceId } }),
          transaction.weddingTimelineItem.count({ where: { workspaceId } }),
          transaction.membership.count({ where: { workspaceId } }),
        ]);

        const guestSummary = summarizeGuests(guests);
        const capacityTotal = sumIntegers(
          tables.map((table) => table.capacity),
        );
        const assignedHeadcount = sumIntegers(
          guests
            .filter((guest) => guest.seatingTableId !== null)
            .map((guest) => guest.partySize),
        );
        const today = dateKeyInTimezone(now, access.workspace.timezone);

        return {
          role: access.role,
          workspace: {
            id: access.workspace.id,
            name: access.workspace.name,
          },
          guests: guestSummary,
          seating: {
            tableTotal: tables.length,
            capacityTotal,
            assignedHeadcount,
            // 已安排座位（包含尚未回覆者）會先占用容量；另外再納入所有
            // 已確認出席但尚未安排的人，才能及早顯示真正的容量缺口。
            remainingCapacity:
              capacityTotal -
              assignedHeadcount -
              guestSummary.unassignedAttendingHeadcount,
          },
          tasks: summarizeTasks(tasks, today),
          budget: summarizeBudget(budgetItems, today),
          operations: {
            staffTotal,
            timelineItemTotal,
            memberTotal,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) throw error;
    if (error instanceof WeddingOverviewDataError) throw error;
    throw new WeddingOverviewDataError();
  }
}
