import { describe, expect, it } from "vitest";
import {
  BUDGET_BOOKING_STATUS_LABELS,
  BUDGET_PRIMARY_CONTACT_LABELS,
  BudgetItemValidationError,
  formatTwdAmount,
  normalizeBudgetItemDetails,
  normalizeBudgetBookingStatus,
  normalizeBudgetGroupDetails,
  normalizeBudgetPrimaryContact,
} from "./budget-item";

function validDetails(overrides: Record<string, unknown> = {}) {
  return {
    name: "  婚宴   場地  ",
    category: "VENUE_CATERING",
    plannedAmount: "120000",
    actualAmount: "118000",
    dueDate: "2028-02-29",
    notes: "  含訂金與尾款\n分兩次支付  ",
    ...overrides,
  };
}

describe("budget item domain contract", () => {
  it("normalizes the only meaningful GROUP field without accepting expense metadata", () => {
    expect(
      normalizeBudgetGroupDetails({
        name: "  婚紗   方案  ",
        category: "VENUE_CATERING",
        plannedAmount: "999999",
        notes: "不可寫入群組",
      }),
    ).toEqual({ name: "婚紗 方案" });

    expect(
      normalizeBudgetGroupDetails({ name: "🎉".repeat(120) }),
    ).toEqual({ name: "🎉".repeat(120) });
    expect(() => normalizeBudgetGroupDetails({ name: " " })).toThrow(
      "群組名稱需為 1 到 120 個字元。",
    );
    expect(() =>
      normalizeBudgetGroupDetails({ name: "群".repeat(121) }),
    ).toThrow(BudgetItemValidationError);
  });

  it("normalizes text, whole-TWD amounts, optional fields, and a strict date", () => {
    expect(normalizeBudgetItemDetails(validDetails())).toEqual({
      name: "婚宴 場地",
      category: "VENUE_CATERING",
      plannedAmount: 120000,
      actualAmount: 118000,
      dueDate: new Date("2028-02-29T00:00:00.000Z"),
      notes: "含訂金與尾款\n分兩次支付",
      bookingStatus: "PLANNING",
      depositAmount: null,
      balanceAmount: null,
      additionalAmount: null,
      estimatedRange: null,
      candidateVendors: null,
      confirmedVendor: null,
      vendorContact: null,
      primaryContact: null,
    });

    expect(
      normalizeBudgetItemDetails(
        validDetails({ actualAmount: "", dueDate: "", notes: " \n " }),
      ),
    ).toMatchObject({ actualAmount: null, dueDate: null, notes: null });
  });

  it.each(["", "   ", "項".repeat(121), null, 123])(
    "rejects an invalid name: %j",
    (name) => {
      expect(() =>
        normalizeBudgetItemDetails(validDetails({ name })),
      ).toThrow(BudgetItemValidationError);
    },
  );

  it.each(["", "場地與餐飲", "VENUE", null, 123])(
    "rejects an invalid category: %j",
    (category) => {
      expect(() =>
        normalizeBudgetItemDetails(validDetails({ category })),
      ).toThrow(BudgetItemValidationError);
    },
  );

  it("counts Unicode code points for every bounded free-text field", () => {
    expect(
      normalizeBudgetItemDetails(
        validDetails({
          name: "🎉".repeat(120),
          notes: "💌".repeat(1000),
        }),
      ),
    ).toMatchObject({
      name: "🎉".repeat(120),
      category: "VENUE_CATERING",
      notes: "💌".repeat(1000),
    });

    expect(() =>
      normalizeBudgetItemDetails(
        validDetails({ notes: "💌".repeat(1001) }),
      ),
    ).toThrow("備註最多 1000 個字元");
  });

  it.each([
    "",
    " ",
    "00",
    "01",
    "+1",
    "-1",
    "1.0",
    "1e3",
    "NaN",
    "2147483648",
    null,
    100,
  ])("rejects a non-canonical planned amount: %j", (plannedAmount) => {
    expect(() =>
      normalizeBudgetItemDetails(validDetails({ plannedAmount })),
    ).toThrow(BudgetItemValidationError);
  });

  it("names planned amount errors with user-visible spending copy", () => {
    expect(() =>
      normalizeBudgetItemDetails(validDetails({ plannedAmount: "-1" })),
    ).toThrow("預計花費請輸入 0 到 2147483647 的整數。");
  });

  it.each([
    " ",
    "00",
    "01",
    "+1",
    "-1",
    "1.5",
    "1e3",
    "NaN",
    "2147483648",
    null,
    100,
  ])("rejects a non-canonical actual amount: %j", (actualAmount) => {
    expect(() =>
      normalizeBudgetItemDetails(validDetails({ actualAmount })),
    ).toThrow(BudgetItemValidationError);
  });

  it("accepts inclusive Int32 amount boundaries", () => {
    expect(
      normalizeBudgetItemDetails(
        validDetails({ plannedAmount: "0", actualAmount: "2147483647" }),
      ),
    ).toMatchObject({ plannedAmount: 0, actualAmount: 2147483647 });
  });

  it.each([
    "0000-01-01",
    "2027-02-29",
    "2028-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-1-01",
    " 2026-01-01 ",
    "not-a-date",
    20260101,
  ])("rejects a rollover or non-strict date: %j", (dueDate) => {
    expect(() =>
      normalizeBudgetItemDetails(validDetails({ dueDate })),
    ).toThrow("請輸入有效的付款期限");
  });

  it("formats whole TWD amounts with an explicit NT$ label", () => {
    expect(formatTwdAmount(0)).toBe("NT$0");
    expect(formatTwdAmount(BigInt(0))).toBe("NT$0");
    expect(formatTwdAmount(1234567)).toBe("NT$1,234,567");
    expect(formatTwdAmount("9007201398030335")).toBe(
      "NT$9,007,201,398,030,335",
    );
  });

  it("parses three booking states and maps budget owners to the couple", () => {
    expect(normalizeBudgetBookingStatus("PLANNING")).toBe("PLANNING");
    expect(normalizeBudgetBookingStatus("BOOKED_BALANCE_DUE")).toBe(
      "BOOKED_BALANCE_DUE",
    );
    expect(normalizeBudgetBookingStatus("PAID")).toBe("PAID");
    expect(BUDGET_BOOKING_STATUS_LABELS).toEqual({
      PLANNING: "規劃中",
      BOOKED_BALANCE_DUE: "已下訂，尾款未清",
      PAID: "已付清",
    });
    expect(normalizeBudgetPrimaryContact("")).toBeNull();
    expect(normalizeBudgetPrimaryContact("PARTNER_A")).toBe("PARTNER_A");
    expect(normalizeBudgetPrimaryContact("PARTNER_B")).toBe("PARTNER_B");
    expect(BUDGET_PRIMARY_CONTACT_LABELS).toEqual({
      PARTNER_A: "新郎",
      PARTNER_B: "新娘",
    });
    expect(() => normalizeBudgetBookingStatus("PAID-ish")).toThrow(
      BudgetItemValidationError,
    );
    expect(() => normalizeBudgetPrimaryContact("OWNER")).toThrow(
      BudgetItemValidationError,
    );
  });

  it("normalizes rich fields and derives planned amount from nullable components", () => {
    expect(
      normalizeBudgetItemDetails({
        ...validDetails({ plannedAmount: "999999" }),
        bookingStatus: "BOOKED_BALANCE_DUE",
        depositAmount: "12000",
        balanceAmount: "34000",
        additionalAmount: "500",
        estimatedRange: "  NT$40,000 ～ NT$60,000  ",
        candidateVendors:
          "  廠商 A｜報價 46,500｜優點：方案完整｜缺點：檔期較少\n廠商 B｜報價 42,000｜優點：價格較低｜缺點：成品較少  ",
        confirmedVendor: "  合成確認廠商  ",
        vendorContact: "  synthetic-contact@example.test  ",
        primaryContact: "PARTNER_A",
      }),
    ).toMatchObject({
      bookingStatus: "BOOKED_BALANCE_DUE",
      plannedAmount: 46500,
      depositAmount: 12000,
      balanceAmount: 34000,
      additionalAmount: 500,
      estimatedRange: "NT$40,000 ～ NT$60,000",
      candidateVendors:
        "廠商 A｜報價 46,500｜優點：方案完整｜缺點：檔期較少\n廠商 B｜報價 42,000｜優點：價格較低｜缺點：成品較少",
      confirmedVendor: "合成確認廠商",
      vendorContact: "synthetic-contact@example.test",
      primaryContact: "PARTNER_A",
    });
  });

  it("uses manual planned amount only when all three components are null", () => {
    expect(
      normalizeBudgetItemDetails({
        ...validDetails({ plannedAmount: "456" }),
        bookingStatus: "PLANNING",
        depositAmount: "",
        balanceAmount: "",
        additionalAmount: "",
        estimatedRange: "",
        candidateVendors: "",
        confirmedVendor: "",
        vendorContact: "",
        primaryContact: "",
      }),
    ).toMatchObject({ plannedAmount: 456 });

    expect(() =>
      normalizeBudgetItemDetails({
        ...validDetails(),
        depositAmount: "2147483647",
        balanceAmount: "1",
      }),
    ).toThrow("費用組成合計不可超過 2147483647");
  });

  it.each([
    ["depositAmount", "-1"],
    ["balanceAmount", "1.5"],
    ["additionalAmount", "2147483648"],
    ["estimatedRange", "估".repeat(201)],
    ["candidateVendors", "候".repeat(1001)],
    ["confirmedVendor", "廠".repeat(301)],
    ["vendorContact", "聯".repeat(501)],
  ])("rejects invalid rich field %s", (field, value) => {
    expect(() =>
      normalizeBudgetItemDetails({ ...validDetails(), [field]: value }),
    ).toThrow(BudgetItemValidationError);
  });
});
