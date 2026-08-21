import { describe, expect, it } from "vitest";
import {
  formatWeddingTimelineMinute,
  normalizeWeddingTimelineDetails,
  normalizeWeddingTimelineStaffIds,
  parseWeddingTimelineTime,
  WeddingTimelineValidationError,
} from "./wedding-timeline";

describe("wedding timeline domain", () => {
  it("converts HH:mm and minutes deterministically", () => {
    expect(parseWeddingTimelineTime("00:00", "開始時間")).toBe(0);
    expect(parseWeddingTimelineTime("12:05", "開始時間")).toBe(725);
    expect(parseWeddingTimelineTime("23:59", "開始時間")).toBe(1439);
    expect(formatWeddingTimelineMinute(725)).toBe("12:05");
  });

  it("normalizes optional copy and requires end after start", () => {
    expect(
      normalizeWeddingTimelineDetails({
        startTime: "11:30",
        endTime: "  ",
        phase: "  迎賓  ",
        title: "  賓客入場  ",
        location: "  宴會廳外  ",
        details: "  引導賓客\n依序入場  ",
        mediaCue: "  01 迎賓音樂\n02 開場影片  ",
        notes: "  留意長輩座位  ",
      }),
    ).toEqual({
      startMinute: 690,
      endMinute: null,
      phase: "迎賓",
      title: "賓客入場",
      location: "宴會廳外",
      details: "引導賓客\n依序入場",
      mediaCue: "01 迎賓音樂\n02 開場影片",
      notes: "留意長輩座位",
    });

    expect(() =>
      normalizeWeddingTimelineDetails({
        startTime: "12:00",
        endTime: "12:00",
        phase: "午宴",
        title: "開席",
        location: "",
        details: "",
        mediaCue: "",
        notes: "",
      }),
    ).toThrow("結束時間必須晚於開始時間");
  });

  it("accepts 500 media cue characters and rejects 501 while preserving internal newlines", () => {
    const normalized = normalizeWeddingTimelineDetails({
      startTime: "12:00",
      endTime: "12:20",
      phase: "進場",
      title: "第一次進場",
      location: "",
      details: "",
      mediaCue: `  ${"樂".repeat(498)}\n燈  `,
      notes: "",
    });
    expect(Array.from(normalized.mediaCue ?? "")).toHaveLength(500);
    expect(normalized.mediaCue).toMatch(/\n/u);

    expect(() =>
      normalizeWeddingTimelineDetails({
        startTime: "12:00",
        endTime: "12:20",
        phase: "進場",
        title: "第一次進場",
        location: "",
        details: "",
        mediaCue: "樂".repeat(501),
        notes: "",
      }),
    ).toThrow("音樂／影片最多 500 個字元");

    expect(
      normalizeWeddingTimelineDetails({
        startTime: "12:00",
        endTime: "12:20",
        phase: "進場",
        title: "第一次進場",
        location: "",
        details: "",
        mediaCue: "\t\n",
        notes: "",
      }).mediaCue,
    ).toBeNull();
  });

  it("deduplicates bounded staff IDs and rejects malformed times", () => {
    expect(
      normalizeWeddingTimelineStaffIds(["staff_2", "staff_1", "staff_2"]),
    ).toEqual(["staff_2", "staff_1"]);
    expect(() => parseWeddingTimelineTime("24:00", "開始時間")).toThrow(
      WeddingTimelineValidationError,
    );
    expect(() => normalizeWeddingTimelineStaffIds([""])).toThrow(
      WeddingTimelineValidationError,
    );
  });
});
