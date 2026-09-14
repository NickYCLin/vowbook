import { describe, expect, it } from "vitest";
import {
  MAX_WEDDING_STAFF_MEAL_COUNT,
  MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT,
  normalizeWeddingStaffDetails,
  summarizeWeddingStaffMeals,
  summarizeWeddingStaffRedEnvelopes,
  WeddingStaffValidationError,
} from "./wedding-staff";

describe("wedding staff domain", () => {
  it("normalizes outer whitespace while preserving notes line breaks", () => {
    expect(
      normalizeWeddingStaffDetails({
        roleName: "  婚禮主持  ",
        personName: "  林小美  ",
        contactPhone: "  0912 345 678  ",
        notes: "  第一段\n  第二段  ",
      }),
    ).toEqual({
      roleName: "婚禮主持",
      personName: "林小美",
      contactPhone: "0912 345 678",
      notes: "第一段\n  第二段",
      mealCount: null,
      vegetarianMealCount: null,
      redEnvelopeAmount: null,
    });
  });

  it.each([
    [{ roleName: "", personName: "人", contactPhone: "", notes: "" }, "職務"],
    [
      {
        roleName: "職務",
        personName: "人".repeat(121),
        contactPhone: "",
        notes: "",
      },
      "姓名",
    ],
    [
      {
        roleName: "職務",
        personName: "人",
        contactPhone: "0".repeat(41),
        notes: "",
      },
      "電話",
    ],
    [
      {
        roleName: "職務",
        personName: "人",
        contactPhone: "",
        notes: "備".repeat(501),
      },
      "備註",
    ],
  ])("rejects bounded invalid staff fields", (input, message) => {
    expect(() => normalizeWeddingStaffDetails(input)).toThrow(
      WeddingStaffValidationError,
    );
    expect(() => normalizeWeddingStaffDetails(input)).toThrow(message);
  });
});

describe("wedding staff meal requirements", () => {
  const baseInput = {
    roleName: "攝影",
    personName: "星河影像",
    contactPhone: null,
    notes: null,
  };

  it("leaves both meal fields empty when no meal is needed", () => {
    expect(normalizeWeddingStaffDetails(baseInput)).toMatchObject({
      mealCount: null,
      vegetarianMealCount: null,
    });
    expect(
      normalizeWeddingStaffDetails({
        ...baseInput,
        needsMeal: "",
        mealCount: "4",
        vegetarianMealCount: "2",
      }),
    ).toMatchObject({ mealCount: null, vegetarianMealCount: null });
  });

  it("defaults an individual to one non-vegetarian meal", () => {
    expect(
      normalizeWeddingStaffDetails({ ...baseInput, needsMeal: "on" }),
    ).toMatchObject({ mealCount: 1, vegetarianMealCount: 0 });
  });

  it("keeps a vendor head count with its vegetarian share", () => {
    expect(
      normalizeWeddingStaffDetails({
        ...baseInput,
        needsMeal: "on",
        mealCount: " 6 ",
        vegetarianMealCount: "2",
      }),
    ).toMatchObject({ mealCount: 6, vegetarianMealCount: 2 });
  });

  it("rejects a vegetarian share larger than the meal count", () => {
    expect(() =>
      normalizeWeddingStaffDetails({
        ...baseInput,
        needsMeal: "on",
        mealCount: "2",
        vegetarianMealCount: "3",
      }),
    ).toThrow("素食份數不能超過便當份數。");
  });

  it.each(["0", "-1", "1.5", "100", "", " ", "一", "1e2"])(
    "rejects the invalid meal count %j",
    (mealCount) => {
      expect(() =>
        normalizeWeddingStaffDetails({
          ...baseInput,
          needsMeal: "on",
          mealCount,
        }),
      ).toThrow(WeddingStaffValidationError);
    },
  );

  it.each(["-1", "1.5", "100", " ", "一"])(
    "rejects the invalid vegetarian count %j",
    (vegetarianMealCount) => {
      expect(() =>
        normalizeWeddingStaffDetails({
          ...baseInput,
          needsMeal: "on",
          mealCount: "6",
          vegetarianMealCount,
        }),
      ).toThrow(WeddingStaffValidationError);
    },
  );

  it("accepts the maximum meal count and an all-vegetarian team", () => {
    expect(
      normalizeWeddingStaffDetails({
        ...baseInput,
        needsMeal: "on",
        mealCount: String(MAX_WEDDING_STAFF_MEAL_COUNT),
        vegetarianMealCount: String(MAX_WEDDING_STAFF_MEAL_COUNT),
      }),
    ).toMatchObject({
      mealCount: MAX_WEDDING_STAFF_MEAL_COUNT,
      vegetarianMealCount: MAX_WEDDING_STAFF_MEAL_COUNT,
    });
  });
});

describe("summarizeWeddingStaffMeals", () => {
  it("counts only entries that need a meal and derives the non-vegetarian share", () => {
    expect(
      summarizeWeddingStaffMeals([
        { mealCount: 6, vegetarianMealCount: 2 },
        { mealCount: 1, vegetarianMealCount: 0 },
        { mealCount: null, vegetarianMealCount: null },
        { mealCount: 3, vegetarianMealCount: 3 },
      ]),
    ).toEqual({
      entryCount: 3,
      mealCount: 10,
      vegetarianMealCount: 5,
      nonVegetarianMealCount: 5,
    });
  });

  it("returns an all-zero summary when nobody needs a meal", () => {
    expect(
      summarizeWeddingStaffMeals([{ mealCount: null, vegetarianMealCount: null }]),
    ).toEqual({
      entryCount: 0,
      mealCount: 0,
      vegetarianMealCount: 0,
      nonVegetarianMealCount: 0,
    });
    expect(summarizeWeddingStaffMeals([])).toEqual({
      entryCount: 0,
      mealCount: 0,
      vegetarianMealCount: 0,
      nonVegetarianMealCount: 0,
    });
  });
});

describe("wedding staff red envelopes", () => {
  const baseInput = {
    roleName: "總招待",
    personName: "小安",
    contactPhone: null,
    notes: null,
  };

  it("treats an empty amount as no red envelope", () => {
    for (const redEnvelopeAmount of [undefined, null, ""]) {
      expect(
        normalizeWeddingStaffDetails({ ...baseInput, redEnvelopeAmount }),
      ).toMatchObject({ redEnvelopeAmount: null });
    }
  });

  it("keeps a positive integer amount", () => {
    expect(
      normalizeWeddingStaffDetails({ ...baseInput, redEnvelopeAmount: " 3600 " }),
    ).toMatchObject({ redEnvelopeAmount: 3600 });
    expect(
      normalizeWeddingStaffDetails({
        ...baseInput,
        redEnvelopeAmount: String(MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT),
      }),
    ).toMatchObject({
      redEnvelopeAmount: MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT,
    });
  });

  it.each(["0", "-1", "1.5", "01", "１", "1e2", " ", "三千"])(
    "rejects the invalid amount %j",
    (redEnvelopeAmount) => {
      expect(() =>
        normalizeWeddingStaffDetails({ ...baseInput, redEnvelopeAmount }),
      ).toThrow(WeddingStaffValidationError);
    },
  );

  it("rejects an amount beyond the PostgreSQL integer bound", () => {
    expect(() =>
      normalizeWeddingStaffDetails({
        ...baseInput,
        redEnvelopeAmount: String(MAX_WEDDING_STAFF_RED_ENVELOPE_AMOUNT + 1),
      }),
    ).toThrow(WeddingStaffValidationError);
  });
});

describe("summarizeWeddingStaffRedEnvelopes", () => {
  it("separates what is planned from what has actually been handed out", () => {
    expect(
      summarizeWeddingStaffRedEnvelopes([
        { redEnvelopeAmount: 3600, redEnvelopeSentAt: new Date() },
        { redEnvelopeAmount: 2000, redEnvelopeSentAt: null },
        { redEnvelopeAmount: 1200, redEnvelopeSentAt: null },
        { redEnvelopeAmount: null, redEnvelopeSentAt: null },
      ]),
    ).toEqual({
      plannedCount: 3,
      plannedAmount: 6800,
      sentCount: 1,
      sentAmount: 3600,
      pendingCount: 2,
      pendingAmount: 3200,
    });
  });

  it("returns an all-zero summary when nobody gets a red envelope", () => {
    expect(
      summarizeWeddingStaffRedEnvelopes([
        { redEnvelopeAmount: null, redEnvelopeSentAt: null },
      ]),
    ).toEqual({
      plannedCount: 0,
      plannedAmount: 0,
      sentCount: 0,
      sentAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
    });
    expect(summarizeWeddingStaffRedEnvelopes([])).toMatchObject({
      plannedCount: 0,
      plannedAmount: 0,
    });
  });
});
