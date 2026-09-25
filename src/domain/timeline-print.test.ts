import { describe, expect, it } from "vitest";
import { hostTimelinePrintData } from "./timeline-print";

describe("hostTimelinePrintData", () => {
  it("lists every item with time range, phase and cues", () => {
    const data = hostTimelinePrintData([
      {
        id: "a",
        startTime: "12:00",
        endTime: "12:10",
        phase: "第二次進場",
        title: "捧花遊戲",
        location: "舞台",
        details: "請未婚女性上台",
        mediaCue: "進場音樂",
        notes: null,
      },
      {
        id: "b",
        startTime: "12:30",
        endTime: null,
        phase: "送客",
        title: "新人送客",
        location: null,
        details: null,
        mediaCue: null,
        notes: "發喜糖",
      },
    ]);
    expect(data.summary).toBe("2 個流程段落");
    expect(data.rows[0].cells).toEqual([
      "12:00–12:10",
      "第二次進場\n捧花遊戲\n＠舞台",
      "進場音樂",
      "請未婚女性上台",
      "",
    ]);
    expect(data.rows[1].cells[0]).toBe("12:30");
    expect(data.rows[1].cells[4]).toBe("發喜糖");
  });
});
