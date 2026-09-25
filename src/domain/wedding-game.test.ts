import { describe, expect, it } from "vitest";
import {
  normalizeWeddingGameName,
  normalizeWeddingGameNames,
  normalizeWeddingGameNote,
  parseWeddingGame,
  WeddingGameValidationError,
} from "./wedding-game";

describe("wedding game domain", () => {
  it("accepts only the two known games", () => {
    expect(parseWeddingGame("BOUQUET")).toBe("BOUQUET");
    expect(parseWeddingGame("BROCCOLI")).toBe("BROCCOLI");
    expect(() => parseWeddingGame("bouquet")).toThrow(WeddingGameValidationError);
    expect(() => parseWeddingGame(null)).toThrow(WeddingGameValidationError);
  });

  it("splits pasted names on common separators and drops duplicates", () => {
    expect(normalizeWeddingGameNames(" 小美、阿華，小美\n Amy  Chen ,, ")).toEqual([
      "小美",
      "阿華",
      "Amy Chen",
    ]);
  });

  it("rejects empty, overlong and oversized lists", () => {
    expect(() => normalizeWeddingGameNames(" 、 \n ")).toThrow("請輸入至少一位姓名。");
    expect(() => normalizeWeddingGameName("名".repeat(61))).toThrow(
      "姓名需為 1 到 60 個字元。",
    );
    const many = Array.from({ length: 41 }, (_, index) => `賓客${index}`).join("、");
    expect(() => normalizeWeddingGameNames(many)).toThrow("每個遊戲最多 40 位。");
  });

  it("keeps notes optional and bounded", () => {
    expect(normalizeWeddingGameNote("   ")).toBeNull();
    expect(normalizeWeddingGameNote(" 大學室友 ")).toBe("大學室友");
    expect(() => normalizeWeddingGameNote("字".repeat(201))).toThrow(
      "備註最多 200 個字元。",
    );
  });
});
