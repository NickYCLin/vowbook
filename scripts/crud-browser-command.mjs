import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createBudgetTaxonomyFixture } from "./budget-taxonomy-fixture.mjs";

const rawTestDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!rawTestDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required. Use a disposable localhost PostgreSQL database whose name contains 'test'.",
  );
}

const parsedUrl = new URL(rawTestDatabaseUrl);
const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//u, ""));
if (!allowedHosts.has(parsedUrl.hostname) || !/test/iu.test(databaseName)) {
  throw new Error(
    "Refusing to run: TEST_DATABASE_URL must target localhost and a database whose name contains 'test'.",
  );
}

const runId = `${process.pid}_${Date.now()}`;
const schemaName = `vowbook_crud_e2e_${runId}`;
const databaseUrl = databaseUrlFor(schemaName);
const authSecret = "vowbook-e2e-local-secret-not-for-production";
const ownerId = `crud_e2e_owner_${runId}`;
const googleSubject = `crud-e2e-owner-subject-${runId}`;
const ownerEmail = `crud-e2e-owner-${runId}@example.test`;
const fixtures = {
  desktop: {
    workspaceId: `crud_e2e_desktop_workspace_${runId}`,
    workspaceName: "CRUD E2E 桌面婚宴",
    memberId: `crud_e2e_desktop_member_${runId}`,
    memberName: "桌面協作者",
    memberEmail: `crud-e2e-desktop-member-${runId}@example.test`,
    groupName: "桌面婚紗方案",
    renamedGroupName: "桌面婚紗方案已更新",
    dissolveChildName: "桌面婚紗方案拍攝費",
    temporaryWorkspaceName: "桌面臨時婚宴",
    renamedTemporaryWorkspaceName: "桌面臨時婚宴已更新",
    manualGuestId: `crud_e2e_desktop_guest_${runId}`,
    manualGuestName: "桌面手動賓客",
    declinedGuestId: `crud_e2e_desktop_declined_guest_${runId}`,
    declinedGuestName: "桌面不出席賓客",
    editedGuestName: "桌面手動賓客已完整更新",
    editedGuestNotes: "桌面真實流程備註：保留人工可編輯內容",
    importedGuestId: `crud_e2e_desktop_imported_guest_${runId}`,
    importedGuestName: "桌面匯入測試賓客",
    importedGuestEditedPartySize: 4,
    stableTableId: `crud_e2e_desktop_stable_table_${runId}`,
    stableTableName: "桌面既有主桌",
    createdTableName: "桌面可見入口新增空桌",
    editedSecondTableName: "桌面超長親友桌名稱－驗證窄螢幕安全換行",
    budgetRollupParentId: `crud_e2e_desktop_budget_rollup_parent_${runId}`,
    budgetRollupParentName: "桌面影像紀錄零元父項",
    budgetRollupChildId: `crud_e2e_desktop_budget_rollup_child_${runId}`,
    budgetRollupChildName: "桌面婚禮攝影六萬二千八百元子項",
    budgetCrossCategoryChildId: `crud_e2e_desktop_budget_cross_category_child_${runId}`,
    budgetCrossCategoryChildName: "桌面次要一萬七千二百元子項",
    budgetZeroLeafId: `crud_e2e_desktop_budget_zero_leaf_${runId}`,
    budgetZeroLeafName: "桌面獨立真正零元花費",
    budgetPhotographyExpenseId: `crud_e2e_desktop_budget_photography_${runId}`,
    budgetPhotographyExpenseName: "桌面婚紗攝影方案",
    budgetNotionOtherGroupId: `crud_e2e_desktop_budget_notion_other_${runId}`,
    budgetNotionOtherGroupName: "其他",
    budgetNotionOtherGroupExternalId:
      "c0000000-0000-4000-8000-000000000001",
    budgetNotionOtherGroupSourceHash: "c".repeat(64),
    budgetSmallShoesExpenseId: `crud_e2e_desktop_budget_small_shoes_${runId}`,
    budgetSmallShoesExpenseName: "合成姓名的小白鞋",
    budgetSmallShoesExpenseExternalId:
      "b0000000-0000-4000-8000-000000000001",
    budgetSmallShoesExpenseSourceHash: "a".repeat(64),
  },
  mobile: {
    workspaceId: `crud_e2e_mobile_workspace_${runId}`,
    workspaceName: "CRUD E2E 手機婚宴",
    memberId: `crud_e2e_mobile_member_${runId}`,
    memberName: "手機協作者",
    memberEmail: `crud-e2e-mobile-member-${runId}@example.test`,
    groupName: "手機婚紗方案",
    renamedGroupName: "M".repeat(120),
    dissolveChildName: "手機婚紗方案拍攝費",
    temporaryWorkspaceName: "手機臨時婚宴",
    renamedTemporaryWorkspaceName: "手機臨時婚宴已更新",
    manualGuestId: `crud_e2e_mobile_guest_${runId}`,
    manualGuestName: "手機手動賓客",
    declinedGuestId: `crud_e2e_mobile_declined_guest_${runId}`,
    declinedGuestName: "手機不出席賓客",
    editedGuestName: "手機手動賓客已完整更新",
    editedGuestNotes: "手機真實流程備註：390px 仍需安全顯示",
    importedGuestId: `crud_e2e_mobile_imported_guest_${runId}`,
    importedGuestName: "手機匯入測試賓客",
    importedGuestEditedPartySize: 5,
    stableTableId: `crud_e2e_mobile_stable_table_${runId}`,
    stableTableName: "手機既有主桌",
    createdTableName: "手機可見入口新增空桌",
    editedSecondTableName: "手機超長親友桌名稱－驗證三百九十像素安全換行",
    budgetRollupParentId: `crud_e2e_mobile_budget_rollup_parent_${runId}`,
    budgetRollupParentName: "手機影像紀錄零元父項",
    budgetRollupChildId: `crud_e2e_mobile_budget_rollup_child_${runId}`,
    budgetRollupChildName: "手機婚禮攝影六萬二千八百元子項",
    budgetCrossCategoryChildId: `crud_e2e_mobile_budget_cross_category_child_${runId}`,
    budgetCrossCategoryChildName: "手機次要一萬七千二百元子項",
    budgetZeroLeafId: `crud_e2e_mobile_budget_zero_leaf_${runId}`,
    budgetZeroLeafName: "手機獨立真正零元花費",
    budgetPhotographyExpenseId: `crud_e2e_mobile_budget_photography_${runId}`,
    budgetPhotographyExpenseName: "手機婚紗攝影方案",
    budgetNotionOtherGroupId: `crud_e2e_mobile_budget_notion_other_${runId}`,
    budgetNotionOtherGroupName: "其他",
    budgetNotionOtherGroupExternalId:
      "c0000000-0000-4000-8000-000000000002",
    budgetNotionOtherGroupSourceHash: "d".repeat(64),
    budgetSmallShoesExpenseId: `crud_e2e_mobile_budget_small_shoes_${runId}`,
    budgetSmallShoesExpenseName: "合成姓名的小白鞋",
    budgetSmallShoesExpenseExternalId:
      "b0000000-0000-4000-8000-000000000002",
    budgetSmallShoesExpenseSourceHash: "b".repeat(64),
  },
};
const prismaCli = path.join(
  process.cwd(),
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
const playwrightCli = path.join(
  process.cwd(),
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const browsersPath = path.join(process.cwd(), ".playwright-browsers");

function databaseUrlFor(schema) {
  const url = new URL(rawTestDatabaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function run(command, args, environment) {
  return (
    spawnSync(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    }).status ?? 1
  );
}

async function seedFixture() {
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    await client.user.create({
      data: {
        id: ownerId,
        googleSubject,
        email: ownerEmail,
        name: "CRUD E2E 擁有者",
      },
    });

    for (const fixture of Object.values(fixtures)) {
      await client.user.create({
        data: {
          id: fixture.memberId,
          googleSubject: `${fixture.memberId}-subject`,
          email: fixture.memberEmail,
          name: fixture.memberName,
        },
      });
      await client.weddingWorkspace.create({
        data: {
          id: fixture.workspaceId,
          name: fixture.workspaceName,
          createdById: ownerId,
          memberships: {
            create: [
              { userId: ownerId, role: "OWNER" },
              { userId: fixture.memberId, role: "PLANNER" },
            ],
          },
        },
      });
      const taxonomyNodeIds = await createBudgetTaxonomyFixture(
        client,
        fixture.workspaceId,
      );
      const venueItemId = taxonomyNodeIds.get("ITEM_WEDDING_VENUE");
      const pendingItemId = taxonomyNodeIds.get(
        "INTERNAL_UNCLASSIFIED_ITEM",
      );
      const photographyItemId = taxonomyNodeIds.get(
        "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      );
      if (!venueItemId || !pendingItemId || !photographyItemId) {
        throw new Error("CRUD browser taxonomy fixture is incomplete.");
      }
      await client.seatingTable.create({
        data: {
          id: fixture.stableTableId,
          workspaceId: fixture.workspaceId,
          position: 1,
          name: fixture.stableTableName,
          capacity: 6,
        },
      });
      await client.guest.create({
        data: {
          id: fixture.manualGuestId,
          workspaceId: fixture.workspaceId,
          name: fixture.manualGuestName,
          side: "SHARED",
          attendanceStatus: "UNDECIDED",
          partySize: 1,
          notes: "尚未更新的人工備註",
        },
      });
      await client.guest.create({
        data: {
          id: fixture.declinedGuestId,
          workspaceId: fixture.workspaceId,
          name: fixture.declinedGuestName,
          side: "SHARED",
          attendanceStatus: "DECLINED",
          partySize: 2,
          notes: "隔離 E2E 不出席座位限制",
        },
      });
      await client.guest.create({
        data: {
          id: fixture.importedGuestId,
          workspaceId: fixture.workspaceId,
          name: fixture.importedGuestName,
          side: "PARTNER_A",
          attendanceStatus: "ATTENDING",
          partySize: 2,
          importRecords: {
            create: {
              source: "LINEIN",
              sourceInstance: "default",
              sourceLabel: "拍拍印",
              sourceManaged: true,
              managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
              sourcePartySize: 2,
              externalId: `crud-e2e-imported-guest-${fixture.importedGuestId}`,
            },
          },
        },
      });
      await client.budgetItem.create({
        data: {
          id: fixture.budgetRollupParentId,
          workspaceId: fixture.workspaceId,
          parentId: venueItemId,
          name: fixture.budgetRollupParentName,
          kind: "EXPENSE",
          category: "VENUE_CATERING",
          plannedAmount: 0,
          actualAmount: null,
          bookingStatus: "PLANNING",
        },
      });
      await client.budgetItem.create({
        data: {
          id: fixture.budgetRollupChildId,
          workspaceId: fixture.workspaceId,
          parentId: fixture.budgetRollupParentId,
          name: fixture.budgetRollupChildName,
          kind: "EXPENSE",
          category: "VENUE_CATERING",
          plannedAmount: 62_800,
          actualAmount: 62_800,
          bookingStatus: "PAID",
          paid: true,
          paidAt: new Date("2027-01-02T03:04:05.000Z"),
        },
      });
      await client.budgetItem.create({
        data: {
          id: fixture.budgetCrossCategoryChildId,
          workspaceId: fixture.workspaceId,
          parentId: fixture.budgetRollupParentId,
          name: fixture.budgetCrossCategoryChildName,
          kind: "EXPENSE",
          category: "VENUE_CATERING",
          plannedAmount: 17_200,
          actualAmount: 5_200,
          bookingStatus: "BOOKED_BALANCE_DUE",
          depositAmount: 5_200,
          balanceAmount: 12_000,
        },
      });
      await client.budgetItem.create({
        data: {
          id: fixture.budgetZeroLeafId,
          workspaceId: fixture.workspaceId,
          parentId: pendingItemId,
          name: fixture.budgetZeroLeafName,
          kind: "EXPENSE",
          category: "OTHER_PENDING",
          plannedAmount: 0,
          actualAmount: null,
          bookingStatus: "PLANNING",
        },
      });
      await client.budgetItem.create({
        data: {
          id: fixture.budgetPhotographyExpenseId,
          workspaceId: fixture.workspaceId,
          parentId: photographyItemId,
          name: fixture.budgetPhotographyExpenseName,
          kind: "EXPENSE",
          category: "PHOTOGRAPHY_VIDEO",
          plannedAmount: 30_000,
          actualAmount: null,
          bookingStatus: "PLANNING",
        },
      });
      await client.budgetItem.create({
        data: {
          id: fixture.budgetNotionOtherGroupId,
          workspaceId: fixture.workspaceId,
          parentId: photographyItemId,
          source: "NOTION",
          externalId: fixture.budgetNotionOtherGroupExternalId,
          sourceHash: fixture.budgetNotionOtherGroupSourceHash,
          sourceOrder: 36,
          sourceHierarchyPath: ["婚紗拍攝", "其他"],
          name: fixture.budgetNotionOtherGroupName,
          kind: "GROUP",
          category: null,
          relatedTaxonomyItemKey: null,
          plannedAmount: 0,
          actualAmount: null,
          bookingStatus: "PLANNING",
        },
      });
      await client.budgetItem.create({
        data: {
          id: fixture.budgetSmallShoesExpenseId,
          workspaceId: fixture.workspaceId,
          parentId: fixture.budgetNotionOtherGroupId,
          source: "NOTION",
          externalId: fixture.budgetSmallShoesExpenseExternalId,
          sourceHash: fixture.budgetSmallShoesExpenseSourceHash,
          sourceOrder: 37,
          sourceHierarchyPath: [
            "婚紗拍攝",
            "其他",
            "合成姓名的小白鞋",
          ],
          name: fixture.budgetSmallShoesExpenseName,
          kind: "EXPENSE",
          category: "PHOTOGRAPHY_VIDEO",
          relatedTaxonomyItemKey: null,
          plannedAmount: 12_000,
          actualAmount: null,
          bookingStatus: "PLANNING",
        },
      });
    }
  } finally {
    await client.$disconnect();
  }
}

async function verifyFixture() {
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    const temporaryWorkspaceNames = Object.values(fixtures).flatMap((fixture) => [
      fixture.temporaryWorkspaceName,
      fixture.renamedTemporaryWorkspaceName,
    ]);
    const temporaryWorkspaceCount = await client.weddingWorkspace.count({
      where: { name: { in: temporaryWorkspaceNames } },
    });
    if (temporaryWorkspaceCount !== 0) {
      throw new Error("CRUD browser verification found an undeleted temporary workspace.");
    }

    for (const fixture of Object.values(fixtures)) {
      const membershipCount = await client.membership.count({
        where: {
          workspaceId: fixture.workspaceId,
          userId: fixture.memberId,
        },
      });
      if (membershipCount !== 0) {
        throw new Error("CRUD browser verification found a member that was not removed.");
      }

      const dissolvedFixtures = await client.budgetItem.count({
        where: {
          workspaceId: fixture.workspaceId,
          name: {
            in: [fixture.renamedGroupName, fixture.dissolveChildName],
          },
        },
      });
      if (dissolvedFixtures !== 0) {
        throw new Error(
          "CRUD browser verification found an uncleared dissolve fixture.",
        );
      }

      const budgetRollupItems = await client.budgetItem.findMany({
        where: {
          workspaceId: fixture.workspaceId,
          id: {
            in: [
              fixture.budgetRollupParentId,
              fixture.budgetRollupChildId,
              fixture.budgetCrossCategoryChildId,
              fixture.budgetZeroLeafId,
              fixture.budgetPhotographyExpenseId,
              fixture.budgetNotionOtherGroupId,
              fixture.budgetSmallShoesExpenseId,
            ],
          },
        },
        select: {
          id: true,
          parentId: true,
          parent: { select: { systemTaxonomyKey: true } },
          kind: true,
          category: true,
          plannedAmount: true,
          actualAmount: true,
          bookingStatus: true,
          relatedTaxonomyItemKey: true,
          source: true,
          externalId: true,
          sourceHash: true,
          sourceHierarchyPath: true,
        },
      });
      const budgetRollupById = new Map(
        budgetRollupItems.map((item) => [item.id, item]),
      );
      const budgetRollupParent = budgetRollupById.get(
        fixture.budgetRollupParentId,
      );
      const budgetRollupChild = budgetRollupById.get(
        fixture.budgetRollupChildId,
      );
      const budgetCrossCategoryChild = budgetRollupById.get(
        fixture.budgetCrossCategoryChildId,
      );
      const budgetZeroLeaf = budgetRollupById.get(fixture.budgetZeroLeafId);
      const budgetPhotographyExpense = budgetRollupById.get(
        fixture.budgetPhotographyExpenseId,
      );
      const budgetNotionOtherGroup = budgetRollupById.get(
        fixture.budgetNotionOtherGroupId,
      );
      const budgetSmallShoesExpense = budgetRollupById.get(
        fixture.budgetSmallShoesExpenseId,
      );
      if (
        budgetRollupItems.length !== 7 ||
        !budgetRollupParent ||
        budgetRollupParent.parent?.systemTaxonomyKey !==
          "ITEM_WEDDING_VENUE" ||
        budgetRollupParent.category !== "VENUE_CATERING" ||
        budgetRollupParent.plannedAmount !== 0 ||
        budgetRollupParent.actualAmount !== null ||
        budgetRollupParent.bookingStatus !== "PLANNING" ||
        !budgetRollupChild ||
        budgetRollupChild.parentId !== fixture.budgetRollupParentId ||
        budgetRollupChild.category !== "VENUE_CATERING" ||
        budgetRollupChild.plannedAmount !== 62_800 ||
        budgetRollupChild.actualAmount !== 62_800 ||
        budgetRollupChild.bookingStatus !== "PAID" ||
        !budgetCrossCategoryChild ||
        budgetCrossCategoryChild.parentId !== fixture.budgetRollupParentId ||
        budgetCrossCategoryChild.category !== "VENUE_CATERING" ||
        budgetCrossCategoryChild.plannedAmount !== 17_200 ||
        budgetCrossCategoryChild.actualAmount !== 5_200 ||
        budgetCrossCategoryChild.bookingStatus !== "BOOKED_BALANCE_DUE" ||
        !budgetZeroLeaf ||
        budgetZeroLeaf.parent?.systemTaxonomyKey !==
          "INTERNAL_UNCLASSIFIED_ITEM" ||
        budgetZeroLeaf.category !== "OTHER_PENDING" ||
        budgetZeroLeaf.plannedAmount !== 0 ||
        budgetZeroLeaf.actualAmount !== null ||
        budgetZeroLeaf.bookingStatus !== "PLANNING" ||
        !budgetPhotographyExpense ||
        budgetPhotographyExpense.parent?.systemTaxonomyKey !==
          "ITEM_PRE_WEDDING_PHOTOGRAPHY" ||
        budgetPhotographyExpense.category !== "PHOTOGRAPHY_VIDEO" ||
        budgetPhotographyExpense.plannedAmount !== 30_000 ||
        budgetPhotographyExpense.relatedTaxonomyItemKey !== null ||
        !budgetNotionOtherGroup ||
        budgetNotionOtherGroup.parent?.systemTaxonomyKey !==
          "ITEM_PRE_WEDDING_PHOTOGRAPHY" ||
        budgetNotionOtherGroup.kind !== "GROUP" ||
        budgetNotionOtherGroup.source !== "NOTION" ||
        budgetNotionOtherGroup.externalId !==
          fixture.budgetNotionOtherGroupExternalId ||
        budgetNotionOtherGroup.sourceHash !==
          fixture.budgetNotionOtherGroupSourceHash ||
        budgetNotionOtherGroup.sourceHierarchyPath.join(" › ") !==
          "婚紗拍攝 › 其他" ||
        budgetNotionOtherGroup.category !== null ||
        budgetNotionOtherGroup.relatedTaxonomyItemKey !== null ||
        !budgetSmallShoesExpense ||
        budgetSmallShoesExpense.parentId !== fixture.budgetNotionOtherGroupId ||
        budgetSmallShoesExpense.kind !== "EXPENSE" ||
        budgetSmallShoesExpense.source !== "NOTION" ||
        budgetSmallShoesExpense.externalId !==
          fixture.budgetSmallShoesExpenseExternalId ||
        budgetSmallShoesExpense.sourceHash !==
          fixture.budgetSmallShoesExpenseSourceHash ||
        budgetSmallShoesExpense.sourceHierarchyPath.join(" › ") !==
          "婚紗拍攝 › 其他 › 合成姓名的小白鞋" ||
        budgetSmallShoesExpense.category !== "PHOTOGRAPHY_VIDEO" ||
        budgetSmallShoesExpense.plannedAmount !== 12_000 ||
        budgetSmallShoesExpense.relatedTaxonomyItemKey !== null
      ) {
        throw new Error(
          "CRUD browser verification found an unexpected budget rollup fixture state.",
        );
      }
      const syntheticBudgetAggregate = await client.budgetItem.aggregate({
        where: {
          workspaceId: fixture.workspaceId,
          id: {
            in: [
              fixture.budgetRollupParentId,
              fixture.budgetRollupChildId,
              fixture.budgetCrossCategoryChildId,
              fixture.budgetZeroLeafId,
              fixture.budgetPhotographyExpenseId,
              fixture.budgetNotionOtherGroupId,
              fixture.budgetSmallShoesExpenseId,
            ],
          },
          kind: "EXPENSE",
        },
        _count: { _all: true },
        _sum: { plannedAmount: true, actualAmount: true },
      });
      if (
        syntheticBudgetAggregate._count._all !== 6 ||
        syntheticBudgetAggregate._sum.plannedAmount !== 122_000 ||
        syntheticBudgetAggregate._sum.actualAmount !== 68_000
      ) {
        throw new Error(
          "CRUD browser verification found incorrect synthetic budget aggregates.",
        );
      }

      const allSuggestions = await client.budgetItem.findMany({
        where: {
          workspaceId: fixture.workspaceId,
          suggestionKey: { not: null },
        },
        select: {
          suggestionKey: true,
          name: true,
          parent: { select: { systemTaxonomyKey: true } },
          kind: true,
          source: true,
          category: true,
          plannedAmount: true,
          actualAmount: true,
          bookingStatus: true,
        },
      });
      const engagementSuggestions = allSuggestions.filter((item) =>
        item.suggestionKey?.startsWith("ENGAGEMENT_"),
      );
      const preparationSuggestions = allSuggestions.filter((item) =>
        item.suggestionKey?.startsWith("PREPARATION_"),
      );
      const engagementSuggestionByKey = new Map(
        engagementSuggestions.map((item) => [item.suggestionKey, item]),
      );
      const groomSuggestion = engagementSuggestionByKey.get(
        "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
      );
      const brideSuggestion = engagementSuggestionByKey.get(
        "ENGAGEMENT_BRIDE_ACCEPTANCE_GIFT",
      );
      if (
        engagementSuggestions.length !== 2 ||
        !groomSuggestion ||
        groomSuggestion.name !== "大聘" ||
        groomSuggestion.parent?.systemTaxonomyKey !==
          "ITEM_ENGAGEMENT_GROOM" ||
        !brideSuggestion ||
        brideSuggestion.name !== "接聘禮" ||
        brideSuggestion.parent?.systemTaxonomyKey !==
          "ITEM_ENGAGEMENT_BRIDE" ||
        engagementSuggestions.some(
          (item) =>
            item.kind !== "EXPENSE" ||
            item.source !== "MANUAL" ||
            item.category !== "DECOR_GIFTS" ||
            item.plannedAmount !== 0 ||
            item.actualAmount !== null ||
            item.bookingStatus !== "PLANNING",
        )
      ) {
        throw new Error(
          "CRUD browser verification found unexpected engagement suggestions.",
        );
      }

      const preparationSuggestionByKey = new Map(
        preparationSuggestions.map((item) => [item.suggestionKey, item]),
      );
      const retouchingSuggestion = preparationSuggestionByKey.get(
        "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_RETOUCHING",
      );
      const brideShoesSuggestion = preparationSuggestionByKey.get(
        "PREPARATION_WEDDING_SHOES_BRIDE",
      );
      if (
        allSuggestions.length !== 4 ||
        preparationSuggestions.length !== 2 ||
        !retouchingSuggestion ||
        retouchingSuggestion.name !== "精修" ||
        retouchingSuggestion.parent?.systemTaxonomyKey !==
          "ITEM_PRE_WEDDING_PHOTOGRAPHY" ||
        retouchingSuggestion.category !== "PHOTOGRAPHY_VIDEO" ||
        !brideShoesSuggestion ||
        brideShoesSuggestion.name !== "新娘婚鞋" ||
        brideShoesSuggestion.parent?.systemTaxonomyKey !==
          "ITEM_WEDDING_SHOES" ||
        brideShoesSuggestion.category !== "ATTIRE_STYLING" ||
        preparationSuggestions.some(
          (item) =>
            item.kind !== "EXPENSE" ||
            item.source !== "MANUAL" ||
            item.plannedAmount !== 0 ||
            item.actualAmount !== null ||
            item.bookingStatus !== "PLANNING",
        )
      ) {
        throw new Error(
          "CRUD browser verification found unexpected preparation suggestions.",
        );
      }

      const guest = await client.guest.findUnique({
        where: { id: fixture.manualGuestId },
      });
      if (
        guest?.workspaceId !== fixture.workspaceId ||
        guest.name !== fixture.editedGuestName ||
        guest.side !== "PARTNER_B" ||
        guest.attendanceStatus !== "ATTENDING" ||
        guest.partySize !== 3 ||
        guest.notes !== fixture.editedGuestNotes ||
        guest.seatingTableId !== null ||
        // 資料編輯 1 次、安排／移出 2 次、未安排區人數調整 2 次、再安排／移出 2 次。
        guest.version !== 7
      ) {
        throw new Error("CRUD browser verification found an unexpected final guest state.");
      }

      const declinedGuest = await client.guest.findUnique({
        where: { id: fixture.declinedGuestId },
        select: {
          workspaceId: true,
          name: true,
          attendanceStatus: true,
          partySize: true,
          seatingTableId: true,
        },
      });
      if (
        declinedGuest?.workspaceId !== fixture.workspaceId ||
        declinedGuest.name !== fixture.declinedGuestName ||
        declinedGuest.attendanceStatus !== "DECLINED" ||
        declinedGuest.partySize !== 2 ||
        declinedGuest.seatingTableId !== null
      ) {
        throw new Error(
          "CRUD browser verification found an unexpected declined guest seating state.",
        );
      }

      const importedGuest = await client.guest.findUnique({
        where: { id: fixture.importedGuestId },
        select: {
          workspaceId: true,
          name: true,
          side: true,
          attendanceStatus: true,
          partySize: true,
          version: true,
          importRecords: {
            select: {
              source: true,
              sourceInstance: true,
              sourceManaged: true,
              managedFields: true,
              sourcePartySize: true,
            },
          },
        },
      });
      const importedRecord = importedGuest?.importRecords[0];
      if (
        importedGuest?.workspaceId !== fixture.workspaceId ||
        importedGuest.name !== fixture.importedGuestName ||
        importedGuest.side !== "PARTNER_A" ||
        importedGuest.attendanceStatus !== "ATTENDING" ||
        importedGuest.partySize !== fixture.importedGuestEditedPartySize ||
        importedGuest.version !== 1 ||
        importedGuest.importRecords.length !== 1 ||
        importedRecord?.source !== "LINEIN" ||
        importedRecord.sourceInstance !== "default" ||
        importedRecord.sourceManaged !== true ||
        importedRecord.sourcePartySize !== 2 ||
        importedRecord.managedFields.join(",") !==
          "NAME,SIDE,ATTENDANCE_STATUS" ||
        importedRecord.managedFields.includes("PARTY_SIZE")
      ) {
        throw new Error(
          "CRUD browser verification found an unexpected imported guest party-size state.",
        );
      }

      const finalTables = await client.seatingTable.findMany({
        where: { workspaceId: fixture.workspaceId },
        orderBy: { position: "asc" },
      });
      if (
        finalTables.length !== 1 ||
        finalTables[0]?.id !== fixture.stableTableId ||
        finalTables[0]?.name !== fixture.stableTableName ||
        finalTables[0]?.capacity !== 6 ||
        finalTables[0]?.position !== 1 ||
        finalTables[0]?.layoutX === null ||
        finalTables[0]?.layoutX <= 500 ||
        finalTables[0]?.layoutX > 944 ||
        finalTables[0]?.layoutY !== 220 ||
        finalTables[0]?.version !== 1
      ) {
        throw new Error(
          "CRUD browser verification did not preserve the stable first table.",
        );
      }
      const removedEditedTable = await client.seatingTable.count({
        where: {
          workspaceId: fixture.workspaceId,
          name: fixture.editedSecondTableName,
        },
      });
      if (removedEditedTable !== 0) {
        throw new Error("CRUD browser verification found the confirmed removed table.");
      }
    }
  } finally {
    await client.$disconnect();
  }
}

async function dropSchema() {
  const cleanupClient = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    await cleanupClient.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
  } finally {
    await cleanupClient.$disconnect();
  }
}

const environment = {
  ...process.env,
  AUTH_SECRET: authSecret,
  DATABASE_URL: databaseUrl,
  NEXT_PUBLIC_BASE_PATH: "/VowBook",
  PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  VOWBOOK_CRUD_E2E: "1",
  VOWBOOK_CRUD_E2E_EMAIL: ownerEmail,
  VOWBOOK_CRUD_E2E_GOOGLE_SUBJECT: googleSubject,
  VOWBOOK_CRUD_E2E_FIXTURES: JSON.stringify(fixtures),
};

let status = 1;
try {
  status = run(process.execPath, [prismaCli, "migrate", "deploy"], environment);
  if (status === 0) {
    await seedFixture();
    status = run(
      process.execPath,
      [
        playwrightCli,
        "test",
        "e2e/budget-hierarchy-visual.spec.ts",
        "e2e/crud-workflows.spec.ts",
        "--workers=1",
      ],
      environment,
    );
  }
  if (status === 0) {
    status = run(
      process.execPath,
      [
        playwrightCli,
        "test",
        "e2e/budget-engagement-preset.spec.ts",
        "--workers=1",
      ],
      environment,
    );
  }
  if (status === 0) {
    status = run(
      process.execPath,
      [
        playwrightCli,
        "test",
        "e2e/budget-preparation-preset.spec.ts",
        "--workers=1",
      ],
      environment,
    );
  }
  if (status === 0) {
    await verifyFixture();
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "CRUD browser runner failed.",
  );
  status = 1;
} finally {
  await dropSchema();
}

process.exit(status);
