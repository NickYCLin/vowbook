import { describe, expect, it } from "vitest";
import {
  GuestCheckInValidationError,
  MAX_GUEST_CHECK_IN_HEADCOUNT,
  normalizeGuestCheckInDetails,
  normalizeGuestCheckInExpectedVersion,
  reconcileGuestCheckIn,
  summarizeGuestCheckIns,
} from "./guest-check-in";

describe("guest check-in domain", () => {
  it("normalizes a positive integer headcount and an optional bounded note", () => {
    expect(
      normalizeGuestCheckInDetails({
        headcount: "3",
        notes: "  臨時多帶一位小孩  ",
      }),
    ).toEqual({ headcount: 3, notes: "臨時多帶一位小孩" });

    expect(
      normalizeGuestCheckInDetails({ headcount: "1", notes: "   " }),
    ).toEqual({ headcount: 1, notes: null });
  });

  it.each([
    "",
    " ",
    "0",
    "00",
    "01",
    "-1",
    "1.5",
    "１", // 全形數字不是可信輸入
    "21",
    String(MAX_GUEST_CHECK_IN_HEADCOUNT + 1),
    "1e2",
  ])("rejects the invalid headcount %j", (headcount) => {
    expect(() =>
      normalizeGuestCheckInDetails({ headcount, notes: null }),
    ).toThrow(GuestCheckInValidationError);
  });

  it.each([null, undefined, 3, [], {}])(
    "rejects the non-string headcount %j",
    (headcount) => {
      expect(() =>
        normalizeGuestCheckInDetails({ headcount, notes: null }),
      ).toThrow(GuestCheckInValidationError);
    },
  );

  it("accepts the maximum headcount", () => {
    expect(
      normalizeGuestCheckInDetails({
        headcount: String(MAX_GUEST_CHECK_IN_HEADCOUNT),
        notes: null,
      }),
    ).toEqual({ headcount: MAX_GUEST_CHECK_IN_HEADCOUNT, notes: null });
  });

  it("counts note length by Unicode code point rather than UTF-16 units", () => {
    const note = "🎉".repeat(200);
    expect(
      normalizeGuestCheckInDetails({ headcount: "1", notes: note }),
    ).toEqual({ headcount: 1, notes: note });

    expect(() =>
      normalizeGuestCheckInDetails({ headcount: "1", notes: `${note}🎉` }),
    ).toThrow(GuestCheckInValidationError);
  });

  it.each([null, undefined, ""])("treats the empty note %j as no note", (notes) => {
    expect(normalizeGuestCheckInDetails({ headcount: "1", notes })).toEqual({
      headcount: 1,
      notes: null,
    });
  });

  it.each([3, [], {}, true])("rejects the non-string note %j", (notes) => {
    expect(() =>
      normalizeGuestCheckInDetails({ headcount: "1", notes }),
    ).toThrow(GuestCheckInValidationError);
  });

  it.each(["0", "1", "12"])("accepts the expected version %j", (version) => {
    expect(normalizeGuestCheckInExpectedVersion(version)).toBe(Number(version));
  });

  it.each(["", " ", "-1", "1.0", "01", 1, null, undefined])(
    "rejects the invalid expected version %j",
    (version) => {
      expect(() => normalizeGuestCheckInExpectedVersion(version)).toThrow(
        GuestCheckInValidationError,
      );
    },
  );
});

describe("summarizeGuestCheckIns", () => {
  it("separates expected attendance from what actually arrived", () => {
    expect(
      summarizeGuestCheckIns([
        { attendanceStatus: "ATTENDING", partySize: 4, checkedInHeadcount: 3 },
        { attendanceStatus: "ATTENDING", partySize: 2, checkedInHeadcount: null },
        { attendanceStatus: "UNDECIDED", partySize: 2, checkedInHeadcount: 2 },
        { attendanceStatus: "DECLINED", partySize: 1, checkedInHeadcount: 1 },
        { attendanceStatus: "DECLINED", partySize: 1, checkedInHeadcount: null },
      ]),
    ).toEqual({
      expectedGroups: 2,
      expectedHeadcount: 6,
      arrivedGroups: 3,
      arrivedHeadcount: 6,
      pendingGroups: 1,
      pendingHeadcount: 2,
      unexpectedGroups: 2,
    });
  });

  it("returns an all-zero summary for an empty guest list", () => {
    expect(summarizeGuestCheckIns([])).toEqual({
      expectedGroups: 0,
      expectedHeadcount: 0,
      arrivedGroups: 0,
      arrivedHeadcount: 0,
      pendingGroups: 0,
      pendingHeadcount: 0,
      unexpectedGroups: 0,
    });
  });

  it("never lets an arrival that exceeds the invited party size go negative", () => {
    expect(
      summarizeGuestCheckIns([
        { attendanceStatus: "ATTENDING", partySize: 2, checkedInHeadcount: 5 },
      ]),
    ).toEqual({
      expectedGroups: 1,
      expectedHeadcount: 2,
      arrivedGroups: 1,
      arrivedHeadcount: 5,
      pendingGroups: 0,
      pendingHeadcount: 0,
      unexpectedGroups: 0,
    });
  });
});

describe("reconcileGuestCheckIn", () => {
  const saved = {
    id: "check_in_1",
    headcount: 3,
    notes: null,
    version: 1,
  };

  it("takes the server value when nothing local is pending", () => {
    expect(reconcileGuestCheckIn(undefined, saved)).toEqual({
      settled: true,
      checkIn: saved,
    });
    expect(reconcileGuestCheckIn(undefined, null)).toEqual({
      settled: true,
      checkIn: null,
    });
  });

  it("keeps a just-saved snapshot while the RSC payload is still behind", () => {
    expect(
      reconcileGuestCheckIn(
        { kind: "SAVE", checkIn: saved },
        { ...saved, headcount: 2, version: 0 },
      ),
    ).toEqual({ settled: false, checkIn: saved });
  });

  it("settles as soon as the server payload matches the saved snapshot", () => {
    expect(
      reconcileGuestCheckIn({ kind: "SAVE", checkIn: saved }, { ...saved }),
    ).toEqual({ settled: true, checkIn: saved });
  });

  it("yields to a collaborator who changed the same check-in afterwards", () => {
    const collaborator = { ...saved, headcount: 5, version: 2 };
    expect(
      reconcileGuestCheckIn({ kind: "SAVE", checkIn: saved }, collaborator),
    ).toEqual({ settled: true, checkIn: collaborator });

    const replaced = { ...saved, id: "check_in_2", version: 0 };
    expect(
      reconcileGuestCheckIn({ kind: "SAVE", checkIn: saved }, replaced),
    ).toEqual({ settled: true, checkIn: replaced });
  });

  it("never keeps a saved snapshot the authoritative payload no longer has", () => {
    expect(
      reconcileGuestCheckIn({ kind: "SAVE", checkIn: saved }, null),
    ).toEqual({ settled: true, checkIn: null });
  });

  it("hides a cancelled check-in until the stale payload catches up", () => {
    expect(
      reconcileGuestCheckIn({ kind: "CANCEL", checkIn: saved }, { ...saved }),
    ).toEqual({ settled: false, checkIn: null });
    expect(
      reconcileGuestCheckIn({ kind: "CANCEL", checkIn: saved }, null),
    ).toEqual({ settled: true, checkIn: null });
  });

  it("stops hiding a cancelled check-in once a genuinely newer one exists", () => {
    const recreated = { ...saved, id: "check_in_2", version: 0 };
    expect(
      reconcileGuestCheckIn({ kind: "CANCEL", checkIn: saved }, recreated),
    ).toEqual({ settled: true, checkIn: recreated });

    const newerVersion = { ...saved, version: 2 };
    expect(
      reconcileGuestCheckIn({ kind: "CANCEL", checkIn: saved }, newerVersion),
    ).toEqual({ settled: true, checkIn: newerVersion });
  });
});
