import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyWeddingTaskTemplate } from "@/lib/wedding-task-templates";
import { WEDDING_TASK_TEMPLATES } from "@/domain/wedding-task-templates";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
const suite = process.env.VOWBOOK_DB_INTEGRATION === "1" ? describe : describe.skip;
const prefix = `task-template-it-${process.pid}-`;
let sequence = 0;
async function fixture() {
  const user = await prisma.user.create({ data: { googleSubject: `${prefix}${sequence++}`, email: "fixture@example.test" } });
  const workspace = await prisma.weddingWorkspace.create({ data: { name: "合成任務婚宴", createdById: user.id, hasEngagementCeremony: false,
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  return { user, workspace };
}
suite("task templates against isolated PostgreSQL", () => {
  afterAll(async () => {
    await prisma.weddingWorkspace.deleteMany({ where: { createdBy: { googleSubject: { startsWith: prefix } } } });
    await prisma.user.deleteMany({ where: { googleSubject: { startsWith: prefix } } });
    await prisma.$disconnect();
  });
  it("adds engagement and reception independently without invented deadlines or enabling ceremonies", async () => {
    const { user, workspace } = await fixture();
    expect(await applyWeddingTaskTemplate(workspace.id, user.id, { templateKey: "ENGAGEMENT" })).toEqual({ createdCount: 8, skippedCount: 0 });
    expect(await applyWeddingTaskTemplate(workspace.id, user.id, { templateKey: "RECEPTION" })).toEqual({ createdCount: 10, skippedCount: 0 });
    const tasks = await prisma.weddingTask.findMany({ where: { workspaceId: workspace.id } });
    expect(tasks).toHaveLength(18);
    expect(tasks.every((task) => task.status === "TODO" && task.side === "SHARED" && task.dueDate === null)).toBe(true);
    expect((await prisma.weddingWorkspace.findUniqueOrThrow({ where: { id: workspace.id } })).hasEngagementCeremony).toBe(false);
  });
  it("preserves renamed, edited and completed tasks on repeated application", async () => {
    const { user, workspace } = await fixture();
    await applyWeddingTaskTemplate(workspace.id, user.id, { templateKey: "ENGAGEMENT" });
    const task = await prisma.weddingTask.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    await prisma.weddingTask.update({ where: { id: task.id }, data: { title: "自行改名", description: "自行編輯", status: "DONE", completedAt: new Date(), version: 1 } });
    const before = await prisma.weddingTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(await applyWeddingTaskTemplate(workspace.id, user.id, { templateKey: "ENGAGEMENT" })).toEqual({ createdCount: 0, skippedCount: 8 });
    expect(await prisma.weddingTask.findUniqueOrThrow({ where: { id: task.id } })).toEqual(before);
  });
  it("does not duplicate tasks when two requests race", async () => {
    const { user, workspace } = await fixture();
    const results = await Promise.all([applyWeddingTaskTemplate(workspace.id, user.id, { templateKey: "ENGAGEMENT" }),
      applyWeddingTaskTemplate(workspace.id, user.id, { templateKey: "ENGAGEMENT" })]);
    expect(results.reduce((total, result) => total + result.createdCount, 0)).toBe(8);
    expect(await prisma.weddingTask.count({ where: { workspaceId: workspace.id } })).toBe(8);
  });
  it("skips same-title manual tasks and refills only explicitly deleted template tasks", async () => {
    const { user, workspace } = await fixture();
    await prisma.weddingTask.create({ data: { workspaceId: workspace.id, title: WEDDING_TASK_TEMPLATES[0].tasks[0].title, description: "手動任務" } });
    expect(await applyWeddingTaskTemplate(workspace.id, user.id, { templateKey: "ENGAGEMENT" })).toEqual({ createdCount: 7, skippedCount: 1 });
    const task = await prisma.weddingTask.findFirstOrThrow({ where: { workspaceId: workspace.id, templateKey: { not: null } } });
    await prisma.weddingTask.delete({ where: { id: task.id } });
    expect(await applyWeddingTaskTemplate(workspace.id, user.id, { templateKey: "ENGAGEMENT" })).toEqual({ createdCount: 1, skippedCount: 7 });
  });
  it("rejects viewers and nonmembers and never writes another workspace", async () => {
    const owner = await fixture(); const other = await fixture();
    await expect(applyWeddingTaskTemplate(owner.workspace.id, other.user.id, { templateKey: "RECEPTION" })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await prisma.membership.create({ data: { workspaceId: owner.workspace.id, userId: other.user.id, role: "VIEWER" } });
    await expect(applyWeddingTaskTemplate(owner.workspace.id, other.user.id, { templateKey: "RECEPTION" })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(await prisma.weddingTask.count({ where: { workspaceId: owner.workspace.id } })).toBe(0);
  });
});
