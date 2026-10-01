import "server-only";

import {
  budgetRemainingBalance,
  type NormalizedBudgetPayment,
} from "@/domain/budget-payment";
import type { BudgetBookingStatus } from "@/domain/budget-item";

type CountResult = { count: number };

/** 網站與手機共用：只需要付款與花費兩張表的最小交易介面。 */
export type BudgetPaymentTransaction = {
  budgetItem: {
    findFirst(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<CountResult>;
  };
  budgetPayment: {
    create(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<CountResult>;
    updateMany(args: unknown): Promise<CountResult>;
    aggregate(args: unknown): Promise<{ _sum: { amount: number | null } }>;
  };
};

export const MAX_PAID_TOTAL = 2_147_483_647;

export class BudgetPaymentOverflowError extends Error {
  constructor() {
    super("Budget payment total overflow.");
    this.name = "BudgetPaymentOverflowError";
  }
}

/** 尾款待付時，實付＝訂金＋已分批付款；兩者都沒有就維持未記錄。 */
export function bookedActualAmount(
  depositAmount: number | null,
  paidAmount: number,
): number | null {
  if (depositAmount === null && paidAmount === 0) return null;
  return Math.min((depositAmount ?? 0) + paidAmount, MAX_PAID_TOTAL);
}

export async function paidAmountOf(
  transaction: BudgetPaymentTransaction,
  workspaceId: string,
  itemId: string,
): Promise<number> {
  const result = await transaction.budgetPayment.aggregate({
    where: { workspaceId, budgetItemId: itemId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

type PaymentTargetItem = {
  bookingStatus: BudgetBookingStatus;
  plannedAmount: number;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
};

const paymentTargetSelect = {
  bookingStatus: true,
  plannedAmount: true,
  depositAmount: true,
  balanceAmount: true,
  additionalAmount: true,
};

/**
 * 付款筆數改變後重算這個項目：尾款（含加購）付清就自動轉成已付款；
 * 刪掉付款後又不夠了，就退回尾款待付，避免帳面顯示已付清卻還欠錢。
 */
async function settleBudgetItemAfterPayments(
  transaction: BudgetPaymentTransaction,
  workspaceId: string,
  itemId: string,
  expectedVersion: number,
  item: PaymentTargetItem,
  paidAmount: number,
  allowRevert: boolean,
): Promise<CountResult> {
  const remaining = budgetRemainingBalance({ ...item, paidAmount });
  const where = { id: itemId, workspaceId, version: expectedVersion };
  if (
    item.bookingStatus === "BOOKED_BALANCE_DUE" &&
    remaining !== null &&
    remaining === BigInt(0)
  ) {
    return transaction.budgetItem.updateMany({
      where,
      data: {
        bookingStatus: "PAID",
        paid: true,
        paidAt: new Date(),
        actualAmount: item.plannedAmount,
        version: { increment: 1 },
      },
    });
  }
  if (
    allowRevert &&
    item.bookingStatus === "PAID" &&
    remaining !== null &&
    remaining > BigInt(0)
  ) {
    return transaction.budgetItem.updateMany({
      where,
      data: {
        bookingStatus: "BOOKED_BALANCE_DUE",
        paid: false,
        paidAt: null,
        actualAmount: bookedActualAmount(item.depositAmount, paidAmount),
        version: { increment: 1 },
      },
    });
  }
  return transaction.budgetItem.updateMany({
    where,
    data: {
      ...(item.bookingStatus === "BOOKED_BALANCE_DUE"
        ? { actualAmount: bookedActualAmount(item.depositAmount, paidAmount) }
        : {}),
      version: { increment: 1 },
    },
  });
}

type PaymentTarget = {
  workspaceId: string;
  itemId: string;
  expectedVersion: number;
};

/**
 * 呼叫端必須已在同一個 Serializable transaction 內鎖定並確認 editor Membership。
 * 回傳 count 0 表示版本過期或項目已不能記付款。
 */
export async function addBudgetPaymentInTransaction(
  transaction: BudgetPaymentTransaction,
  target: PaymentTarget & { currentUserId: string; payment: NormalizedBudgetPayment },
): Promise<CountResult> {
  const { workspaceId, itemId, expectedVersion } = target;
  const item = (await transaction.budgetItem.findFirst({
    where: {
      id: itemId,
      workspaceId,
      version: expectedVersion,
      kind: "EXPENSE",
      preparationStatus: "NEEDS_ACTION",
      bookingStatus: "BOOKED_BALANCE_DUE",
    },
    select: paymentTargetSelect,
  })) as PaymentTargetItem | null;
  if (item === null) return { count: 0 };
  const paidBefore = await paidAmountOf(transaction, workspaceId, itemId);
  if (paidBefore + target.payment.amount > MAX_PAID_TOTAL) {
    throw new BudgetPaymentOverflowError();
  }
  await transaction.budgetPayment.create({
    data: {
      ...target.payment,
      workspaceId,
      budgetItemId: itemId,
      createdByUserId: target.currentUserId,
    },
  });
  return settleBudgetItemAfterPayments(
    transaction,
    workspaceId,
    itemId,
    expectedVersion,
    item,
    paidBefore + target.payment.amount,
    false,
  );
}

/** 同上，呼叫端負責鎖定與 Membership；付款不屬於這個項目就當作過期。 */
export async function deleteBudgetPaymentInTransaction(
  transaction: BudgetPaymentTransaction,
  target: PaymentTarget & { paymentId: string },
): Promise<CountResult> {
  const { workspaceId, itemId, expectedVersion } = target;
  const item = (await transaction.budgetItem.findFirst({
    where: { id: itemId, workspaceId, version: expectedVersion, kind: "EXPENSE" },
    select: paymentTargetSelect,
  })) as PaymentTargetItem | null;
  if (item === null) return { count: 0 };
  const removed = await transaction.budgetPayment.deleteMany({
    where: { id: target.paymentId, workspaceId, budgetItemId: itemId },
  });
  if (removed.count !== 1) return { count: 0 };
  return settleBudgetItemAfterPayments(
    transaction,
    workspaceId,
    itemId,
    expectedVersion,
    item,
    await paidAmountOf(transaction, workspaceId, itemId),
    true,
  );
}

/**
 * 改一筆既有付款（金額、日期、方式、備註）；同上由呼叫端負責鎖定與 Membership。
 * 改完重算實付，金額改多付清就轉已付款、改少不夠就退回尾款待付。
 */
export async function updateBudgetPaymentInTransaction(
  transaction: BudgetPaymentTransaction,
  target: PaymentTarget & { paymentId: string; payment: NormalizedBudgetPayment },
): Promise<CountResult> {
  const { workspaceId, itemId, expectedVersion } = target;
  const item = (await transaction.budgetItem.findFirst({
    where: { id: itemId, workspaceId, version: expectedVersion, kind: "EXPENSE" },
    select: paymentTargetSelect,
  })) as PaymentTargetItem | null;
  if (item === null) return { count: 0 };
  const updated = await transaction.budgetPayment.updateMany({
    where: { id: target.paymentId, workspaceId, budgetItemId: itemId },
    data: target.payment,
  });
  if (updated.count !== 1) return { count: 0 };
  const paidAmount = await paidAmountOf(transaction, workspaceId, itemId);
  if (paidAmount > MAX_PAID_TOTAL) throw new BudgetPaymentOverflowError();
  return settleBudgetItemAfterPayments(
    transaction,
    workspaceId,
    itemId,
    expectedVersion,
    item,
    paidAmount,
    true,
  );
}
