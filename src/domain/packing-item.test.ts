import { describe, expect, it } from "vitest";
import {
  PACKING_SIDE_LABELS,
  PackingItemValidationError,
  normalizePackingCategory,
  normalizePackingItemTitle,
  normalizePackingNote,
  suggestPackingSupplies,
} from "./packing-item";

describe("packing item domain", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizePackingItemTitle("  西裝   外套 ")).toBe("西裝 外套");
  });

  it("rejects empty and overlong titles", () => {
    expect(() => normalizePackingItemTitle(" ")).toThrow(
      PackingItemValidationError,
    );
    expect(() => normalizePackingItemTitle("字".repeat(81))).toThrow(
      PackingItemValidationError,
    );
  });

  it("labels sides as groom, bride and shared", () => {
    expect(PACKING_SIDE_LABELS).toEqual({
      PARTNER_A: "新郎",
      PARTNER_B: "新娘",
      SHARED: "共用",
    });
  });

  it("defaults a missing category to personal and rejects unknown values", () => {
    expect(normalizePackingCategory(null)).toBe("PERSONAL");
    expect(normalizePackingCategory("WEDDING_SUPPLY")).toBe("WEDDING_SUPPLY");
    expect(() => normalizePackingCategory("OTHER")).toThrow(
      PackingItemValidationError,
    );
  });

  it("normalizes an optional note up to 60 characters", () => {
    expect(normalizePackingNote("   ")).toBeNull();
    expect(normalizePackingNote(null)).toBeNull();
    expect(normalizePackingNote(" 120 份  ")).toBe("120 份");
    expect(() => normalizePackingNote("字".repeat(61))).toThrow(
      PackingItemValidationError,
    );
  });

  it("suggests only wedding-favor expenses not already listed", () => {
    const suggestions = suggestPackingSupplies(
      [
        { id: "g1", parentId: null, name: "婚禮小物", kind: "GROUP", systemTaxonomyKey: "ITEM_WEDDING_FAVORS", relatedTaxonomyItemKey: null },
        { id: "e1", parentId: "g1", name: "位上禮 堅果", kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: null },
        { id: "e2", parentId: "g1", name: "捧花禮", kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: null },
        { id: "e3", parentId: "g1", name: "花椰菜遊戲禮", kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: null },
        { id: "e6", parentId: null, name: "拍拍印", kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: "ITEM_WEDDING_INTERACTION" },
        { id: "e7", parentId: null, name: "捧花", kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: "ITEM_WEDDING_DECOR" },
        { id: "e4", parentId: null, name: "婚宴場地", kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: "ITEM_VENUE" },
        { id: "e5", parentId: "g1", name: "位上禮 堅果", kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: null },
      ],
      ["捧花禮"],
    );
    expect(suggestions).toEqual(["位上禮 堅果", "花椰菜遊戲禮"]);
  });

  it("skips not-planned, vendor-provided and zero-amount placeholder expenses", () => {
    const base = { parentId: null, kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: "ITEM_WEDDING_FAVORS" };
    const suggestions = suggestPackingSupplies(
      [
        { ...base, id: "a", name: "位上禮 堅果", preparationStatus: "NEEDS_ACTION", plannedAmount: 3432, actualAmount: null },
        { ...base, id: "b", name: "迎賓禮", preparationStatus: "NEEDS_ACTION", plannedAmount: 0, actualAmount: null },
        { ...base, id: "c", name: "閨密禮", preparationStatus: "NOT_PLANNED", plannedAmount: 2000, actualAmount: null },
        { ...base, id: "d", name: "拍拍印", preparationStatus: "VENDOR_PROVIDED", plannedAmount: 8000, actualAmount: 8000 },
        { ...base, id: "e", name: "壓克力透明箱", preparationStatus: "ALREADY_OWNED", plannedAmount: 0, actualAmount: 450 },
      ],
      [],
    );
    expect(suggestions).toEqual(["位上禮 堅果", "壓克力透明箱"]);
  });

  it("skips melted favors and items already covered by bracketed or shorter list titles", () => {
    const base = { parentId: null, kind: "EXPENSE", systemTaxonomyKey: null, relatedTaxonomyItemKey: "ITEM_WEDDING_FAVORS" };
    const suggestions = suggestPackingSupplies(
      [
        { ...base, id: "a", name: "捧花禮" },
        { ...base, id: "b", name: "位上禮綜合果分享包" },
        { ...base, id: "c", name: "花椰菜遊戲禮" },
        { ...base, id: "d", name: "位上禮 M&M巧克力（運送融化）" },
        { ...base, id: "e", name: "迎賓糖果" },
      ],
      ["捧花禮 (SABON)", "位上禮（堅果）", "花椰菜禮 (蘋果汁)"],
    );
    expect(suggestions).toEqual(["迎賓糖果"]);
  });
});
