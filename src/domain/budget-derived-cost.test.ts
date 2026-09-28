import { describe, expect, it } from "vitest";
import {
  budgetDerivedCosts,
  normalizeWeddingMealPricing,
  WeddingMealPricingError,
} from "./budget-derived-cost";

const base = {
  staffMealUnitPrice: 200,
  vegetarianMealUnitPrice: 1999,
  serviceChargePercent: 10,
  staffMealCount: 12,
  vegetarianGuestCount: 8,
  pendingRedEnvelopeAmount: 6000,
};

describe("derived wedding costs", () => {
  it("prices meals from the live counts and adds the service charge", () => {
    const costs = budgetDerivedCosts(base);
    expect(costs.map((cost) => [cost.name, cost.amount])).toEqual([
      ["工作人員便當", 2640],
      ["素食套餐", 17591],
      ["工作人員紅包", 6000],
    ]);
    expect(costs[0].detail).toBe("12 份 × NT$200 ＋ 服務費 10%");
    expect(costs[1].detail).toBe("8 位 × NT$1,999 ＋ 服務費 10%");
  });

  it("only the red envelope is money still owed on the day", () => {
    expect(
      budgetDerivedCosts(base).map((cost) => cost.countsTowardBalanceDue),
    ).toEqual([false, false, true]);
  });

  it("skips a line when the unit price is unset or nobody needs it", () => {
    expect(
      budgetDerivedCosts({
        ...base,
        staffMealUnitPrice: null,
        vegetarianGuestCount: 0,
        pendingRedEnvelopeAmount: 0,
      }),
    ).toEqual([]);
  });

  it("leaves the subtotal alone when no service charge applies", () => {
    const [meal] = budgetDerivedCosts({
      ...base,
      serviceChargePercent: 0,
      vegetarianMealUnitPrice: null,
      pendingRedEnvelopeAmount: 0,
    });
    expect(meal.amount).toBe(2400);
    expect(meal.detail).toBe("12 份 × NT$200");
  });
});

describe("meal pricing input", () => {
  it("keeps a blank price as unset instead of turning it into free", () => {
    expect(
      normalizeWeddingMealPricing({
        staffMealUnitPrice: "",
        vegetarianMealUnitPrice: "1999",
        serviceChargePercent: "10",
      }),
    ).toEqual({
      staffMealUnitPrice: null,
      vegetarianMealUnitPrice: 1999,
      serviceChargePercent: 10,
    });
  });

  it("rejects prices and percentages that are not plain whole numbers", () => {
    for (const bad of ["-1", "12.5", "abc", " 1 2 "]) {
      expect(() =>
        normalizeWeddingMealPricing({
          staffMealUnitPrice: bad,
          vegetarianMealUnitPrice: "",
          serviceChargePercent: "0",
        }),
      ).toThrow(WeddingMealPricingError);
    }
    expect(() =>
      normalizeWeddingMealPricing({
        staffMealUnitPrice: "200",
        vegetarianMealUnitPrice: "",
        serviceChargePercent: "101",
      }),
    ).toThrow(WeddingMealPricingError);
  });
});
