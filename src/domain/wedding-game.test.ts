import { describe, expect, it } from "vitest";
import {
  normalizeWeddingGameName,
  normalizeWeddingGameEntries,
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
      "介紹詞最多 200 個字元。",
    );
  });

  it("reads 姓名：介紹詞 lines and still splits plain names", () => {
    expect(
      normalizeWeddingGameEntries("王大明：大學同學\n李小華: 也是同學\n小美、阿華\n王大明"),
    ).toEqual([
      { name: "王大明", note: "大學同學" },
      { name: "李小華", note: "也是同學" },
      { name: "小美", note: null },
      { name: "阿華", note: null },
    ]);
    expect(() => normalizeWeddingGameEntries("：沒有名字")).toThrow("姓名需為 1 到 60 個字元。");
  });
});
