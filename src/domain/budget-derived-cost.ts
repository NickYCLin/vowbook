/**
 * 便當、素食套餐與紅包的數量本來就散在工作人員與賓客名單裡，跟著出席狀況一直在變。
 * 與其讓人手動抄一筆金額進花費頁、改天就過期，不如存單價、數量現算。
 */
export type BudgetDerivedCostKey =
  | "STAFF_MEAL"
  | "VEGETARIAN_MEAL"
  | "STAFF_RED_ENVELOPE";

export type BudgetDerivedCost = {
  key: BudgetDerivedCostKey;
  name: string;
  /** 給人看的算式，例如「12 份 × NT$200 ＋ 服務費 10%」。 */
  detail: string;
  quantity: number;
  amount: number;
  /** 還沒付出去的部分要一起進尾款。 */
  countsTowardBalanceDue: boolean;
};

export type BudgetDerivedCostInput = {
  staffMealUnitPrice: number | null;
  vegetarianMealUnitPrice: number | null;
  serviceChargePercent: number;
  staffMealCount: number;
  vegetarianGuestCount: number;
  pendingRedEnvelopeAmount: number;
};

function withServiceCharge(subtotal: number, percent: number): number {
  if (percent <= 0) return subtotal;
  return Math.round((subtotal * (100 + percent)) / 100);
}

function chargeSuffix(percent: number): string {
  return percent > 0 ? ` ＋ 服務費 ${percent}%` : "";
}

function twd(amount: number): string {
  return `NT$${amount.toLocaleString("en-US")}`;
}

/**
 * 單價沒設定就不生出那一列：寧可讓人發現漏填，也不要顯示一個沒有依據的 0。
 * 數量為 0 時同樣不列，名單還沒建立前不需要占版面。
 */
export function budgetDerivedCosts(
  input: BudgetDerivedCostInput,
): BudgetDerivedCost[] {
  const percent =
    Number.isInteger(input.serviceChargePercent) &&
    input.serviceChargePercent > 0
      ? input.serviceChargePercent
      : 0;
  const costs: BudgetDerivedCost[] = [];

  if (input.staffMealUnitPrice !== null && input.staffMealCount > 0) {
    const subtotal = input.staffMealUnitPrice * input.staffMealCount;
    costs.push({
      key: "STAFF_MEAL",
      name: "工作人員便當",
      detail: `${input.staffMealCount} 份 × ${twd(input.staffMealUnitPrice)}${chargeSuffix(percent)}`,
      quantity: input.staffMealCount,
      amount: withServiceCharge(subtotal, percent),
      countsTowardBalanceDue: false,
    });
  }

  if (
    input.vegetarianMealUnitPrice !== null &&
    input.vegetarianGuestCount > 0
  ) {
    const subtotal = input.vegetarianMealUnitPrice * input.vegetarianGuestCount;
    costs.push({
      key: "VEGETARIAN_MEAL",
      name: "素食套餐",
      detail: `${input.vegetarianGuestCount} 位 × ${twd(input.vegetarianMealUnitPrice)}${chargeSuffix(percent)}`,
      quantity: input.vegetarianGuestCount,
      amount: withServiceCharge(subtotal, percent),
      countsTowardBalanceDue: false,
    });
  }

  if (input.pendingRedEnvelopeAmount > 0) {
    costs.push({
      key: "STAFF_RED_ENVELOPE",
      name: "工作人員紅包",
      detail: "依工作人員名單已設定、尚未發放的金額合計",
      quantity: 0,
      amount: input.pendingRedEnvelopeAmount,
      countsTowardBalanceDue: true,
    });
  }

  return costs;
}

export type WeddingMealPricing = {
  staffMealUnitPrice: number | null;
  vegetarianMealUnitPrice: number | null;
  serviceChargePercent: number;
};

export class WeddingMealPricingError extends Error {
  constructor(message = "餐費設定無效，請確認後再試。") {
    super(message);
    this.name = "WeddingMealPricingError";
  }
}

/** 留白代表還沒談定價格，跟「免費」不是同一件事，所以保留 null 而不是補 0。 */
function optionalPrice(value: unknown, label: string): number | null {
  if (typeof value !== "string") throw new WeddingMealPricingError();
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,9}$/u.test(trimmed)) {
    throw new WeddingMealPricingError(`請輸入有效的${label}。`);
  }
  const amount = Number(trimmed);
  if (!Number.isInteger(amount) || amount < 0 || amount > 2_147_483_647) {
    throw new WeddingMealPricingError(`請輸入有效的${label}。`);
  }
  return amount;
}

export function normalizeWeddingMealPricing(input: {
  staffMealUnitPrice: unknown;
  vegetarianMealUnitPrice: unknown;
  serviceChargePercent: unknown;
}): WeddingMealPricing {
  const percentRaw =
    typeof input.serviceChargePercent === "string"
      ? input.serviceChargePercent.trim()
      : null;
  if (percentRaw === null || !/^\d{1,3}$/u.test(percentRaw || "0")) {
    throw new WeddingMealPricingError("請輸入 0 到 100 之間的服務費百分比。");
  }
  const percent = percentRaw === "" ? 0 : Number(percentRaw);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new WeddingMealPricingError("請輸入 0 到 100 之間的服務費百分比。");
  }
  return {
    staffMealUnitPrice: optionalPrice(input.staffMealUnitPrice, "便當單價"),
    vegetarianMealUnitPrice: optionalPrice(
      input.vegetarianMealUnitPrice,
      "素食套餐單價",
    ),
    serviceChargePercent: percent,
  };
}
