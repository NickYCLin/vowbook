import { beforeEach, describe, expect, it, vi } from "vitest";

const { readXlsxFile } = vi.hoisted(() => ({
  readXlsxFile: vi.fn(),
}));

vi.mock("read-excel-file/node", () => ({
  default: readXlsxFile,
}));

import {
  GuestXlsxWorkbookError,
  inspectGuestXlsxWorkbook,
  parseGuestXlsxWorkbook,
} from "./guest-xlsx-workbook";

const syntheticXlsx = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

describe("guest XLSX workbook reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readXlsxFile.mockResolvedValue([
      {
        sheet: "Survey",
        data: [
          [
            "回覆識別碼",
            "賓客姓名",
            "與新人的關係",
            "是否出席",
            "出席人數（含本人）",
          ],
          ["opaque-a", "合成甲", "男方", "出席", 2],
          ["opaque-b", "合成乙", "女方", "不出席", 1],
        ],
      },
    ]);
  });

  it("returns only sheet/header metadata and a suggested mapping", async () => {
    await expect(inspectGuestXlsxWorkbook(syntheticXlsx)).resolves.toEqual({
      sheetNames: ["Survey"],
      sheetName: "Survey",
      headerRow: 1,
      headers: [
        "回覆識別碼",
        "賓客姓名",
        "與新人的關係",
        "是否出席",
        "出席人數（含本人）",
      ],
      rowCount: 2,
      suggestedMapping: {
        externalId: 0,
        name: 1,
        side: 2,
        attendanceStatus: 3,
        partySize: 4,
      },
    });

    expect(readXlsxFile).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it("parses the selected sheet and header row using explicit mapping", async () => {
    const parsed = await parseGuestXlsxWorkbook(syntheticXlsx, {
      sheetName: "Survey",
      headerRow: 1,
      mapping: {
        externalId: 0,
        name: 1,
        side: 2,
        attendanceStatus: 3,
        partySize: 4,
      },
    });

    expect(parsed.sheetName).toBe("Survey");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      externalId: "opaque-a",
      name: "合成甲",
      partySize: 2,
    });
    expect(parsed.inputSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects non-XLSX bytes and invalid selected sheets before exposing parser errors", async () => {
    await expect(
      inspectGuestXlsxWorkbook(Uint8Array.from([1, 2, 3, 4])),
    ).rejects.toEqual(new GuestXlsxWorkbookError("檔案不是有效的 .xlsx 活頁簿。"));
    expect(readXlsxFile).not.toHaveBeenCalled();

    await expect(
      inspectGuestXlsxWorkbook(syntheticXlsx, {
        sheetName: "Missing",
      }),
    ).rejects.toEqual(new GuestXlsxWorkbookError("指定的工作表不存在，請重新選擇。"));
    expect(readXlsxFile).toHaveBeenCalledOnce();
  });

  it("maps low-level workbook failures to a fixed non-PII message", async () => {
    readXlsxFile.mockRejectedValueOnce(
      new Error("PII-SHOULD-NOT-LEAK /private/Survey.xlsx"),
    );

    await expect(inspectGuestXlsxWorkbook(syntheticXlsx)).rejects.toEqual(
      new GuestXlsxWorkbookError("目前無法讀取 Excel，請確認檔案未損毀或加密。"),
    );
  });
});
