import { beforeEach, describe, expect, it, vi } from "vitest";
import { weddingStaffTimelineAssignmentFingerprint } from "@/domain/wedding-staff-timeline-snapshot";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  create,
  findFirst,
  updateMany,
  deleteMany,
  queryRaw,
  transaction,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

const transactionClient = {
  weddingStaffAssignment: { create, findFirst, updateMany, deleteMany },
  $queryRaw: queryRaw,
};

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    weddingStaffAssignment: { create, findFirst, updateMany, deleteMany },
    $transaction: transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createWeddingStaffAction,
  setWeddingStaffRedEnvelopeSentAction,
  deleteWeddingStaffAction,
  updateWeddingStaffAction,
} from "./wedding-staff";

const idleState = { status: "idle" as const };
const emptyTimelineAssignmentFingerprint =
  weddingStaffTimelineAssignmentFingerprint([]);

function staffForm(expectedVersion?: string) {
  const form = new FormData();
  form.set("roleName", "  婚禮主持  ");
  form.set("personName", "  林小美  ");
  form.set("contactPhone", "  0912 345 678  ");
  form.set("notes", "  第一段\n  第二段  ");
  if (expectedVersion !== undefined) {
    form.set("expectedVersion", expectedVersion);
  }
  return form;
}

describe("wedding staff actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    create.mockResolvedValue({ id: "staff_1" });
    updateMany.mockResolvedValue({ count: 1 });
    deleteMany.mockResolvedValue({ count: 1 });
    queryRaw.mockImplementation(async (statement) => {
      const sql = Array.isArray(statement?.strings)
        ? statement.strings.join(" ")
        : "";
      if (sql.includes('FROM "wedding_staff_assignments"')) {
        return [{ id: "staff_1" }];
      }
      if (sql.includes('FROM "wedding_timeline_staff_assignments"')) {
        return [];
      }
      return [];
    });
    transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  it("marks a red envelope as handed out with a server timestamp under version CAS", async () => {
    findFirst.mockResolvedValue({
      redEnvelopeAmount: 3600,
      redEnvelopeSentAt: null,
      version: 2,
    });
    const form = new FormData();
    form.set("expectedVersion", "2");
    form.set("redEnvelopeSent", "on");
    // client 送來的時間一律忽略。
    form.set("redEnvelopeSentAt", "1999-01-01T00:00:00.000Z");

    await expect(
      setWeddingStaffRedEnvelopeSentAction(
        "workspace_1",
        "staff_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({
      status: "success",
      message: "已標記紅包為已發放。",
    });

    const update = updateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: { redEnvelopeSentAt: Date | null };
    };
    expect(update.where).toEqual({
      id: "staff_1",
      workspaceId: "workspace_1",
      version: 2,
    });
    expect(update.data.redEnvelopeSentAt).toBeInstanceOf(Date);
    expect(update.data.redEnvelopeSentAt?.getFullYear()).toBeGreaterThan(2000);
  });

  it("keeps the original handout time when the same envelope is marked again", async () => {
    const original = new Date("2026-09-01T02:00:00.000Z");
    findFirst.mockResolvedValue({
      redEnvelopeAmount: 3600,
      redEnvelopeSentAt: original,
      version: 2,
    });
    const form = new FormData();
    form.set("expectedVersion", "2");
    form.set("redEnvelopeSent", "on");

    await expect(
      setWeddingStaffRedEnvelopeSentAction(
        "workspace_1",
        "staff_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      (updateMany.mock.calls[0]?.[0] as { data: { redEnvelopeSentAt: Date } })
        .data.redEnvelopeSentAt,
    ).toBe(original);
  });

  it("refuses to mark a red envelope that has no amount", async () => {
    findFirst.mockResolvedValue({
      redEnvelopeAmount: null,
      redEnvelopeSentAt: null,
      version: 2,
    });
    const form = new FormData();
    form.set("expectedVersion", "2");
    form.set("redEnvelopeSent", "on");

    await expect(
      setWeddingStaffRedEnvelopeSentAction(
        "workspace_1",
        "staff_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({
      status: "error",
      code: "VALIDATION",
      message: "請先填寫紅包金額，再標記為已發放。",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuses a handout update whose expected version no longer matches", async () => {
    findFirst.mockResolvedValue({
      redEnvelopeAmount: 3600,
      redEnvelopeSentAt: null,
      version: 5,
    });
    const form = new FormData();
    form.set("expectedVersion", "2");
    form.set("redEnvelopeSent", "on");

    await expect(
      setWeddingStaffRedEnvelopeSentAction(
        "workspace_1",
        "staff_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(["yes", "1", "true"])(
    "rejects the forged handout flag %j before opening a transaction",
    async (value) => {
      const form = new FormData();
      form.set("expectedVersion", "2");
      form.set("redEnvelopeSent", value);

      await expect(
        setWeddingStaffRedEnvelopeSentAction(
          "workspace_1",
          "staff_1",
          idleState,
          form,
        ),
      ).resolves.toMatchObject({
        status: "error",
        code: "VALIDATION",
        message: "紅包發放狀態無效，請重新整理後再試。",
      });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("refuses a handout update for a viewer without opening a transaction", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    const form = new FormData();
    form.set("expectedVersion", "2");

    await expect(
      setWeddingStaffRedEnvelopeSentAction(
        "workspace_1",
        "staff_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("authorizes, ignores forged ownership, and creates scoped staff", async () => {
    const form = staffForm();
    form.set("workspaceId", "workspace_attacker");
    form.set("userId", "attacker");
    form.set("version", "99");
    await expect(
      createWeddingStaffAction("workspace_1", idleState, form),
    ).resolves.toMatchObject({ status: "success" });
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        roleName: "婚禮主持",
        personName: "林小美",
        contactPhone: "0912 345 678",
        notes: "第一段\n  第二段",
        mealCount: null,
        vegetarianMealCount: null,
        redEnvelopeAmount: null,
      },
    });
    expect(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    ).toBeLessThan(create.mock.invocationCallOrder[0]);
  });

  it("denies VIEWER before validation and writes", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(
      createWeddingStaffAction("workspace_1", idleState, new FormData()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(create).not.toHaveBeenCalled();
  });

  it("denies a staff mutation revoked after the early guard without writing", async () => {
    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      createWeddingStaffAction("workspace_1", idleState, staffForm()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(requireWorkspaceAccess).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates and deletes with id + workspaceId + version CAS", async () => {
    await expect(
      updateWeddingStaffAction(
        "workspace_1",
        "staff_1",
        idleState,
        staffForm("4"),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "staff_1", workspaceId: "workspace_1", version: 4 },
      data: {
        roleName: "婚禮主持",
        personName: "林小美",
        contactPhone: "0912 345 678",
        notes: "第一段\n  第二段",
        mealCount: null,
        vegetarianMealCount: null,
        redEnvelopeAmount: null,
        version: { increment: 1 },
      },
    });

    const deleteForm = new FormData();
    deleteForm.set("expectedVersion", "5");
    deleteForm.set(
      "expectedTimelineAssignmentFingerprint",
      emptyTimelineAssignmentFingerprint,
    );
    await deleteWeddingStaffAction(
      "workspace_1",
      "staff_1",
      idleState,
      deleteForm,
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "staff_1", workspaceId: "workspace_1", version: 5 },
    });
    const lockSql = queryRaw.mock.calls.map(([statement]) =>
      Array.isArray(statement?.strings) ? statement.strings.join(" ") : "",
    );
    expect(
      lockSql.find((sql) => sql.includes('FROM "wedding_staff_assignments"')),
    ).toMatch(/"workspace_id"[\s\S]*"version"[\s\S]*FOR UPDATE/u);
    expect(
      lockSql.find((sql) =>
        sql.includes('FROM "wedding_timeline_staff_assignments"'),
      ),
    ).toMatch(/"workspace_id"[\s\S]*FOR UPDATE/u);
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces/workspace_1/staff");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/timeline",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/overview",
    );
  });

  it("returns STALE when the scoped CAS misses", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateWeddingStaffAction(
        "workspace_1",
        "foreign_staff",
        idleState,
        staffForm("2"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate a stale delete into a fresh CAS token", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    const form = new FormData();
    form.set("expectedVersion", "5");
    form.set(
      "expectedTimelineAssignmentFingerprint",
      emptyTimelineAssignmentFingerprint,
    );

    await expect(
      deleteWeddingStaffAction(
        "workspace_1",
        "staff_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects deletion when timeline assignments changed after confirmation", async () => {
    queryRaw.mockImplementation(async (statement) => {
      const sql = Array.isArray(statement?.strings)
        ? statement.strings.join(" ")
        : "";
      if (sql.includes('FROM "wedding_staff_assignments"')) {
        return [{ id: "staff_1" }];
      }
      if (sql.includes('FROM "wedding_timeline_staff_assignments"')) {
        return [{ timelineItemId: "timeline_new" }];
      }
      return [];
    });
    const form = new FormData();
    form.set("expectedVersion", "5");
    form.set(
      "expectedTimelineAssignmentFingerprint",
      emptyTimelineAssignmentFingerprint,
    );

    await expect(
      deleteWeddingStaffAction(
        "workspace_1",
        "staff_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps committed success and attempts every view when cache revalidation fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("sensitive cache internals");
    });

    await expect(
      createWeddingStaffAction("workspace_1", idleState, staffForm()),
    ).resolves.toEqual({
      status: "success",
      message:
        "已新增婚禮工作人員；畫面未自動更新，請重新整理。",
    });
    expect(revalidatePath).toHaveBeenNthCalledWith(
      1,
      "/workspaces/workspace_1/staff",
    );
    expect(revalidatePath).toHaveBeenNthCalledWith(
      2,
      "/workspaces/workspace_1/timeline",
    );
    expect(revalidatePath).toHaveBeenNthCalledWith(
      3,
      "/workspaces/workspace_1/overview",
    );
    expect(log).toHaveBeenCalledWith("婚禮工作人員頁面重新驗證失敗。");
    expect(log.mock.calls.every((call) => call.length === 1)).toBe(true);
    log.mockRestore();
  });
});
