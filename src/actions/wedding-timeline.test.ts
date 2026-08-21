import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  transaction,
  staffFindMany,
  timelineCreate,
  timelineCreateMany,
  timelineUpdateMany,
  timelineDeleteMany,
  timelineCount,
  assignmentDeleteMany,
  assignmentCreateMany,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  transaction: vi.fn(),
  staffFindMany: vi.fn(),
  timelineCreate: vi.fn(),
  timelineCreateMany: vi.fn(),
  timelineUpdateMany: vi.fn(),
  timelineDeleteMany: vi.fn(),
  timelineCount: vi.fn(),
  assignmentDeleteMany: vi.fn(),
  assignmentCreateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

const transactionClient = {
  weddingStaffAssignment: { findMany: staffFindMany },
  weddingTimelineItem: {
    create: timelineCreate,
    createMany: timelineCreateMany,
    updateMany: timelineUpdateMany,
    deleteMany: timelineDeleteMany,
    count: timelineCount,
  },
  weddingTimelineStaffAssignment: {
    deleteMany: assignmentDeleteMany,
    createMany: assignmentCreateMany,
  },
};

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  applyGeneralLunchTimelineTemplateAction,
  createWeddingTimelineItemAction,
  deleteWeddingTimelineItemAction,
  updateWeddingTimelineItemAction,
} from "./wedding-timeline";

const idleState = { status: "idle" as const };

function timelineForm(expectedVersion?: string) {
  const form = new FormData();
  form.set("startTime", "11:30");
  form.set("endTime", "12:00");
  form.set("phase", "迎賓");
  form.set("title", "賓客入場");
  form.set("location", "宴會廳外");
  form.set("details", "依序引導");
  form.set("mediaCue", "  迎賓音樂\n開場影片  ");
  form.set("notes", "留意長輩");
  form.append("staffIds", "staff_1");
  form.append("staffIds", "staff_2");
  if (expectedVersion !== undefined) {
    form.set("expectedVersion", expectedVersion);
  }
  return form;
}

describe("wedding timeline actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    staffFindMany.mockResolvedValue([{ id: "staff_1" }, { id: "staff_2" }]);
    timelineCreate.mockResolvedValue({ id: "item_1" });
    timelineCreateMany.mockResolvedValue({ count: 9 });
    timelineUpdateMany.mockResolvedValue({ count: 1 });
    timelineDeleteMany.mockResolvedValue({ count: 1 });
    timelineCount.mockResolvedValue(0);
    assignmentDeleteMany.mockResolvedValue({ count: 2 });
    assignmentCreateMany.mockResolvedValue({ count: 2 });
    transaction.mockImplementation(
      async (callback: (client: unknown) => Promise<unknown>) =>
        callback(transactionClient),
    );
  });

  it("revalidates every submitted staff ID in the same transaction and workspace", async () => {
    await expect(
      createWeddingTimelineItemAction(
        "workspace_1",
        idleState,
        timelineForm(),
      ),
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
    expect(staffFindMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        id: { in: ["staff_1", "staff_2"] },
      },
      select: { id: true },
    });
    expect(timelineCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        startMinute: 690,
        endMinute: 720,
        mediaCue: "迎賓音樂\n開場影片",
        staffAssignments: {
          create: [
            { staffAssignmentId: "staff_1" },
            { staffAssignmentId: "staff_2" },
          ],
        },
      }),
    });
    expect(
      requireLockedWorkspaceAccess.mock.invocationCallOrder[0],
    ).toBeLessThan(staffFindMany.mock.invocationCallOrder[0]);
    expect(staffFindMany.mock.invocationCallOrder[0]).toBeLessThan(
      timelineCreate.mock.invocationCallOrder[0],
    );
  });

  it("rejects a forged cross-workspace staff ID without a partial write", async () => {
    staffFindMany.mockResolvedValue([{ id: "staff_1" }]);
    await expect(
      createWeddingTimelineItemAction(
        "workspace_1",
        idleState,
        timelineForm(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(timelineCreate).not.toHaveBeenCalled();
  });

  it("denies a timeline mutation revoked after the early guard without writing", async () => {
    requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      createWeddingTimelineItemAction(
        "workspace_1",
        idleState,
        timelineForm(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(requireWorkspaceAccess).toHaveBeenCalled();
    expect(staffFindMany).not.toHaveBeenCalled();
    expect(timelineCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates the item CAS and replaces assignments in the same transaction", async () => {
    await expect(
      updateWeddingTimelineItemAction(
        "workspace_1",
        "item_1",
        idleState,
        timelineForm("4"),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(timelineUpdateMany).toHaveBeenCalledWith({
      where: { id: "item_1", workspaceId: "workspace_1", version: 4 },
      data: expect.objectContaining({
        mediaCue: "迎賓音樂\n開場影片",
        version: { increment: 1 },
      }),
    });
    expect(assignmentDeleteMany).toHaveBeenCalledWith({
      where: { timelineItemId: "item_1", workspaceId: "workspace_1" },
    });
    expect(assignmentCreateMany).toHaveBeenCalledWith({
      data: [
        {
          timelineItemId: "item_1",
          staffAssignmentId: "staff_1",
          workspaceId: "workspace_1",
        },
        {
          timelineItemId: "item_1",
          staffAssignmentId: "staff_2",
          workspaceId: "workspace_1",
        },
      ],
    });
  });

  it("does not touch assignments when the timeline CAS misses", async () => {
    timelineUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      updateWeddingTimelineItemAction(
        "workspace_1",
        "item_1",
        idleState,
        timelineForm("4"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    expect(staffFindMany).not.toHaveBeenCalled();
    expect(assignmentDeleteMany).not.toHaveBeenCalled();
    expect(assignmentCreateMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate a stale delete into a fresh CAS token", async () => {
    timelineDeleteMany.mockResolvedValueOnce({ count: 0 });
    const form = new FormData();
    form.set("expectedVersion", "3");

    await expect(
      deleteWeddingTimelineItemAction(
        "workspace_1",
        "item_1",
        idleState,
        form,
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("denies VIEWER before validation and uses scoped CAS delete", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      createWeddingTimelineItemAction(
        "workspace_1",
        idleState,
        new FormData(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(transaction).not.toHaveBeenCalled();

    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: {},
    });
    const form = new FormData();
    form.set("expectedVersion", "3");
    await deleteWeddingTimelineItemAction(
      "workspace_1",
      "item_1",
      idleState,
      form,
    );
    expect(timelineDeleteMany).toHaveBeenCalledWith({
      where: { id: "item_1", workspaceId: "workspace_1", version: 3 },
    });
  });

  it("creates the de-identified detailed lunch template when empty", async () => {
    await expect(
      applyGeneralLunchTimelineTemplateAction("workspace_1", idleState),
    ).resolves.toMatchObject({
      status: "success",
      message: expect.stringContaining("詳細午宴流程範本"),
    });
    expect(timelineCount).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
    });
    const templateData = timelineCreateMany.mock.calls[0]?.[0]?.data;
    expect(templateData).toHaveLength(9);
    const projection = templateData.map(
      ({
        startMinute,
        endMinute,
        title,
        details,
        mediaCue,
        notes,
      }: {
        startMinute: number;
        endMinute: number | null;
        title: string;
        details: string | null;
        mediaCue: string | null;
        notes: string | null;
      }) => ({ startMinute, endMinute, title, details, mediaCue, notes }),
    );
    expect(projection).toEqual([
      {
        startMinute: 570,
        endMinute: 600,
        title: "前置作業",
        details:
          "主持人報到並與新人確認當日流程。\n09:40 第一次進場彩排。\n彩排後安排拍攝與休息。",
        mediaCue: "音樂、燈光一起",
        notes: "與場館影音及小管家確認",
      },
      {
        startMinute: 600,
        endMinute: 630,
        title: "拍照時間",
        details: "宴會廳拍攝與休息。\n10:25 移動至儀式空間。",
        mediaCue: "迎賓音樂",
        notes: null,
      },
      {
        startMinute: 630,
        endMinute: 680,
        title: "證婚儀式",
        details:
          "主持人開場。\n新郎進場。\n新娘持捧花進場。\n趣味宣誓。\n交換戒指（新郎先）。\n謝親恩。\n大合照。\n11:20 換裝。",
        mediaCue:
          "01 新郎進場、02 新娘進場、03 宣誓／交換戒指、04 謝親恩",
        notes: "待確認：捧花、麥克風、戒指戒盒、感謝詞及合照順序。",
      },
      {
        startMinute: 690,
        endMinute: 720,
        title: "迎賓",
        details: "收禮與招待就位。\n宣傳拍貼活動。\n開始前 5 分鐘預告。",
        mediaCue: "婚紗輪播、迎賓音樂",
        notes: null,
      },
      {
        startMinute: 720,
        endMinute: 740,
        title: "第一次進場",
        details:
          "花童進場。\n雙方主婚人進場。\n新人持捧花進場。\n邀請雙方主婚人上台。\n舉杯感謝。\n入席開餐。",
        mediaCue: "01 小花童進場、02 雙方主婚人進場、03 新人進場、04 舉杯",
        notes: "準備捧花與酒杯 6 杯。",
      },
      {
        startMinute: 740,
        endMinute: 795,
        title: "用餐",
        details:
          "賓客用餐。\n新人於第二道菜前退場。\n主桌前拍全體大合照。\n換裝 25 分鐘。",
        mediaCue: "婚紗輪播、用餐音樂",
        notes: null,
      },
      {
        startMinute: 795,
        endMinute: 825,
        title: "第二次進場",
        details:
          "指定 Pose 拍照進場。\n以兩桌為單位合照。\n捧花遊戲。\n花椰菜遊戲。\n全場快問快答（最多 8 題，每題 10 秒）。\n入席準備敬酒。",
        mediaCue: "05 新人二進、06 捧花遊戲、07 花椰菜遊戲、08 全場遊戲",
        notes:
          "準備 Pose 簡報、遊戲簡報／道具、主題禮物、分貝機、酒杯 6 杯。",
      },
      {
        startMinute: 825,
        endMinute: 870,
        title: "敬酒",
        details: "賓客用餐並逐桌敬酒。\n結束後換裝 25 分鐘。",
        mediaCue: "婚紗輪播、敬酒音樂",
        notes: "場館人員協助引導",
      },
      {
        startMinute: 870,
        endMinute: null,
        title: "送客",
        details: "主持廣播婚宴圓滿完成。\n新人於拍照區等候送客。",
        mediaCue: "送客音樂",
        notes: "準備喜糖與提籃",
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/timeline",
    );
  });

  it("refuses to duplicate the general template when the timeline is not empty", async () => {
    timelineCount.mockResolvedValueOnce(1);

    await expect(
      applyGeneralLunchTimelineTemplateAction("workspace_1", idleState),
    ).resolves.toMatchObject({
      status: "error",
      code: "CONFLICT",
      message: expect.stringContaining("詳細午宴流程範本"),
    });
    expect(timelineCreateMany).not.toHaveBeenCalled();
  });
});
