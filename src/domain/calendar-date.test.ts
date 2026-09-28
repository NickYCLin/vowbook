import { describe, expect, it } from "vitest";
import { dateKeyInTimezone } from "./calendar-date";

describe("wedding calendar day", () => {
  it("changes at midnight in Taipei rather than eight hours later", () => {
    expect(dateKeyInTimezone(new Date("2026-09-16T15:59:59Z"))).toBe("2026-09-16");
    expect(dateKeyInTimezone(new Date("2026-09-16T16:00:00Z"))).toBe("2026-09-17");
  });
  it("uses the explicitly supplied timezone", () => {
    expect(dateKeyInTimezone(new Date("2026-09-16T16:00:00Z"), "UTC")).toBe("2026-09-16");
  });
});
