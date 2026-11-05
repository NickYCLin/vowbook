import { describe, expect, it } from "vitest";
import { normalizeProductFeedback } from "./product-feedback";

function form() {
  const data = new FormData();
  data.set("requestId", "00000000-0000-4000-8000-000000000001");
  data.set("section", "timeline");
  data.set("category", "suggestion");
  data.set("message", "希望可以調整流程的呈現順序。");
  return data;
}

describe("意見回饋輸入契約", () => {
  it("只接受固定功能與類型，不收網址、身分或婚宴內容快照", () => {
    const data = form();
    data.set("userId", "untrusted");
    data.set("url", "https://invalid.example/#private");
    expect(normalizeProductFeedback(data)).toEqual({
      requestId: "00000000-0000-4000-8000-000000000001", section: "timeline",
      category: "suggestion", message: "希望可以調整流程的呈現順序。", contact: null,
    });
  });
  it.each([
    ["section", "private/path"], ["category", "unknown"], ["message", "  "],
    ["contact", "不是電子郵件"], ["requestId", "invalid"],
  ])("拒絕無效欄位 %s", (field, value) => {
    const data = form();
    data.set(field, value);
    expect(() => normalizeProductFeedback(data)).toThrow();
  });
  it.each(["讚", "字".repeat(5000)])("接受簡短或長篇想法，分類與功能可不填", (message) => {
    const data = form();
    data.delete("section");
    data.set("category", "");
    data.set("message", message);
    expect(normalizeProductFeedback(data)).toMatchObject({ section: "general", category: "other", message, contact: null });
  });
});
