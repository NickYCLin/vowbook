import { describe, expect, it } from "vitest";
import {
  isWeddingStaffTimelineAssignmentFingerprint,
  weddingStaffTimelineAssignmentFingerprint,
} from "./wedding-staff-timeline-snapshot";

describe("wedding staff timeline assignment snapshot", () => {
  it("is deterministic, order-independent, and changes with the assigned set", () => {
    const first = weddingStaffTimelineAssignmentFingerprint([
      "timeline_b",
      "timeline_a",
    ]);
    expect(first).toBe(
      weddingStaffTimelineAssignmentFingerprint([
        "timeline_a",
        "timeline_b",
      ]),
    );
    expect(first).not.toBe(
      weddingStaffTimelineAssignmentFingerprint(["timeline_a"]),
    );
    expect(isWeddingStaffTimelineAssignmentFingerprint(first)).toBe(true);
    expect(isWeddingStaffTimelineAssignmentFingerprint(`${first}00`)).toBe(
      false,
    );
  });
});
