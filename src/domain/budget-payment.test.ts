import { describe, expect, it } from "vitest";
import { BudgetItemValidationError } from "@/domain/budget-item";
import {
  budgetBalanceTotal,
  budgetRemainingBalance,
  normalizeBudgetPayment,
} from "./budget-payment";

describe("normalizeBudgetPayment", () => {
  it("接受分批付款的金額、日期、方式與備註", () => {
    expect(
      normalizeBudgetPayment({
        amount: " 100,000 ",
        paidOn: "2026-10-01",
        method: "BANK_TRANSFER",
        notes: "  第一筆  ",
      }),
    ).toEqual({
      amount: 100000,
      paidOn: new Date("2026-10-01T00:00:00.000Z"),
      method: "BANK_TRANSFER",
      notes: "第一筆",
    });
  });

  it("舊的紅包付款方式轉成現金紅包，空白方式與備註存成 null", () => {
    expect(
      normalizeBudgetPayment({
        amount: "1",
        paidOn: "2026-10-01",
        method: "RED_ENVELOPE",
        notes: "   ",
      }),
    ).toMatchObject({ method: "CASH", notes: null });
    expect(
      normalizeBudgetPayment({ amount: "1", paidOn: "2026-10-01", method: "" }),
    ).toMatchObject({ method: null, notes: null });
  });

  it.each([
    [{ amount: "0", paidOn: "2026-10-01" }, "付款金額請輸入大於 0 的整數。"],
    [{ amount: "-5", paidOn: "2026-10-01" }, "付款金額請輸入大於 0 的整數。"],
    [{ amount: "1.5", paidOn: "2026-10-01" }, "付款金額請輸入大於 0 的整數。"],
    [{ amount: "2147483648", paidOn: "2026-10-01" }, "付款金額請輸入大於 0 的整數。"],
    [{ amount: "10", paidOn: "2026-02-30" }, "請輸入有效的付款日期。"],
    [{ amount: "10", paidOn: "" }, "請輸入有效的付款日期。"],
    [{ amount: "10", paidOn: "2026-10-01", method: "CHEQUE" }, "請選擇有效的付款方式。"],
    [{ amount: "10", paidOn: "2026-10-01", notes: "字".repeat(201) }, "付款備註最多 200 個字元。"],
  ])("拒絕無效輸入 %#", (input, message) => {
    expect(() => normalizeBudgetPayment(input)).toThrow(
      new BudgetItemValidationError(message),
    );
  });
});

describe("budgetRemainingBalance", () => {
  it("尾款包含加購，再扣掉已分批付款", () => {
    const item = { balanceAmount: 300000, additionalAmount: 20000, paidAmount: 150000 };
    expect(budgetBalanceTotal(item)).toBe(BigInt(320000));
    expect(budgetRemainingBalance(item)).toBe(BigInt(170000));
  });

  it("付超過時剩餘為 0；金額都沒填時未知", () => {
    expect(
      budgetRemainingBalance({ balanceAmount: 100, additionalAmount: null, paidAmount: 150 }),
    ).toBe(BigInt(0));
    expect(
      budgetRemainingBalance({ balanceAmount: null, additionalAmount: null, paidAmount: 50 }),
    ).toBeNull();
  });
});
