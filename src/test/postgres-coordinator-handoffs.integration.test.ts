import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireCurrentUser: async () => ({ id: auth.id }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveHandoffAction, setHandoffStatusAction, deleteHandoffAction } from "@/actions/coordinator-handoffs";
import { getCoordinatorHandoffs } from "@/lib/coordinator-handoffs";
import { deleteWeddingTimelineItemAction } from "@/actions/wedding-timeline";
const enabled = process.env.VOWBOOK_DB_INTEGRATION === "1";
const db = new PrismaClient();
const idle = { status: "idle" as const };
function form(values: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ title: "核對餐點", details: "與領班確認", phase: "EVENT_DAY", status: "PENDING", expectedVersion: "0", ...values })) result.set(key, value);
  return result;
}
async function seed() {
  const user = await db.user.create({ data: { googleSubject: "handoff-owner", email: "handoff@example.test" } });
  auth.id = user.id;
  const workspace = await db.weddingWorkspace.create({ data: { name: "測試婚宴", createdById: user.id, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const second = await db.weddingWorkspace.create({ data: { name: "另一婚宴", createdById: user.id, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const staff = await db.weddingStaffAssignment.create({ data: { workspaceId: workspace.id, roleName: "總召", personName: "測試人員" } });
  const flow = await db.weddingTimelineItem.create({ data: { workspaceId: workspace.id, startMinute: 720, phase: "開席", title: "確認餐點" } });
  return { workspace, second, staff, flow };
}
(enabled ? describe : describe.skip).sequential("PostgreSQL coordinator handoffs", () => {
  beforeEach(async () => { await db.weddingWorkspace.deleteMany(); await db.user.deleteMany(); });
  afterAll(async () => { if (enabled) { await db.weddingWorkspace.deleteMany(); await db.user.deleteMany(); } await db.$disconnect(); });
  it("creates, reads, updates and removes an unassigned handoff", async () => {
    const { workspace } = await seed();
    expect(await saveHandoffAction(workspace.id, null, idle, form())).toMatchObject({ status: "success" });
    const item = (await getCoordinatorHandoffs(workspace.id)).items[0];
    expect(item).toMatchObject({ staffId: null, timelineItemId: null, version: 0 });
    expect(await saveHandoffAction(workspace.id, item.id, idle, form({ title: "修改事項" }))).toMatchObject({ status: "success" });
    expect(await deleteHandoffAction(workspace.id, item.id, idle, form({ expectedVersion: "1" }))).toMatchObject({ status: "success" });
    expect(await db.coordinatorHandoff.count()).toBe(0);
  });
  it("rejects cross-workspace references at both action and database boundaries", async () => {
    const { second, staff, flow } = await seed();
    expect(await saveHandoffAction(second.id, null, idle, form({ staffId: staff.id }))).toMatchObject({ code: "VALIDATION" });
    expect(await saveHandoffAction(second.id, null, idle, form({ timelineItemId: flow.id }))).toMatchObject({ code: "VALIDATION" });
    for (const relation of [{ staffId: staff.id }, { timelineItemId: flow.id }]) {
      await expect(db.coordinatorHandoff.create({ data: { workspaceId: second.id, title: "核對", details: "測試", phase: "EVENT_DAY", ...relation } })).rejects.toMatchObject({ code: "P2003" });
    }
  });
  it("lets viewers read but denies mutations and denies nonmembers all data", async () => {
    const { workspace } = await seed();
    await db.membership.updateMany({ where: { workspaceId: workspace.id }, data: { role: "VIEWER" } });
    expect((await getCoordinatorHandoffs(workspace.id)).items).toEqual([]);
    expect(await saveHandoffAction(workspace.id, null, idle, form())).toMatchObject({ code: "FORBIDDEN" });
    await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
    await expect(getCoordinatorHandoffs(workspace.id)).rejects.toThrow();
  });
  it("allows only one concurrent status write from the same version", async () => {
    const { workspace } = await seed();
    await saveHandoffAction(workspace.id, null, idle, form());
    const item = await db.coordinatorHandoff.findFirstOrThrow();
    const results = await Promise.all(["CONFIRMED", "DONE"].map(status => setHandoffStatusAction(workspace.id, item.id, idle, form({ status }))));
    expect(results.filter(result => result.status === "success")).toHaveLength(1);
    expect(results.filter(result => result.code === "STALE")).toHaveLength(1);
  });
  it("preserves linked items when a staff member or flow is removed", async () => {
    const { workspace, staff, flow } = await seed();
    await saveHandoffAction(workspace.id, null, idle, form({ staffId: staff.id, timelineItemId: flow.id }));
    await expect(db.weddingStaffAssignment.delete({ where: { id: staff.id } })).rejects.toMatchObject({ code: "P2003" });
    expect(await deleteWeddingTimelineItemAction(workspace.id, flow.id, idle, form())).toMatchObject({ code: "VALIDATION", message: expect.stringContaining("解除流程關聯") });
    expect(await db.coordinatorHandoff.count()).toBe(1);
    await db.weddingWorkspace.delete({ where: { id: workspace.id } });
    expect(await db.coordinatorHandoff.count()).toBe(0);
  });
});
