import { createHash } from "node:crypto";

const PREFIX = "vowbook-staff-timeline-v1:";

export function weddingStaffTimelineAssignmentFingerprint(
  timelineItemIds: readonly string[],
): string {
  const canonical = JSON.stringify([...timelineItemIds].sort());
  return `${PREFIX}${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function isWeddingStaffTimelineAssignmentFingerprint(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^vowbook-staff-timeline-v1:[a-f0-9]{64}$/u.test(value)
  );
}
