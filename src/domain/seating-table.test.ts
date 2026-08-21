import { describe, expect, it } from "vitest";
import {
  MAX_SEATING_TABLE_COUNT,
  SeatingTableValidationError,
  normalizeSeatingTableAdjustmentInput,
  normalizeSeatingTableInput,
  normalizeSeatingTableLayoutInput,
  normalizeSeatingTableVersion,
  seatingTableNumber,
  seatingTableNumbers,
  seatingTableSide,
  withSeatingTableNumbers,
} from "./seating-table";

describe("seating table domain contract", () => {
  it("normalizes valid human-facing fields", () => {
    expect(
      normalizeSeatingTableInput({
        name: "  主   桌  ",
        capacity: "12",
        notes: "  靠近舞台  ",
      }),
    ).toEqual({ name: "主 桌", capacity: 12, notes: "靠近舞台" });
  });

  it.each(["", " ", "桌".repeat(81)])("rejects an invalid table name", (name) => {
    expect(() =>
      normalizeSeatingTableInput({ name, capacity: "10", notes: "" }),
    ).toThrow(SeatingTableValidationError);
  });

  it.each(["", "0", "101", "1.5", "ten"])(
    "rejects an invalid capacity: %s",
    (capacity) => {
      expect(() =>
        normalizeSeatingTableInput({ name: "主桌", capacity, notes: "" }),
      ).toThrow("桌次容量需為 1 到 100 的整數");
    },
  );

  it("turns blank notes into null and rejects notes over 500 characters", () => {
    expect(
      normalizeSeatingTableInput({ name: "主桌", capacity: 10, notes: "   " })
        .notes,
    ).toBeNull();

    expect(() =>
      normalizeSeatingTableInput({
        name: "主桌",
        capacity: 10,
        notes: "備".repeat(501),
      }),
    ).toThrow("備註最多 500 個字元");
  });

  it("normalizes a bounded total table count and the capacity used only for new tables", () => {
    expect(
      normalizeSeatingTableAdjustmentInput({
        totalTableCount: "12",
        defaultCapacity: "10",
      }),
    ).toEqual({ totalTableCount: 12, defaultCapacity: 10 });
    expect(MAX_SEATING_TABLE_COUNT).toBe(200);
  });

  it.each(["-1", "201", "1.5", "many"])(
    "rejects an invalid total table count: %s",
    (totalTableCount) => {
      expect(() =>
        normalizeSeatingTableAdjustmentInput({
          totalTableCount,
          defaultCapacity: "10",
        }),
      ).toThrow("總桌數需為 0 到 200 的整數");
    },
  );

  it("accepts only a non-negative integer table version", () => {
    expect(normalizeSeatingTableVersion("0")).toBe(0);
    expect(normalizeSeatingTableVersion(12)).toBe(12);

    for (const version of ["", "-1", "1.5", "stale", null]) {
      expect(() => normalizeSeatingTableVersion(version)).toThrow(
        "桌次版本無效，請重新整理後再試",
      );
    }
  });

  it("normalizes paired floor-plan coordinates and an explicit reset", () => {
    expect(
      normalizeSeatingTableLayoutInput({ layoutX: "0", layoutY: 1000 }),
    ).toEqual({ layoutX: 0, layoutY: 1000 });
    expect(
      normalizeSeatingTableLayoutInput({ layoutX: null, layoutY: "" }),
    ).toEqual({ layoutX: null, layoutY: null });
  });

  it.each([
    [{ layoutX: "100", layoutY: "" }, "場地座標必須成對設定"],
    [{ layoutX: "", layoutY: "100" }, "場地座標必須成對設定"],
    [{ layoutX: "-1", layoutY: "500" }, "場地座標需為 0 到 1000 的整數"],
    [{ layoutX: "500", layoutY: "1001" }, "場地座標需為 0 到 1000 的整數"],
    [{ layoutX: "1.5", layoutY: "500" }, "場地座標需為 0 到 1000 的整數"],
  ])("rejects an invalid floor-plan coordinate pair", (input, message) => {
    expect(() => normalizeSeatingTableLayoutInput(input)).toThrow(message);
  });

  it("numbers tables from the main table and skips the avoided numbers", () => {
    expect(seatingTableNumbers(0)).toEqual([]);
    // 第一順位是主桌，一定拿到 1 號。
    expect(seatingTableNumbers(15)).toEqual([
      1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18,
    ]);
  });

  it.each([
    [4, 5],
    [12, 15],
    // 只跳單獨的 4 而留下 14、24 會被長輩挑。
    [20, 23],
    [34, 39],
    // 40～49 整段都不用，第 35 順位直接跳到 50 號。
    [35, 50],
  ])("maps rank %i to table number %i", (rank, expected) => {
    expect(seatingTableNumber(rank)).toBe(expected);
  });

  it("never issues an avoided number across the whole supported range", () => {
    const numbers = seatingTableNumbers(MAX_SEATING_TABLE_COUNT);
    expect(numbers).toHaveLength(MAX_SEATING_TABLE_COUNT);
    expect(numbers.filter((number) => String(number).includes("4"))).toEqual([]);
    expect(numbers).not.toContain(13);
    // 13 是整個號碼比對，不是逐位：113、130 這種沒有人忌諱的號碼照樣要用。
    expect(numbers).toContain(113);
    expect(numbers).toContain(130);
    expect(new Set(numbers).size).toBe(MAX_SEATING_TABLE_COUNT);
    // 一路遞增，桌號的順序就是桌次的順序。
    expect([...numbers].sort((left, right) => left - right)).toEqual(numbers);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects an invalid rank: %s",
    (rank) => {
      expect(() => seatingTableNumber(rank)).toThrow(
        SeatingTableValidationError,
      );
    },
  );

  it("derives which side a table belongs to from the guests actually seated there", () => {
    const guest = (side: "PARTNER_A" | "PARTNER_B" | "SHARED") => ({ side });

    // 空桌不屬於任何一邊，不該被貼標籤。
    expect(seatingTableSide([])).toBeNull();
    expect(seatingTableSide([guest("PARTNER_A"), guest("PARTNER_A")])).toBe(
      "PARTNER_A",
    );
    expect(seatingTableSide([guest("PARTNER_B")])).toBe("PARTNER_B");
    // 男方同事與女方同學混坐，標成任何一邊都是錯的。
    expect(seatingTableSide([guest("PARTNER_A"), guest("PARTNER_B")])).toBe(
      "SHARED",
    );
    // 只要有共同親友在座就算共同，不管排在第幾位。
    expect(seatingTableSide([guest("SHARED"), guest("PARTNER_A")])).toBe(
      "SHARED",
    );
    expect(seatingTableSide([guest("PARTNER_A"), guest("SHARED")])).toBe(
      "SHARED",
    );
  });

  it("attaches numbers by list order so duplicate names stay distinguishable", () => {
    expect(
      withSeatingTableNumbers([
        { id: "table_1", name: "主桌" },
        { id: "table_2", name: "同事桌" },
        { id: "table_3", name: "同事桌" },
        { id: "table_4", name: "同事桌" },
      ]),
    ).toEqual([
      { id: "table_1", name: "主桌", number: 1 },
      { id: "table_2", name: "同事桌", number: 2 },
      { id: "table_3", name: "同事桌", number: 3 },
      // 名字一樣也分得出來：第四桌是 5 號，不是 4 號。
      { id: "table_4", name: "同事桌", number: 5 },
    ]);
  });
});
