import { describe, expect, it } from "vitest";
import {
  normalizeWeddingTaskDetails,
  normalizeWeddingTaskStatus,
  WeddingTaskValidationError,
} from "./wedding-task";

describe("wedding task domain contract", () => {
  it("normalizes title whitespace, optional description, and a strict date", () => {
    expect(
      normalizeWeddingTaskDetails({
        title: "  確認   婚宴流程  ",
        description: "  與主持人逐項確認\n流程  ",
        dueDate: "2028-02-29",
      }),
    ).toEqual({
      title: "確認 婚宴流程",
      description: "與主持人逐項確認\n流程",
      dueDate: new Date("2028-02-29T00:00:00.000Z"),
    });
  });

  it.each(["", "   ", "任".repeat(121)])(
    "rejects an invalid title",
    (title) => {
      expect(() =>
        normalizeWeddingTaskDetails({ title, description: "", dueDate: "" }),
      ).toThrow(WeddingTaskValidationError);
    },
  );

  it("counts Unicode code points instead of UTF-16 code units", () => {
    expect(
      normalizeWeddingTaskDetails({
        title: "囍".repeat(120),
        description: "🎉".repeat(1000),
        dueDate: "",
      }),
    ).toEqual({
      title: "囍".repeat(120),
      description: "🎉".repeat(1000),
      dueDate: null,
    });
  });

  it("turns blank descriptions into null and enforces 1000 characters", () => {
    expect(
      normalizeWeddingTaskDetails({
        title: "確認流程",
        description: " \n ",
        dueDate: "",
      }),
    ).toEqual({ title: "確認流程", description: null, dueDate: null });

    expect(() =>
      normalizeWeddingTaskDetails({
        title: "確認流程",
        description: "說".repeat(1001),
        dueDate: "",
      }),
    ).toThrow("任務說明最多 1000 個字元");
  });

  it.each([
    "0000-01-01",
    "2027-02-29",
    "2028-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-1-01",
    " 2026-01-01 ",
    "not-a-date",
  ])("rejects a rollover or non-strict date: %s", (dueDate) => {
    expect(() =>
      normalizeWeddingTaskDetails({
        title: "確認流程",
        description: "",
        dueDate,
      }),
    ).toThrow("請輸入有效的到期日");
  });

  it.each(["2000-02-29", "2028-02-29", "9999-12-31"])(
    "accepts a strict round-trippable date: %s",
    (dueDate) => {
      expect(
        normalizeWeddingTaskDetails({
          title: "確認流程",
          description: "",
          dueDate,
        }).dueDate,
      ).toEqual(new Date(`${dueDate}T00:00:00.000Z`));
    },
  );

  it("accepts every task status and rejects unknown values", () => {
    expect(normalizeWeddingTaskStatus("TODO")).toBe("TODO");
    expect(normalizeWeddingTaskStatus("IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(normalizeWeddingTaskStatus("DONE")).toBe("DONE");
    expect(() => normalizeWeddingTaskStatus("done")).toThrow(
      WeddingTaskValidationError,
    );
    expect(() => normalizeWeddingTaskStatus("ARCHIVED")).toThrow(
      WeddingTaskValidationError,
    );
  });
});
