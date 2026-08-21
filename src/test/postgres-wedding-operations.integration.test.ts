import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";

const authState = vi.hoisted(() => ({ userId: "" }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({ id: authState.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createWeddingStaffAction,
  deleteWeddingStaffAction,
  updateWeddingStaffAction,
} from "@/actions/wedding-staff";
import {
  applyGeneralLunchTimelineTemplateAction,
  createWeddingTimelineItemAction,
  deleteWeddingTimelineItemAction,
  updateWeddingTimelineItemAction,
} from "@/actions/wedding-timeline";
import { getWeddingTimelinePageData } from "@/lib/wedding-timeline-list";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const idleState = { status: "idle" as const };
let sequence = 0;

function staffForm(expectedVersion?: number) {
  const form = new FormData();
  form.set("roleName", "招待");
  form.set("personName", "小安");
  form.set("contactPhone", "0912 345 678");
  form.set("notes", "A 區");
  if (expectedVersion !== undefined) {
    form.set("expectedVersion", String(expectedVersion));
  }
  return form;
}

function timelineForm(staffIds: string[], expectedVersion?: number) {
  const form = new FormData();
  form.set("startTime", "11:30");
  form.set("endTime", "12:00");
  form.set("phase", "迎賓");
  form.set("title", "賓客入場");
  form.set("location", "宴會廳外");
  form.set("details", "依序引導");
  form.set("mediaCue", "  迎賓音樂\n開場影片  ");
  form.set("notes", "留意長輩");
  for (const staffId of staffIds) form.append("staffIds", staffId);
  if (expectedVersion !== undefined) {
    form.set("expectedVersion", String(expectedVersion));
  }
  return form;
}

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      googleSubject: `operations-it-${label}-${sequence}`,
      email: `operations-it-${label}-${sequence}@example.test`,
    },
  });
}

async function createWorkspaceForUser(userId: string, name: string) {
  return prisma.weddingWorkspace.create({
    data: {
      name,
      createdById: userId,
      memberships: { create: { userId, role: "OWNER" } },
    },
  });
}

async function createOwnerWorkspace(name = "婚宴營運 integration") {
  const user = await createUser("owner");
  const workspace = await createWorkspaceForUser(user.id, name);
  authState.userId = user.id;
  return { user, workspace };
}

describeDatabase.sequential("PostgreSQL wedding operations invariants", () => {
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

  it("enforces bounded checks, composite tenant FKs, indexes, and cascades", async () => {
    const owner = await createOwnerWorkspace("第一工作區");
    const second = await createWorkspaceForUser(owner.user.id, "第二工作區");
    const staff = await prisma.weddingStaffAssignment.create({
      data: {
        workspaceId: owner.workspace.id,
        roleName: "招待",
        personName: "小安",
      },
    });
    const foreignStaff = await prisma.weddingStaffAssignment.create({
      data: {
        workspaceId: second.id,
        roleName: "招待",
        personName: "小美",
      },
    });
    const item = await prisma.weddingTimelineItem.create({
      data: {
        workspaceId: owner.workspace.id,
        startMinute: 690,
        endMinute: 720,
        phase: "迎賓",
        title: "賓客入場",
      },
    });
    await prisma.weddingTimelineStaffAssignment.create({
      data: {
        workspaceId: owner.workspace.id,
        timelineItemId: item.id,
        staffAssignmentId: staff.id,
      },
    });
    await expect(
      prisma.weddingTimelineStaffAssignment.create({
        data: {
          workspaceId: owner.workspace.id,
          timelineItemId: item.id,
          staffAssignmentId: foreignStaff.id,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.weddingTimelineItem.create({
        data: {
          workspaceId: owner.workspace.id,
          startMinute: 720,
          endMinute: 720,
          phase: "午宴",
          title: "非法時間",
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.weddingStaffAssignment.create({
        data: {
          workspaceId: owner.workspace.id,
          roleName: "職".repeat(61),
          personName: "過長職務",
        },
      }),
    ).rejects.toBeDefined();

    const invalidStaffRows: Prisma.WeddingStaffAssignmentUncheckedCreateInput[] = [
      {
        workspaceId: owner.workspace.id,
        roleName: "\t",
        personName: "小安",
      },
      {
        workspaceId: owner.workspace.id,
        roleName: "主持",
        personName: "\n",
      },
      {
        workspaceId: owner.workspace.id,
        roleName: "\t主持\t",
        personName: "小安",
      },
      {
        workspaceId: owner.workspace.id,
        roleName: "主持",
        personName: "小安",
        contactPhone: "0".repeat(41),
      },
      {
        workspaceId: owner.workspace.id,
        roleName: "主持",
        personName: "小安",
        notes: "備".repeat(501),
      },
      {
        workspaceId: owner.workspace.id,
        roleName: "主持",
        personName: "小安",
        version: -1,
      },
    ];
    for (const data of invalidStaffRows) {
      await expect(
        prisma.weddingStaffAssignment.create({ data }),
      ).rejects.toBeDefined();
    }

    await expect(
      prisma.weddingTimelineItem.create({
        data: {
          workspaceId: owner.workspace.id,
          startMinute: 0,
          endMinute: 1439,
          phase: "全日",
          title: "合法邊界",
          mediaCue: "樂".repeat(500),
        },
      }),
    ).resolves.toBeDefined();

    const invalidTimelineRows: Prisma.WeddingTimelineItemUncheckedCreateInput[] = [
      {
        workspaceId: owner.workspace.id,
        startMinute: -1,
        phase: "迎賓",
        title: "非法開始",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 1440,
        phase: "迎賓",
        title: "非法開始",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        endMinute: 720,
        phase: "午宴",
        title: "非法結束",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "\t",
        title: "空白階段",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "\t午宴\t",
        title: "外圍空白",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "\n",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "過長地點",
        location: "地".repeat(121),
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "過長細節",
        details: "細".repeat(2001),
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "過長音樂影片",
        mediaCue: "樂".repeat(501),
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "空白音樂影片",
        mediaCue: "\t\n",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "前置空白音樂影片",
        mediaCue: "\t迎賓音樂",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "尾端空白音樂影片",
        mediaCue: "迎賓音樂\n",
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "過長備註",
        notes: "備".repeat(1001),
      },
      {
        workspaceId: owner.workspace.id,
        startMinute: 720,
        phase: "午宴",
        title: "非法版本",
        version: -1,
      },
    ];
    for (const data of invalidTimelineRows) {
      await expect(
        prisma.weddingTimelineItem.create({ data }),
      ).rejects.toBeDefined();
    }

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'wedding_staff_assignments_ws_role_person_created_id_idx',
          'wedding_timeline_items_ws_start_end_created_id_idx',
          'wedding_timeline_staff_ws_staff_item_idx'
        )
    `;
    expect(indexes).toHaveLength(3);

    const tenantForeignKeys = await prisma.$queryRaw<
      Array<{ name: string; bytes: number }>
    >`
      SELECT conname AS name, octet_length(conname) AS bytes
      FROM pg_constraint
      WHERE connamespace = current_schema()::regnamespace
        AND conname IN (
          'timeline_staff_timeline_ws_fkey',
          'timeline_staff_staff_ws_fkey'
        )
      ORDER BY conname
    `;
    expect(tenantForeignKeys.map((constraint) => constraint.name)).toEqual([
      "timeline_staff_staff_ws_fkey",
      "timeline_staff_timeline_ws_fkey",
    ]);
    expect(
      tenantForeignKeys.every((constraint) => constraint.bytes <= 63),
    ).toBe(true);

    await prisma.weddingWorkspace.delete({ where: { id: owner.workspace.id } });
    expect(
      await prisma.weddingTimelineStaffAssignment.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(0);
    expect(
      await prisma.weddingTimelineItem.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(0);
    expect(
      await prisma.weddingStaffAssignment.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(0);
  });

  it("enforces RBAC and staff CAS while removing assignments by cascade", async () => {
    const { user, workspace } = await createOwnerWorkspace();
    await expect(
      createWeddingStaffAction(workspace.id, idleState, staffForm()),
    ).resolves.toMatchObject({ status: "success" });
    const staff = await prisma.weddingStaffAssignment.findFirstOrThrow();
    const item = await prisma.weddingTimelineItem.create({
      data: {
        workspaceId: workspace.id,
        startMinute: 690,
        phase: "迎賓",
        title: "賓客入場",
        staffAssignments: {
          create: { staffAssignmentId: staff.id },
        },
      },
    });

    const viewer = await createUser("viewer");
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
    });
    authState.userId = viewer.id;
    await expect(
      updateWeddingStaffAction(
        workspace.id,
        staff.id,
        idleState,
        staffForm(0),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    authState.userId = user.id;
    const race = await Promise.all([
      updateWeddingStaffAction(
        workspace.id,
        staff.id,
        idleState,
        staffForm(0),
      ),
      deleteWeddingStaffAction(
        workspace.id,
        staff.id,
        idleState,
        (() => {
          const form = new FormData();
          form.set("expectedVersion", "0");
          return form;
        })(),
      ),
    ]);
    expect(race.filter((result) => result.status === "success")).toHaveLength(1);
    expect(race.find((result) => result.code === "STALE")).toBeDefined();
    if ((await prisma.weddingStaffAssignment.count()) === 0) {
      expect(
        await prisma.weddingTimelineStaffAssignment.count({
          where: { timelineItemId: item.id },
        }),
      ).toBe(0);
    }
  });

  it("rejects cross-workspace assignment and atomically replaces valid staff", async () => {
    const owner = await createOwnerWorkspace("第一工作區");
    const second = await createWorkspaceForUser(owner.user.id, "第二工作區");
    const localStaff = await prisma.weddingStaffAssignment.create({
      data: {
        workspaceId: owner.workspace.id,
        roleName: "招待",
        personName: "小安",
      },
    });
    const foreignStaff = await prisma.weddingStaffAssignment.create({
      data: {
        workspaceId: second.id,
        roleName: "主持",
        personName: "小美",
      },
    });

    await expect(
      createWeddingTimelineItemAction(
        owner.workspace.id,
        idleState,
        timelineForm([foreignStaff.id]),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(await prisma.weddingTimelineItem.count()).toBe(0);

    await createWeddingTimelineItemAction(
      owner.workspace.id,
      idleState,
      timelineForm([localStaff.id]),
    );
    const item = await prisma.weddingTimelineItem.findFirstOrThrow();

    const forgedUpdate = timelineForm([foreignStaff.id], 0);
    forgedUpdate.set("title", "不應寫入的流程");
    await expect(
      updateWeddingTimelineItemAction(
        owner.workspace.id,
        item.id,
        idleState,
        forgedUpdate,
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(
      await prisma.weddingTimelineItem.findUniqueOrThrow({
        where: { id: item.id },
        select: { title: true, version: true },
      }),
    ).toEqual({ title: "賓客入場", version: 0 });
    expect(
      await prisma.weddingTimelineStaffAssignment.findMany({
        where: { timelineItemId: item.id },
        select: { staffAssignmentId: true },
      }),
    ).toEqual([{ staffAssignmentId: localStaff.id }]);

    await expect(
      updateWeddingTimelineItemAction(
        owner.workspace.id,
        item.id,
        idleState,
        timelineForm([], 0),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(await prisma.weddingTimelineStaffAssignment.count()).toBe(0);
    expect(
      await getWeddingTimelinePageData(owner.workspace.id),
    ).toMatchObject({
      items: [
        expect.objectContaining({
          assignedStaff: [],
          startTime: "11:30",
          mediaCue: "迎賓音樂\n開場影片",
        }),
      ],
    });

    const deleteForm = new FormData();
    deleteForm.set("expectedVersion", "0");
    await expect(
      deleteWeddingTimelineItemAction(
        owner.workspace.id,
        item.id,
        idleState,
        deleteForm,
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
  });

  it("applies the general lunch template only once to an empty timeline", async () => {
    const { workspace } = await createOwnerWorkspace();
    await expect(
      applyGeneralLunchTimelineTemplateAction(workspace.id, idleState),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.weddingTimelineItem.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(9);
    expect(
      await prisma.weddingTimelineItem.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { startMinute: "asc" },
        select: {
          startMinute: true,
          endMinute: true,
          title: true,
          details: true,
          mediaCue: true,
          notes: true,
        },
      }),
    ).toEqual([
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
    await expect(
      applyGeneralLunchTimelineTemplateAction(workspace.id, idleState),
    ).resolves.toMatchObject({ status: "error", code: "CONFLICT" });
    expect(
      await prisma.weddingTimelineItem.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(9);
  });

  it("serializes concurrent general-template requests without duplicates", async () => {
    const { workspace } = await createOwnerWorkspace();
    const results = await Promise.all([
      applyGeneralLunchTimelineTemplateAction(workspace.id, idleState),
      applyGeneralLunchTimelineTemplateAction(workspace.id, idleState),
    ]);

    expect(results.filter((result) => result.status === "success")).toHaveLength(1);
    expect(results.filter((result) => result.status === "error")).toHaveLength(1);
    expect(
      await prisma.weddingTimelineItem.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(9);
  });

  it("allows only one winner in a concurrent timeline update/delete race", async () => {
    const { workspace } = await createOwnerWorkspace();
    const staff = await prisma.weddingStaffAssignment.create({
      data: {
        workspaceId: workspace.id,
        roleName: "招待",
        personName: "小安",
      },
    });
    const item = await prisma.weddingTimelineItem.create({
      data: {
        workspaceId: workspace.id,
        startMinute: 690,
        phase: "迎賓",
        title: "競態流程",
      },
    });
    const deleteInput = new FormData();
    deleteInput.set("expectedVersion", "0");

    const results = await Promise.all([
      updateWeddingTimelineItemAction(
        workspace.id,
        item.id,
        idleState,
        timelineForm([staff.id], 0),
      ),
      deleteWeddingTimelineItemAction(
        workspace.id,
        item.id,
        idleState,
        deleteInput,
      ),
    ]);

    expect(results.filter((result) => result.status === "success")).toHaveLength(1);
    expect(results.filter((result) => result.status === "error")).toHaveLength(1);
    expect(results.find((result) => result.status === "error")).toMatchObject({
      code: "STALE",
    });
  });
});
