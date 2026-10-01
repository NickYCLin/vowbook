import { describe, expect, it } from "vitest";
import {
  PACKING_SIDE_LABELS,
  PackingItemValidationError,
  normalizePackingItemTitle,
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
});
