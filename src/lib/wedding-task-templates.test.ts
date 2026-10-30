import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { WEDDING_TASK_TEMPLATES } from "@/domain/wedding-task-templates";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), access: vi.fn(), find: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.access }));
import { applyWeddingTaskTemplate } from "./wedding-task-templates";
const tx = { weddingTask: { findMany: mocks.find, createMany: mocks.create } };
describe("wedding task templates", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.transaction.mockImplementation(async (operation) => operation(tx));
    mocks.find.mockResolvedValue([]); mocks.create.mockResolvedValue({ count: 8 });
  });
  it("separates engagement and reception and uses unique stable keys", () => {
    expect(WEDDING_TASK_TEMPLATES.map((template) => template.key)).toEqual(["ENGAGEMENT", "RECEPTION"]);
    const keys = WEDDING_TASK_TEMPLATES.flatMap((template) => template.tasks.map((task) => task.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(WEDDING_TASK_TEMPLATES[0].tasks).toHaveLength(8);
    expect(WEDDING_TASK_TEMPLATES[1].tasks).toHaveLength(10);
  });
  it("checks locked membership and creates TODO shared tasks without invented dates", async () => {
    expect(await applyWeddingTaskTemplate("workspace", "authenticated", { templateKey: "ENGAGEMENT" })).toEqual({ createdCount: 8, skippedCount: 0 });
    expect(mocks.access).toHaveBeenCalledWith("workspace", "authenticated", "edit", tx);
    expect(mocks.create).toHaveBeenCalledWith({ data: WEDDING_TASK_TEMPLATES[0].tasks.map((task) => ({ workspaceId: "workspace", templateKey: task.key,
      title: task.title, description: task.description, dueDate: null, side: "SHARED", status: "TODO" })), skipDuplicates: true });
  });
  it("keeps renamed and completed template tasks and skips same-title manual tasks", async () => {
    const template = WEDDING_TASK_TEMPLATES[0];
    mocks.find.mockResolvedValue([{ title: "已由使用者改名", templateKey: template.tasks[0].key }, { title: template.tasks[1].title, templateKey: null }]);
    mocks.create.mockResolvedValue({ count: 6 });
    expect(await applyWeddingTaskTemplate("workspace", "authenticated", { templateKey: "ENGAGEMENT" })).toEqual({ createdCount: 6, skippedCount: 2 });
    expect(mocks.create.mock.calls[0][0].data).toHaveLength(6);
    expect(mocks.create.mock.calls[0][0].data.some((task: { templateKey: string }) => task.templateKey === template.tasks[0].key)).toBe(false);
  });
  it("reports existing templates without writing again", async () => {
    mocks.find.mockResolvedValue(WEDDING_TASK_TEMPLATES[0].tasks.map((task) => ({ title: "edited", templateKey: task.key })));
    expect(await applyWeddingTaskTemplate("workspace", "authenticated", { templateKey: "ENGAGEMENT" })).toEqual({ createdCount: 0, skippedCount: 8 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{ templateKey: "UNKNOWN" }, { templateKey: "ENGAGEMENT", userId: "forged" }, { templateKey: "ENGAGEMENT", dueDate: "2026-01-01" }])("rejects invalid or forged template input %s", async (body) => {
    await expect(applyWeddingTaskTemplate("workspace", "authenticated", body)).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not create tasks for viewers or nonmembers", async () => {
    mocks.access.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(applyWeddingTaskTemplate("workspace", "viewer", { templateKey: "RECEPTION" })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
});
