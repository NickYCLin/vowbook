import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const authState = vi.hoisted(() => ({ userId: "" }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({ id: authState.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  changeWeddingTaskStatusAction,
  createWeddingTaskAction,
  deleteWeddingTaskAction,
  updateWeddingTaskAction,
} from "@/actions/wedding-tasks";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { getWeddingTaskList } from "@/lib/wedding-task-list";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const idleState = { status: "idle" as const };
let sequence = 0;

function detailsForm({
  title = "確認婚宴流程",
  description = "真 PostgreSQL integration",
  dueDate = "2028-02-29",
  expectedVersion,
}: {
  title?: string;
  description?: string;
  dueDate?: string;
  expectedVersion?: number;
} = {}): FormData {
  const formData = new FormData();
  formData.set("title", title);
  formData.set("description", description);
  formData.set("dueDate", dueDate);
  if (expectedVersion !== undefined) {
    formData.set("expectedVersion", String(expectedVersion));
  }
  return formData;
}

function versionForm(expectedVersion: number): FormData {
  const formData = new FormData();
  formData.set("expectedVersion", String(expectedVersion));
  return formData;
}

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      googleSubject: `tasks-it-${label}-${sequence}`,
      email: `tasks-it-${label}-${sequence}@example.test`,
    },
  });
}

async function createWorkspaceForUser(userId: string, label: string) {
  return prisma.weddingWorkspace.create({
    data: {
      name: label,
      createdById: userId,
      memberships: { create: { userId, role: "OWNER" } },
    },
  });
}

async function createOwnerWorkspace(label = "任務 integration") {
  const user = await createUser("owner");
  const workspace = await createWorkspaceForUser(user.id, label);
  authState.userId = user.id;
  return { user, workspace };
}

describeDatabase.sequential("PostgreSQL wedding-task invariants", () => {
  beforeEach(async () => {
    revalidatePath.mockClear();
    await prisma.weddingWorkspace.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (runDatabaseIntegration) {
      await prisma.weddingWorkspace.deleteMany();
      await prisma.user.deleteMany();
    }
    await prisma.$disconnect();
  });

  it("applies DATE, enum, constraints, index, and workspace cascade in PostgreSQL", async () => {
    const { workspace } = await createOwnerWorkspace();

    const dueDateColumn = await prisma.$queryRaw<
      Array<{ data_type: string; udt_name: string }>
    >`SELECT data_type, udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'wedding_tasks' AND column_name = 'due_date'`;
    expect(dueDateColumn).toEqual([{ data_type: "date", udt_name: "date" }]);

    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'wedding_tasks'::regclass
      ORDER BY conname
    `;
    const names = constraints.map((constraint) => constraint.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        "wedding_tasks_description_check",
        "wedding_tasks_status_completed_at_check",
        "wedding_tasks_title_check",
        "wedding_tasks_version_check",
        "wedding_tasks_workspace_id_fkey",
      ]),
    );
    expect(
      await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'wedding_tasks_ws_status_due_created_id_idx'
        ) AS exists
      `,
    ).toEqual([{ exists: true }]);

    const valid = await prisma.weddingTask.create({
      data: {
        workspaceId: workspace.id,
        title: "合法任務",
        dueDate: new Date("2028-02-29T00:00:00.000Z"),
      },
    });
    expect(valid.dueDate?.toISOString().slice(0, 10)).toBe("2028-02-29");

    await expect(
      prisma.weddingTask.create({
        data: { workspaceId: workspace.id, title: " 前後空白 " },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.weddingTask.create({
        data: {
          workspaceId: workspace.id,
          title: "過長說明",
          description: "說".repeat(1001),
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.weddingTask.create({
        data: { workspaceId: workspace.id, title: "錯誤完成", status: "DONE" },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.weddingTask.create({
        data: {
          workspaceId: workspace.id,
          title: "錯誤待辦",
          status: "TODO",
          completedAt: new Date(),
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.weddingTask.create({
        data: { workspaceId: workspace.id, title: "錯誤版本", version: -1 },
      }),
    ).rejects.toBeDefined();

    await prisma.weddingWorkspace.delete({ where: { id: workspace.id } });
    expect(await prisma.weddingTask.count()).toBe(0);
  });

  it("enforces editor, VIEWER, outsider, and forged cross-workspace boundaries", async () => {
    const owner = await createOwnerWorkspace("第一工作區");
    const secondWorkspace = await createWorkspaceForUser(owner.user.id, "第二工作區");

    await expect(
      createWeddingTaskAction(owner.workspace.id, idleState, detailsForm()),
    ).resolves.toMatchObject({ status: "success" });

    const foreignTask = await prisma.weddingTask.create({
      data: { workspaceId: secondWorkspace.id, title: "第二工作區任務" },
    });
    await expect(
      updateWeddingTaskAction(
        owner.workspace.id,
        foreignTask.id,
        idleState,
        detailsForm({ title: "偽造更新", expectedVersion: 0 }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(
      await prisma.weddingTask.findUniqueOrThrow({ where: { id: foreignTask.id } }),
    ).toMatchObject({ title: "第二工作區任務", workspaceId: secondWorkspace.id });

    const viewer = await createUser("viewer");
    await prisma.membership.create({
      data: { workspaceId: owner.workspace.id, userId: viewer.id, role: "VIEWER" },
    });
    authState.userId = viewer.id;
    await expect(
      createWeddingTaskAction(owner.workspace.id, idleState, new FormData()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    const outsider = await createUser("outsider");
    authState.userId = outsider.id;
    await expect(getWeddingTaskList(owner.workspace.id)).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
    await expect(
      deleteWeddingTaskAction(
        owner.workspace.id,
        foreignTask.id,
        idleState,
        versionForm(0),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
  });

  it("allows at most one mutation for a shared optimistic version", async () => {
    const { workspace } = await createOwnerWorkspace();
    const task = await prisma.weddingTask.create({
      data: { workspaceId: workspace.id, title: "並行任務" },
    });

    const results = await Promise.all([
      updateWeddingTaskAction(
        workspace.id,
        task.id,
        idleState,
        detailsForm({ title: "內容更新勝出", expectedVersion: 0 }),
      ),
      changeWeddingTaskStatusAction(
        workspace.id,
        task.id,
        "DONE",
        idleState,
        versionForm(0),
      ),
    ]);

    expect(results.filter((result) => result.status === "success")).toHaveLength(1);
    expect(results.find((result) => result.code === "STALE")).toBeDefined();
    const stored = await prisma.weddingTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(stored.version).toBe(1);
    expect(stored.status === "DONE").toBe(stored.completedAt !== null);

    await expect(
      deleteWeddingTaskAction(workspace.id, task.id, idleState, versionForm(0)),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(await prisma.weddingTask.count({ where: { id: task.id } })).toBe(1);
  });

  it("keeps completedAt atomic and preserves it for DONE to DONE", async () => {
    const { workspace } = await createOwnerWorkspace();
    const task = await prisma.weddingTask.create({
      data: { workspaceId: workspace.id, title: "狀態任務" },
    });

    await expect(
      changeWeddingTaskStatusAction(
        workspace.id,
        task.id,
        "DONE",
        idleState,
        versionForm(0),
      ),
    ).resolves.toMatchObject({ status: "success" });
    const done = await prisma.weddingTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(done).toMatchObject({ status: "DONE", version: 1 });
    expect(done.completedAt).not.toBeNull();

    await expect(
      changeWeddingTaskStatusAction(
        workspace.id,
        task.id,
        "DONE",
        idleState,
        versionForm(1),
      ),
    ).resolves.toMatchObject({ status: "success" });
    const doneAgain = await prisma.weddingTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(doneAgain).toMatchObject({ status: "DONE", version: 2 });
    expect(doneAgain.completedAt?.toISOString()).toBe(done.completedAt?.toISOString());

    await expect(
      changeWeddingTaskStatusAction(
        workspace.id,
        task.id,
        "IN_PROGRESS",
        idleState,
        versionForm(2),
      ),
    ).resolves.toMatchObject({ status: "success" });
    const active = await prisma.weddingTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(active).toMatchObject({ status: "IN_PROGRESS", version: 3, completedAt: null });

    await expect(
      deleteWeddingTaskAction(workspace.id, task.id, idleState, versionForm(3)),
    ).resolves.toMatchObject({ status: "success" });
    expect(await prisma.weddingTask.count({ where: { id: task.id } })).toBe(0);
  });

  it("serializes edit, delete, and DONE races with one shared version", async () => {
    const { workspace } = await createOwnerWorkspace();

    const editEdit = await prisma.weddingTask.create({
      data: { workspaceId: workspace.id, title: "edit-vs-edit" },
    });
    const editEditResults = await Promise.all([
      updateWeddingTaskAction(
        workspace.id,
        editEdit.id,
        idleState,
        detailsForm({ title: "第一個編輯", expectedVersion: 0 }),
      ),
      updateWeddingTaskAction(
        workspace.id,
        editEdit.id,
        idleState,
        detailsForm({ title: "第二個編輯", expectedVersion: 0 }),
      ),
    ]);
    expect(editEditResults.filter((result) => result.status === "success")).toHaveLength(1);
    expect(editEditResults.find((result) => result.code === "STALE")).toBeDefined();
    expect(
      await prisma.weddingTask.findUniqueOrThrow({ where: { id: editEdit.id } }),
    ).toMatchObject({ version: 1, status: "TODO", completedAt: null });

    const editDelete = await prisma.weddingTask.create({
      data: { workspaceId: workspace.id, title: "edit-vs-delete" },
    });
    const editDeleteResults = await Promise.all([
      updateWeddingTaskAction(
        workspace.id,
        editDelete.id,
        idleState,
        detailsForm({ title: "編輯可能勝出", expectedVersion: 0 }),
      ),
      deleteWeddingTaskAction(
        workspace.id,
        editDelete.id,
        idleState,
        versionForm(0),
      ),
    ]);
    expect(editDeleteResults.filter((result) => result.status === "success")).toHaveLength(1);
    expect(editDeleteResults.find((result) => result.code === "STALE")).toBeDefined();
    const editDeleteStored = await prisma.weddingTask.findUnique({
      where: { id: editDelete.id },
    });
    if (editDeleteStored) {
      expect(editDeleteStored).toMatchObject({ version: 1, completedAt: null });
    }

    const statusDelete = await prisma.weddingTask.create({
      data: { workspaceId: workspace.id, title: "status-vs-delete" },
    });
    const statusDeleteResults = await Promise.all([
      changeWeddingTaskStatusAction(
        workspace.id,
        statusDelete.id,
        "DONE",
        idleState,
        versionForm(0),
      ),
      deleteWeddingTaskAction(
        workspace.id,
        statusDelete.id,
        idleState,
        versionForm(0),
      ),
    ]);
    expect(statusDeleteResults.filter((result) => result.status === "success")).toHaveLength(1);
    expect(statusDeleteResults.find((result) => result.code === "STALE")).toBeDefined();
    const statusDeleteStored = await prisma.weddingTask.findUnique({
      where: { id: statusDelete.id },
    });
    if (statusDeleteStored) {
      expect(statusDeleteStored).toMatchObject({ status: "DONE", version: 1 });
      expect(statusDeleteStored.completedAt).not.toBeNull();
    }

    const originalCompletedAt = new Date("2027-02-15T08:09:10.000Z");
    const doneDone = await prisma.weddingTask.create({
      data: {
        workspaceId: workspace.id,
        title: "done-vs-done",
        status: "DONE",
        completedAt: originalCompletedAt,
      },
    });
    const doneDoneResults = await Promise.all([
      changeWeddingTaskStatusAction(
        workspace.id,
        doneDone.id,
        "DONE",
        idleState,
        versionForm(0),
      ),
      changeWeddingTaskStatusAction(
        workspace.id,
        doneDone.id,
        "DONE",
        idleState,
        versionForm(0),
      ),
    ]);
    expect(doneDoneResults.filter((result) => result.status === "success")).toHaveLength(1);
    expect(doneDoneResults.find((result) => result.code === "STALE")).toBeDefined();
    const doneDoneStored = await prisma.weddingTask.findUniqueOrThrow({
      where: { id: doneDone.id },
    });
    expect(doneDoneStored).toMatchObject({ status: "DONE", version: 1 });
    expect(doneDoneStored.completedAt?.toISOString()).toBe(
      originalCompletedAt.toISOString(),
    );
  });

  it("orders mixed active tasks by date and id, keeps null last, and appends DONE", async () => {
    const { workspace } = await createOwnerWorkspace();
    const createdAt = new Date("2027-01-01T00:00:00.000Z");
    await prisma.weddingTask.createMany({
      data: [
        {
          id: "task_active_b",
          workspaceId: workspace.id,
          title: "進行中 B",
          status: "IN_PROGRESS",
          dueDate: new Date("2027-04-01T00:00:00.000Z"),
          createdAt,
        },
        {
          id: "task_active_a",
          workspaceId: workspace.id,
          title: "待辦 A",
          status: "TODO",
          dueDate: new Date("2027-04-01T00:00:00.000Z"),
          createdAt,
        },
        {
          id: "task_active_null",
          workspaceId: workspace.id,
          title: "無日期",
          status: "TODO",
          dueDate: null,
          createdAt,
        },
        {
          id: "task_done",
          workspaceId: workspace.id,
          title: "已完成",
          status: "DONE",
          dueDate: new Date("2027-01-01T00:00:00.000Z"),
          completedAt: new Date("2027-01-02T00:00:00.000Z"),
          createdAt,
        },
      ],
    });

    const data = await getWeddingTaskList(workspace.id);
    expect(data.tasks.map((task) => task.id)).toEqual([
      "task_active_a",
      "task_active_b",
      "task_active_null",
      "task_done",
    ]);
    expect(data.tasks[0].dueDate).toBe("2027-04-01");
    expect(data.tasks[2].dueDate).toBeNull();
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});
