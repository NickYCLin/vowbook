import {
  BUDGET_BALANCE_PAYMENT_METHOD_LABELS,
  BudgetItemValidationError,
  type BudgetBalancePaymentMethod,
} from "@/domain/budget-item";

const MAX_TWD_AMOUNT = 2_147_483_647;
const MAX_NOTES_LENGTH = 200;

export type BudgetPaymentInput = {
  amount?: unknown;
  paidOn?: unknown;
  method?: unknown;
  notes?: unknown;
};

export type NormalizedBudgetPayment = {
  amount: number;
  paidOn: Date;
  method: BudgetBalancePaymentMethod | null;
  notes: string | null;
};

export type BudgetPaymentRecord = {
  id: string;
  amount: number;
  paidOn: string;
  method: BudgetBalancePaymentMethod | null;
  notes: string | null;
};

function isValidCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function normalizeBudgetPayment(
  input: BudgetPaymentInput,
): NormalizedBudgetPayment {
  const rawAmount =
    typeof input.amount === "string" ? input.amount.trim().replaceAll(",", "") : "";
  if (!/^[1-9]\d*$/u.test(rawAmount) || Number(rawAmount) > MAX_TWD_AMOUNT) {
    throw new BudgetItemValidationError("付款金額請輸入大於 0 的整數。");
  }

  const paidOn = typeof input.paidOn === "string" ? input.paidOn.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(paidOn) || !isValidCalendarDate(paidOn)) {
    throw new BudgetItemValidationError("請輸入有效的付款日期。");
  }

  let method: BudgetBalancePaymentMethod | null = null;
  if (input.method !== undefined && input.method !== null && input.method !== "") {
    if (
      typeof input.method !== "string" ||
      !Object.hasOwn(BUDGET_BALANCE_PAYMENT_METHOD_LABELS, input.method)
    ) {
      throw new BudgetItemValidationError("請選擇有效的付款方式。");
    }
    method = (input.method === "RED_ENVELOPE"
      ? "CASH"
      : input.method) as BudgetBalancePaymentMethod;
  }

  let notes: string | null = null;
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== "string") {
      throw new BudgetItemValidationError("付款備註格式無效。");
    }
    const trimmed = input.notes.trim();
    if ([...trimmed].length > MAX_NOTES_LENGTH) {
      throw new BudgetItemValidationError(
        `付款備註最多 ${MAX_NOTES_LENGTH} 個字元。`,
      );
    }
    notes = trimmed === "" ? null : trimmed;
  }

  return {
    amount: Number(rawAmount),
    paidOn: new Date(`${paidOn}T00:00:00.000Z`),
    method,
    notes,
  };
}

export type BudgetBalanceAmounts = {
  balanceAmount: number | null;
  additionalAmount: number | null;
  paidAmount?: number;
};

/** 尾款連同加購一起算；已分批付掉的扣掉之後才是還要準備的錢。 */
export function budgetBalanceTotal(item: BudgetBalanceAmounts): bigint | null {
  if (item.balanceAmount === null && item.additionalAmount === null) {
    return null;
  }
  return BigInt(item.balanceAmount ?? 0) + BigInt(item.additionalAmount ?? 0);
}

export function budgetRemainingBalance(
  item: BudgetBalanceAmounts,
): bigint | null {
  const total = budgetBalanceTotal(item);
  if (total === null) return null;
  const remaining = total - BigInt(item.paidAmount ?? 0);
  return remaining > BigInt(0) ? remaining : BigInt(0);
}
