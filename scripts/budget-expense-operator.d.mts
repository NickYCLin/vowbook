export type BudgetExpenseCategory =
  | "RINGS_KEEPSAKES"
  | "PHOTOGRAPHY_VIDEO"
  | "ATTIRE_STYLING"
  | "VENUE_CATERING"
  | "TRANSPORT_LODGING"
  | "DECOR_GIFTS"
  | "PEOPLE_SERVICES"
  | "OTHER_PENDING";

export type BudgetExpenseBookingStatus =
  | "PLANNING"
  | "BOOKED_BALANCE_DUE"
  | "PAID";

export type BudgetExpenseRow = {
  name: string;
  category: BudgetExpenseCategory;
  bookingStatus: BudgetExpenseBookingStatus;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  balancePaymentMethod: "CASH" | "TRANSFER" | "CARD" | "OTHER" | null;
  dueDate: Date | null;
  confirmedVendor: string | null;
  notes: string | null;
  plannedAmount: number;
  actualAmount: number | null;
  paid: boolean;
};

export type BudgetExpensePlan = {
  version: 1;
  expenses: BudgetExpenseRow[];
};

export type BudgetExpenseSummary = {
  mode: "dry-run" | "apply";
  applied: boolean;
  create: number;
  conflict: number;
  plannedTotal: number;
  balanceDueTotal: number;
};

export class BudgetExpenseValidationError extends Error {}
export class BudgetExpenseConflictError extends Error {}

export const BUDGET_EXPENSE_REPOSITORY_ROOT: string;

export function parseBudgetExpensePlanJson(json: string): BudgetExpensePlan;
export function parseBudgetExpenseCliArguments(argv: string[]): {
  workspaceId: string;
  confirmWorkspaceId: string;
  actorUserId: string;
  confirmActorUserId: string;
  planPath: string;
  apply: boolean;
};
export function appendBudgetExpenses(options: {
  client: unknown;
  workspaceId: string;
  actorUserId: string;
  plan: BudgetExpensePlan;
  apply?: boolean;
}): Promise<BudgetExpenseSummary>;
export function formatBudgetExpenseSummary(
  summary: BudgetExpenseSummary,
): string;
export function runBudgetExpenseCli(
  argv: string[],
  dependencies?: Record<string, unknown>,
): Promise<number>;
