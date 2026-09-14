import { describe, expect, it } from "vitest";
import {
  isWeddingGiftReturnPending,
  isWeddingGiftSort,
  isWeddingGiftWithoutAttendance,
  normalizeWeddingGiftDetails,
  normalizeWeddingGiftExpectedVersion,
  normalizeWeddingGiftReturnNote,
  sortWeddingGiftEntries,
  WeddingGiftValidationError,
} from "./wedding-gift";

describe("wedding gift domain", () => {
  it("normalizes a positive integer TWD amount and an optional bounded note", () => {
    expect(
      normalizeWeddingGiftDetails({
        amount: "12000",
        notes: "  大學同學桌，禮金袋另收好  ",
      }),
    ).toEqual({
      amount: 12_000,
      notes: "大學同學桌，禮金袋另收好",
    });

    expect(
      normalizeWeddingGiftDetails({ amount: "1", notes: "   " }),
    ).toEqual({ amount: 1, notes: null });
  });

  it.each([
    "",
    " ",
    "0",
    "00",
    "01",
    "+1",
    "-1",
    "1.5",
    "1e3",
    "2147483648",
    null,
    1200,
  ])("rejects a non-canonical positive Int32 amount: %j", (amount) => {
    expect(() =>
      normalizeWeddingGiftDetails({ amount, notes: "" }),
    ).toThrow(WeddingGiftValidationError);
  });

  it("accepts the maximum PostgreSQL Int amount", () => {
    expect(
      normalizeWeddingGiftDetails({ amount: "2147483647", notes: null }),
    ).toEqual({ amount: 2_147_483_647, notes: null });
  });

  it("counts notes by Unicode code points and rejects over 500 characters", () => {
    expect(
      normalizeWeddingGiftDetails({
        amount: "3600",
        notes: "🎁".repeat(500),
      }).notes,
    ).toBe("🎁".repeat(500));
    expect(() =>
      normalizeWeddingGiftDetails({
        amount: "3600",
        notes: "🎁".repeat(501),
      }),
    ).toThrow("禮金備註最多 500 個字元");
  });

  it.each(["0", "7", "2147483647"])(
    "accepts a canonical non-negative version: %s",
    (version) => {
      expect(normalizeWeddingGiftExpectedVersion(version)).toBe(
        Number(version),
      );
    },
  );

  it.each(["", "00", "01", "-1", "1.5", "2147483648", null, 1])(
    "rejects an invalid CAS version: %j",
    (version) => {
      expect(() => normalizeWeddingGiftExpectedVersion(version)).toThrow(
        WeddingGiftValidationError,
      );
    },
  );
});

describe("sortWeddingGiftEntries", () => {
  const entries = [
    { name: "王小明", weddingGift: { amount: 3600, createdAt: "2026-08-31T02:00:00Z" } },
    { name: "陳大同", weddingGift: null },
    { name: "李四", weddingGift: { amount: 12000, createdAt: "2026-08-31T01:00:00Z" } },
    { name: "張三", weddingGift: { amount: 3600, createdAt: "2026-08-31T03:00:00Z" } },
  ];
  const names = (sort: Parameters<typeof sortWeddingGiftEntries>[1]) =>
    sortWeddingGiftEntries(entries, sort).map((entry) => entry.name);

  it("keeps the roster order untouched by default", () => {
    expect(names("ROSTER")).toEqual(["王小明", "陳大同", "李四", "張三"]);
  });

  it("orders by amount in both directions and pushes unrecorded groups last", () => {
    expect(names("AMOUNT_DESC")).toEqual(["李四", "王小明", "張三", "陳大同"]);
    expect(names("AMOUNT_ASC")).toEqual(["王小明", "張三", "李四", "陳大同"]);
  });

  it("breaks equal amounts by roster order so rows never swap between renders", () => {
    const first = names("AMOUNT_DESC");
    const second = names("AMOUNT_DESC");
    expect(first).toEqual(second);
    expect(first.indexOf("王小明")).toBeLessThan(first.indexOf("張三"));
  });

  it("orders by the most recently registered gift", () => {
    expect(names("RECENT")).toEqual(["張三", "王小明", "李四", "陳大同"]);
  });

  it("orders by name including groups without a gift", () => {
    expect(names("NAME")).toEqual(["王小明", "李四", "張三", "陳大同"]);
  });

  it("does not mutate the caller's array", () => {
    const original = entries.map((entry) => entry.name);
    sortWeddingGiftEntries(entries, "AMOUNT_DESC");
    expect(entries.map((entry) => entry.name)).toEqual(original);
  });

  it("treats a missing or unparsable timestamp as the oldest entry", () => {
    expect(
      sortWeddingGiftEntries(
        [
          { name: "有時間", weddingGift: { amount: 1, createdAt: "2026-08-31T00:00:00Z" } },
          { name: "壞時間", weddingGift: { amount: 1, createdAt: "not-a-date" } },
          { name: "沒時間", weddingGift: { amount: 1, createdAt: null } },
        ],
        "RECENT",
      ).map((entry) => entry.name),
    ).toEqual(["有時間", "壞時間", "沒時間"]);
  });

  it.each(["ROSTER", "AMOUNT_DESC", "AMOUNT_ASC", "NAME", "RECENT"])(
    "recognises the sort key %s",
    (sort) => {
      expect(isWeddingGiftSort(sort)).toBe(true);
    },
  );

  it.each(["", "amount", null, undefined, 3, {}])(
    "rejects the invalid sort key %j",
    (sort) => {
      expect(isWeddingGiftSort(sort)).toBe(false);
    },
  );
});

describe("wedding gift return tracking", () => {
  const gift = { returnGiftSentAt: null };

  it("requires an explicit decline and no check-in to flag a received gift", () => {
    for (const attendanceStatus of ["UNDECIDED", "ATTENDING", "DECLINED"] as const) {
      for (const checkIn of [null, { id: "check_in_1" }]) {
        const entry = { attendanceStatus, weddingGift: gift, checkIn };
        const expected = attendanceStatus === "DECLINED" && checkIn === null;
        expect(isWeddingGiftWithoutAttendance(entry)).toBe(expected);
        expect(isWeddingGiftReturnPending(entry)).toBe(expected);
      }
    }
  });

  it("never flags an invitation group without a gift", () => {
    for (const attendanceStatus of ["UNDECIDED", "ATTENDING", "DECLINED"] as const) {
      expect(
        isWeddingGiftWithoutAttendance({
          attendanceStatus,
          weddingGift: null,
          checkIn: null,
        }),
      ).toBe(false);
    }
  });

  it("stops being pending once the return gift is recorded as sent", () => {
    const entry = {
      attendanceStatus: "DECLINED" as const,
      weddingGift: { returnGiftSentAt: null as Date | string | null },
      checkIn: null,
    };
    expect(isWeddingGiftReturnPending(entry)).toBe(true);
    entry.weddingGift.returnGiftSentAt = "2026-09-05T02:00:00Z";
    expect(isWeddingGiftReturnPending(entry)).toBe(false);
    expect(isWeddingGiftWithoutAttendance(entry)).toBe(true);
  });
});

describe("normalizeWeddingGiftReturnNote", () => {
  it("trims and keeps a bounded note", () => {
    expect(normalizeWeddingGiftReturnNote("  寄了 2 盒喜餅  ")).toBe(
      "寄了 2 盒喜餅",
    );
  });

  it.each([null, undefined, "", "   "])("treats %j as no note", (value) => {
    expect(normalizeWeddingGiftReturnNote(value)).toBeNull();
  });

  it("counts by Unicode code point and rejects an over-long note", () => {
    const note = "餅".repeat(200);
    expect(normalizeWeddingGiftReturnNote(note)).toBe(note);
    expect(() => normalizeWeddingGiftReturnNote(`${note}餅`)).toThrow(
      WeddingGiftValidationError,
    );
  });

  it.each([3, [], {}, true])("rejects the non-string note %j", (value) => {
    expect(() => normalizeWeddingGiftReturnNote(value)).toThrow(
      WeddingGiftValidationError,
    );
  });
});
