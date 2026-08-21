import { describe, expect, it } from "vitest";
import {
  GUEST_CATEGORY_LABELS,
  guestIdentityLabel,
  GUEST_SIDE_LABELS,
  GuestValidationError,
  normalizeGuestInput,
  normalizeGuestVersion,
} from "./guest";

describe("guest domain contract", () => {
  it("defines the confirmed human-facing labels for every guest side", () => {
    expect(GUEST_SIDE_LABELS).toEqual({
      PARTNER_A: "男方親友",
      PARTNER_B: "女方親友",
      SHARED: "共同親友",
    });
  });

  it("separates roster categories from the side used for seating", () => {
    expect(GUEST_CATEGORY_LABELS).toEqual({
      GUEST: "一般賓客",
      COUPLE: "新人",
      FAMILY: "家人",
    });
    expect(guestIdentityLabel("GUEST", "PARTNER_A")).toBe("男方親友");
    expect(guestIdentityLabel("COUPLE", "PARTNER_A")).toBe("新郎");
    expect(guestIdentityLabel("COUPLE", "PARTNER_B")).toBe("新娘");
    expect(guestIdentityLabel("FAMILY", "PARTNER_A")).toBe("新郎家人");
    expect(guestIdentityLabel("FAMILY", "PARTNER_B")).toBe("新娘家人");
  });

  it("accepts only canonical non-negative Guest CAS versions", () => {
    expect(normalizeGuestVersion("0")).toBe(0);
    expect(normalizeGuestVersion("12")).toBe(12);
    expect(normalizeGuestVersion(4)).toBe(4);
    for (const value of [undefined, "", "00", "01", "-1", "1.5", -1, 1.5]) {
      expect(() => normalizeGuestVersion(value)).toThrow(GuestValidationError);
    }
  });

  it("normalizes a valid guest without changing explicit enum values", () => {
    expect(
      normalizeGuestInput({
        name: "  王小明   與家人  ",
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: "3",
        notes: "  需要兒童椅  ",
      }),
    ).toEqual({
      name: "王小明 與家人",
      category: "GUEST",
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize: 3,
      notes: "需要兒童椅",
    });
  });

  it("keeps newlyweds and family as one person per roster entry", () => {
    expect(
      normalizeGuestInput({
        name: "新郎",
        category: "COUPLE",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: "1",
        notes: "",
      }),
    ).toMatchObject({ category: "COUPLE", side: "PARTNER_A", partySize: 1 });

    expect(() =>
      normalizeGuestInput({
        name: "新娘媽媽",
        category: "FAMILY",
        side: "PARTNER_B",
        attendanceStatus: "ATTENDING",
        partySize: "2",
        notes: "",
      }),
    ).toThrow("新人與家人請一人建立一筆名單");
  });

  it("rejects a shared-side newlywed or family role", () => {
    expect(() =>
      normalizeGuestInput({
        name: "不明角色",
        category: "FAMILY",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: "1",
        notes: "",
      }),
    ).toThrow("新人與家人需選擇新郎或新娘一方");
  });

  it.each(["", " ", "a".repeat(81)])("rejects an invalid name", (name) => {
    expect(() =>
      normalizeGuestInput({
        name,
        side: "PARTNER_A",
        attendanceStatus: "UNDECIDED",
        partySize: "1",
        notes: "",
      }),
    ).toThrow(GuestValidationError);
  });

  it.each(["0", "21", "1.5", "not-a-number", ""])(
    "rejects an invalid party size: %s",
    (partySize) => {
      expect(() =>
        normalizeGuestInput({
          name: "王小明",
          side: "PARTNER_A",
          attendanceStatus: "UNDECIDED",
          partySize,
          notes: "",
        }),
      ).toThrow(GuestValidationError);
    },
  );

  it("describes party size as the total invited count", () => {
    expect(() =>
      normalizeGuestInput({
        name: "王小明",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: "0",
        notes: "",
      }),
    ).toThrow("邀請人數需為 1 到 20 的整數");
  });

  it("turns blank notes into null and rejects notes over 500 characters", () => {
    expect(
      normalizeGuestInput({
        name: "王小明",
        side: "PARTNER_B",
        attendanceStatus: "DECLINED",
        partySize: 1,
        notes: "   ",
      }).notes,
    ).toBeNull();

    expect(() =>
      normalizeGuestInput({
        name: "王小明",
        side: "PARTNER_B",
        attendanceStatus: "DECLINED",
        partySize: 1,
        notes: "備".repeat(501),
      }),
    ).toThrow("備註最多 500 個字元");
  });

  it.each([
    ["side", "OWNER"],
    ["side", "partner_a"],
    ["attendanceStatus", "MAYBE"],
    ["attendanceStatus", "attending"],
  ] as const)("rejects an unknown %s enum value", (field, value) => {
    expect(() =>
      normalizeGuestInput({
        name: "王小明",
        side: field === "side" ? value : "PARTNER_A",
        attendanceStatus:
          field === "attendanceStatus" ? value : "UNDECIDED",
        partySize: "1",
        notes: "",
      }),
    ).toThrow(GuestValidationError);
  });
});
