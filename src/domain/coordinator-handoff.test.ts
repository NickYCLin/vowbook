import { describe, expect, it } from "vitest";
import { normalizeHandoff, handoffLocalTime } from "./coordinator-handoff";

function form(values: Record<string, string | undefined> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ title: " 核對餐點 ", details: " 請與領班確認 ", phase: "EVENT_DAY", status: "PENDING", ...values })) if (value !== undefined) data.set(key, value);
  return data;
}
describe("coordinator handoff contract", () => {
  it("allows a coordinator yet to be named and an unlinked item", () => {
    expect(normalizeHandoff(form())).toEqual({ title: "核對餐點", details: "請與領班確認", phase: "EVENT_DAY", status: "PENDING", dueAt: null, staffId: null, timelineItemId: null });
  });
  it("round trips Taiwan local deadlines independently of server timezone", () => {
    const result = normalizeHandoff(form({ dueAt: "2026-09-20T12:30" }));
    expect(result.dueAt?.toISOString()).toBe("2026-09-20T04:30:00.000Z");
    expect(handoffLocalTime(result.dueAt)).toBe("2026-09-20T12:30");
  });
  it.each([{ title: " " }, { details: "" }, { title: "字".repeat(121) }, { details: "字".repeat(2001) }, { phase: "OTHER" }, { status: "AUTO_SENT" }, { dueAt: "2026-02-30T12:00" }, { dueAt: "2026-09-20" }])("rejects invalid input %j", (values) => {
    expect(() => normalizeHandoff(form(values))).toThrow();
  });
});
