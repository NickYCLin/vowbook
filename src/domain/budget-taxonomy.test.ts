import { describe, expect, it } from "vitest";
import {
  BUDGET_COST_CATEGORY_LABELS,
  BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES,
  BUDGET_TAXONOMY_ITEM_KEYS,
  BUDGET_TAXONOMY_ITEM_LABELS,
  BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
  BUDGET_SYSTEM_NODES,
  BUDGET_TAXONOMY_NODE_BY_KEY,
  BUDGET_TAXONOMY_NODES,
  BUDGET_TAXONOMY_STAGES,
  SELECTABLE_BUDGET_COST_CATEGORIES,
  BudgetItemValidationError,
  isBudgetTaxonomyItemKey,
  normalizeBudgetCostCategory,
  normalizeBudgetItemDetails,
  normalizeOptionalBudgetTaxonomyItemKey,
  normalizeRelatedBudgetTaxonomyItemKey,
  normalizeBudgetTaxonomyItemKey,
} from "./budget-item";

describe("budget cost taxonomy", () => {
  it("keeps all eight internal cost categories", () => {
    expect(BUDGET_COST_CATEGORY_LABELS).toEqual({
      RINGS_KEEPSAKES: "戒指與信物",
      PHOTOGRAPHY_VIDEO: "攝影與影像",
      ATTIRE_STYLING: "服裝與造型",
      VENUE_CATERING: "場地與餐飲",
      TRANSPORT_LODGING: "交通與住宿",
      DECOR_GIFTS: "佈置與禮品",
      PEOPLE_SERVICES: "人員與服務",
      OTHER_PENDING: "其他／待整理",
    });
    expect(SELECTABLE_BUDGET_COST_CATEGORIES).toEqual([
      "RINGS_KEEPSAKES",
      "PHOTOGRAPHY_VIDEO",
      "ATTIRE_STYLING",
      "VENUE_CATERING",
      "TRANSPORT_LODGING",
      "DECOR_GIFTS",
      "PEOPLE_SERVICES",
    ]);
  });

  it.each([
    "RINGS_KEEPSAKES",
    "PHOTOGRAPHY_VIDEO",
    "ATTIRE_STYLING",
    "VENUE_CATERING",
    "TRANSPORT_LODGING",
    "DECOR_GIFTS",
    "PEOPLE_SERVICES",
    "OTHER_PENDING",
  ] as const)("normalizes the exact enum value %s", (category) => {
    expect(normalizeBudgetCostCategory(category)).toBe(category);
  });

  it.each(["", "場地與餐飲", "VENUE", null, 123])(
    "rejects a non-enum fee category with fee-category copy: %j",
    (category) => {
      expect(() => normalizeBudgetCostCategory(category)).toThrow(
        new BudgetItemValidationError("請選擇有效的費用類別。"),
      );
    },
  );

  it("returns a typed fee category from normalized expense details", () => {
    expect(
      normalizeBudgetItemDetails({
        name: "婚宴場地",
        category: "VENUE_CATERING",
        plannedAmount: "120000",
        actualAmount: "",
        dueDate: "",
        notes: "",
      }),
    ).toMatchObject({ category: "VENUE_CATERING" });
  });
});

describe("fixed budget taxonomy", () => {
  it("keeps only the Drive spreadsheet six ordered stages and 20 ordered items", () => {
    expect(BUDGET_TAXONOMY_STAGES.map((stage) => stage.key)).toEqual([
      "STAGE_PREPARATION_1_2_MONTHS",
      "STAGE_PREPARATION_3_MONTH",
      "STAGE_PREPARATION_4_MONTH",
      "STAGE_COUNTDOWN_2_MONTHS",
      "STAGE_ENGAGEMENT_CEREMONY",
      "STAGE_WEDDING_PROCESSION",
    ]);
    expect(BUDGET_TAXONOMY_STAGES.map((stage) => stage.label)).toEqual([
      "籌備第1-2月",
      "籌備第3個月",
      "籌備婚禮第4個月",
      "婚禮前倒數2個月",
      "文定儀式用品、工作人員紅包",
      "迎娶儀式用品、工作人員紅包",
    ]);
    expect(BUDGET_TAXONOMY_STAGES.map((stage) => stage.items.length)).toEqual([
      3, 7, 3, 3, 2, 2,
    ]);
    expect(BUDGET_TAXONOMY_ITEM_KEYS).toHaveLength(20);
    expect(
      BUDGET_TAXONOMY_STAGES.flatMap<string>((stage) =>
        stage.items.map((item) => item.label),
      ),
    ).toEqual([
      "求婚",
      "婚宴場地",
      "婚紗照拍攝",
      "喜餅",
      "新娘秘書",
      "婚禮攝影",
      "婚禮錄影",
      "婚禮主持",
      "婚禮樂團",
      "婚禮互動",
      "禮服租借",
      "婚鞋",
      "婚禮佈置",
      "印喜帖及寄送",
      "保養療程",
      "婚禮小物",
      "文定儀式（男方準備）",
      "文定儀式（女方準備）",
      "迎娶儀式男方準備",
      "迎娶儀式女方準備",
    ]);
    expect(BUDGET_TAXONOMY_ITEM_KEYS.slice(0, 4)).toEqual([
      "ITEM_PROPOSAL",
      "ITEM_WEDDING_VENUE",
      "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      "ITEM_WEDDING_CAKES",
    ]);
    expect(BUDGET_TAXONOMY_ITEM_KEYS.slice(-2)).toEqual([
      "ITEM_PROCESSION_GROOM",
      "ITEM_PROCESSION_BRIDE",
    ]);
    expect(BUDGET_TAXONOMY_ITEM_LABELS.ITEM_PROCESSION_GROOM).toBe(
      "迎娶儀式男方準備",
    );
    expect(BUDGET_TAXONOMY_ITEM_LABELS.ITEM_PROCESSION_BRIDE).toBe(
      "迎娶儀式女方準備",
    );
  });

  it("keeps internal unclassified storage outside the selectable Drive taxonomy", () => {
    expect(BUDGET_TAXONOMY_NODES).toHaveLength(26);
    expect(BUDGET_SYSTEM_NODES).toHaveLength(28);
    expect(BUDGET_TAXONOMY_NODES.map((node) => node.key)).not.toContain(
      BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
    );
    expect(BUDGET_TAXONOMY_NODES.map((node) => node.key)).not.toContain(
      BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
    );
    expect(BUDGET_TAXONOMY_ITEM_KEYS).not.toContain(
      BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
    );
    expect(BUDGET_SYSTEM_NODES.slice(-2)).toEqual([
      expect.objectContaining({
        key: BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
        kind: "STAGE",
        parentKey: null,
      }),
      expect.objectContaining({
        key: BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
        kind: "ITEM",
        parentKey: BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
        defaultCategory: "OTHER_PENDING",
      }),
    ]);
  });

  it("provides one flat public lookup without conflating cost categories", () => {
    expect(BUDGET_TAXONOMY_NODE_BY_KEY.ITEM_WEDDING_VENUE).toEqual({
      key: "ITEM_WEDDING_VENUE",
      label: "婚宴場地",
      kind: "ITEM",
      parentKey: "STAGE_PREPARATION_1_2_MONTHS",
      sourceOrder: 2,
      defaultCategory: "VENUE_CATERING",
    });
    expect(BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES).toMatchObject({
      ITEM_PROPOSAL: "RINGS_KEEPSAKES",
      ITEM_WEDDING_VENUE: "VENUE_CATERING",
    });
  });

  it("accepts only public Drive item keys at the write boundary", () => {
    expect(isBudgetTaxonomyItemKey("ITEM_WEDDING_VENUE")).toBe(true);
    expect(isBudgetTaxonomyItemKey("STAGE_PREPARATION_1_2_MONTHS")).toBe(false);
    expect(isBudgetTaxonomyItemKey("婚宴場地")).toBe(false);
    expect(isBudgetTaxonomyItemKey(BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY)).toBe(false);
    expect(() =>
      normalizeBudgetTaxonomyItemKey(BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY),
    ).toThrow(BudgetItemValidationError);
    expect(() => normalizeBudgetTaxonomyItemKey("ITEM_UNKNOWN")).toThrow(
      BudgetItemValidationError,
    );
  });

  it("normalizes an optional purpose relation to one public Drive item key", () => {
    expect(normalizeOptionalBudgetTaxonomyItemKey(undefined)).toBeNull();
    expect(normalizeOptionalBudgetTaxonomyItemKey(null)).toBeNull();
    expect(normalizeOptionalBudgetTaxonomyItemKey("")).toBeNull();
    expect(
      normalizeOptionalBudgetTaxonomyItemKey(
        "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      ),
    ).toBe("ITEM_PRE_WEDDING_PHOTOGRAPHY");

    expect(() =>
      normalizeOptionalBudgetTaxonomyItemKey(
        "STAGE_PREPARATION_1_2_MONTHS",
      ),
    ).toThrow(new BudgetItemValidationError("請選擇有效的用途關聯。"));
    expect(() =>
      normalizeOptionalBudgetTaxonomyItemKey(
        BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
      ),
    ).toThrow(new BudgetItemValidationError("請選擇有效的用途關聯。"));
    expect(() =>
      normalizeOptionalBudgetTaxonomyItemKey("ITEM_UNKNOWN"),
    ).toThrow(new BudgetItemValidationError("請選擇有效的用途關聯。"));
  });

  it("rejects a purpose relation that duplicates the primary Drive item", () => {
    expect(
      normalizeRelatedBudgetTaxonomyItemKey(
        "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        "ITEM_ATTIRE_RENTAL",
      ),
    ).toBe("ITEM_PRE_WEDDING_PHOTOGRAPHY");
    expect(
      normalizeRelatedBudgetTaxonomyItemKey("", "ITEM_ATTIRE_RENTAL"),
    ).toBeNull();

    expect(() =>
      normalizeRelatedBudgetTaxonomyItemKey(
        "ITEM_ATTIRE_RENTAL",
        "ITEM_ATTIRE_RENTAL",
      ),
    ).toThrow(
      new BudgetItemValidationError("用途關聯不可與主要分類相同。"),
    );
  });
});
