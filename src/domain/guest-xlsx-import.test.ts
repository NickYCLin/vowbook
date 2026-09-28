import { describe, expect, it } from "vitest";
import {
  GuestXlsxImportValidationError,
  normalizeGuestXlsxMapping,
  normalizeGuestXlsxRows,
  suggestGuestXlsxMapping,
} from "./guest-xlsx-import";

const headers = [
  "回覆識別碼",
  "賓客姓名",
  "與新人的關係",
  "是否出席",
  "出席人數（含本人）",
];

describe("guest XLSX import contract", () => {
  it("suggests the required LINEIN columns without inspecting row values", () => {
    expect(suggestGuestXlsxMapping(headers)).toEqual({
      externalId: 0,
      name: 1,
      side: 2,
      attendanceStatus: 3,
      partySize: 4,
    });
  });

  it("requires five unique in-range column mappings", () => {
    expect(
      normalizeGuestXlsxMapping(
        {
          externalId: 0,
          name: 1,
          side: 2,
          attendanceStatus: 3,
          partySize: 4,
        },
        headers.length,
      ),
    ).toEqual({
      externalId: 0,
      name: 1,
      side: 2,
      attendanceStatus: 3,
      partySize: 4,
    });

    expect(() =>
      normalizeGuestXlsxMapping(
        {
          externalId: 0,
          name: 0,
          side: 2,
          attendanceStatus: 3,
          partySize: 4,
        },
        headers.length,
      ),
    ).toThrow("每個必要欄位必須對應不同的 Excel 欄位");

    expect(() =>
      normalizeGuestXlsxMapping(
        {
          externalId: 0,
          name: 1,
          side: 2,
          attendanceStatus: 3,
          partySize: 99,
        },
        headers.length,
      ),
    ).toThrow("欄位對應已失效");
  });

  it("normalizes common Traditional Chinese survey answers", () => {
    const rows = normalizeGuestXlsxRows(
      [
        ["opaque-a", " 王小明 ", "男方親友", "會出席", "2 位"],
        ["opaque-b", "陳小美", "女方", "不克參加", 1],
        ["opaque-c", "共同朋友", "共同親友", "尚未確認", "3"],
      ],
      {
        externalId: 0,
        name: 1,
        side: 2,
        attendanceStatus: 3,
        partySize: 4,
      },
      2,
    );

    expect(rows).toEqual([
      {
        rowNumber: 2,
        externalId: "opaque-a",
        name: "王小明",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: 2,
      },
      {
        rowNumber: 3,
        externalId: "opaque-b",
        name: "陳小美",
        side: "PARTNER_B",
        attendanceStatus: "DECLINED",
        partySize: 1,
      },
      {
        rowNumber: 4,
        externalId: "opaque-c",
        name: "共同朋友",
        side: "SHARED",
        attendanceStatus: "UNDECIDED",
        partySize: 3,
      },
    ]);
  });

  it("rejects duplicate source IDs with a fixed row-scoped error and no PII echo", () => {
    const sentinel = "PII-SHOULD-NOT-BE-ECHOED";
    expect(() =>
      normalizeGuestXlsxRows(
        [
          [sentinel, "合成甲", "男方", "出席", 1],
          [sentinel, "合成乙", "女方", "出席", 1],
        ],
        {
          externalId: 0,
          name: 1,
          side: 2,
          attendanceStatus: 3,
          partySize: 4,
        },
        2,
      ),
    ).toThrow("第 3 列的來源識別碼與檔案內其他列重複");

    try {
      normalizeGuestXlsxRows(
        [[sentinel, "合成甲", "不明關係", "出席", 1]],
        {
          externalId: 0,
          name: 1,
          side: 2,
          attendanceStatus: 3,
          partySize: 4,
        },
        2,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(GuestXlsxImportValidationError);
      expect((error as Error).message).not.toContain(sentinel);
      expect((error as Error).message).toBe("第 2 列的關係無法辨識。");
    }
  });

  it("rejects unsafe numeric source IDs and out-of-range party sizes", () => {
    expect(() =>
      normalizeGuestXlsxRows(
        [[Number.MAX_SAFE_INTEGER + 1, "合成甲", "男方", "出席", 1]],
        {
          externalId: 0,
          name: 1,
          side: 2,
          attendanceStatus: 3,
          partySize: 4,
        },
        2,
      ),
    ).toThrow("來源識別碼必須是文字或安全整數");

    expect(() =>
      normalizeGuestXlsxRows(
        [["opaque-a", "合成甲", "男方", "出席", 21]],
        {
          externalId: 0,
          name: 1,
          side: 2,
          attendanceStatus: 3,
          partySize: 4,
        },
        2,
      ),
    ).toThrow("邀請人數必須是 1 到 20 的整數");
  });
});
