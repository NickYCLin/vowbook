import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mobileCreateStaff, mobileUpdateStaff, mobileDeleteStaff } from "@/lib/mobile/wedding-staff";
import { mobileStaffList, mobileSetRedEnvelopeSent } from "@/lib/mobile/workspace-data";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { weddingStaffTimelineAssignmentFingerprint } from "@/domain/wedding-staff-timeline-snapshot";
const suite = process.env.VOWBOOK_DB_INTEGRATION === "1" ? describe : describe.skip;
const prefix = `mobile-staff-it-${process.pid}-`;
let sequence = 0;
const details = { roleName: "招待", personName: "合成人員", contactPhone: "0000000000", notes: "保留合成備註", needsMeal: true,
  mealCount: "3", vegetarianMealCount: "1", redEnvelopeAmount: "2000" };
async function fixture() {
  const user = await prisma.user.create({ data: { googleSubject: `${prefix}${sequence++}`, email: "fixture@example.test" } });
  const workspace = await prisma.weddingWorkspace.create({ data: { name: "合成測試婚宴", createdById: user.id,
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  return { user, workspace };
}
suite("mobile staff mutations against isolated PostgreSQL", () => {
  afterAll(async () => {
    await prisma.weddingWorkspace.deleteMany({ where: { createdBy: { googleSubject: { startsWith: prefix } } } });
    await prisma.user.deleteMany({ where: { googleSubject: { startsWith: prefix } } });
    await prisma.$disconnect();
  });
  it("creates, edits and deletes while preserving web-visible fields", async () => {
    const { user, workspace } = await fixture();
    const staff = await mobileCreateStaff(workspace.id, user.id, details);
    const list = await mobileStaffList(workspace.id, user.id);
    expect(list.staff[0]).toMatchObject({ notes: details.notes, mealCount: 3, vegetarianMealCount: 1 });
    await mobileUpdateStaff(workspace.id, user.id, staff.id, { ...details, roleName: "主持", expectedVersion: 0 });
    expect((await prisma.weddingStaffAssignment.findUniqueOrThrow({ where: { id: staff.id } })).roleName).toBe("主持");
    await mobileDeleteStaff(workspace.id, user.id, staff.id, { expectedVersion: 1, timelineAssignmentFingerprint: list.staff[0].timelineAssignmentFingerprint });
    expect(await prisma.weddingStaffAssignment.count({ where: { id: staff.id } })).toBe(0);
  });
  it("rejects viewers and nonmembers without writes", async () => {
    const owner = await fixture(); const other = await fixture();
    await expect(mobileCreateStaff(owner.workspace.id, other.user.id, details)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await prisma.membership.create({ data: { workspaceId: owner.workspace.id, userId: other.user.id, role: "VIEWER" } });
    await expect(mobileCreateStaff(owner.workspace.id, other.user.id, details)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(await prisma.weddingStaffAssignment.count({ where: { workspaceId: owner.workspace.id } })).toBe(0);
  });
  it("rejects cross-workspace staff IDs and stale edits", async () => {
    const owner = await fixture(); const other = await fixture();
    const staff = await mobileCreateStaff(owner.workspace.id, owner.user.id, details);
    await expect(mobileUpdateStaff(other.workspace.id, other.user.id, staff.id, { ...details, expectedVersion: 0 })).rejects.toMatchObject({ status: 409 });
    await mobileUpdateStaff(owner.workspace.id, owner.user.id, staff.id, { ...details, expectedVersion: 0 });
    await expect(mobileUpdateStaff(owner.workspace.id, owner.user.id, staff.id, { ...details, expectedVersion: 0 })).rejects.toMatchObject({ status: 409 });
  });
  it("preserves handout time and blocks clearing a handed-out amount", async () => {
    const { user, workspace } = await fixture();
    const staff = await mobileCreateStaff(workspace.id, user.id, details);
    await mobileSetRedEnvelopeSent(workspace.id, user.id, staff.id, true, 0);
    const before = await prisma.weddingStaffAssignment.findUniqueOrThrow({ where: { id: staff.id } });
    await mobileUpdateStaff(workspace.id, user.id, staff.id, { ...details, expectedVersion: 1 });
    const after = await prisma.weddingStaffAssignment.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.redEnvelopeSentAt).toEqual(before.redEnvelopeSentAt);
    await expect(mobileUpdateStaff(workspace.id, user.id, staff.id, { ...details, redEnvelopeAmount: "", expectedVersion: 2 })).rejects.toMatchObject({ status: 400 });
  });
  it("refuses a mismatching timeline snapshot even when the staff version matches", async () => {
    const { user, workspace } = await fixture();
    const staff = await mobileCreateStaff(workspace.id, user.id, details);
    const before = (await mobileStaffList(workspace.id, user.id)).staff[0];
    const timeline = await prisma.weddingTimelineItem.create({ data: { workspaceId: workspace.id, startMinute: 690, phase: "迎賓", title: "合成流程" } });
    await prisma.weddingTimelineStaffAssignment.create({ data: { workspaceId: workspace.id, timelineItemId: timeline.id, staffAssignmentId: staff.id } });
    await expect(mobileDeleteStaff(workspace.id, user.id, staff.id, { expectedVersion: 0,
      timelineAssignmentFingerprint: before.timelineAssignmentFingerprint })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.weddingStaffAssignment.count({ where: { id: staff.id } })).toBe(1);
    const latest = (await mobileStaffList(workspace.id, user.id)).staff[0];
    expect(latest.timelineAssignmentFingerprint).toBe(weddingStaffTimelineAssignmentFingerprint([timeline.id]));
    await mobileDeleteStaff(workspace.id, user.id, staff.id, { expectedVersion: 0, timelineAssignmentFingerprint: latest.timelineAssignmentFingerprint });
    expect(await prisma.weddingTimelineItem.count({ where: { id: timeline.id } })).toBe(1);
    expect(await prisma.weddingTimelineStaffAssignment.count({ where: { timelineItemId: timeline.id } })).toBe(0);
  });
});
