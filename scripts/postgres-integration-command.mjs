import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

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
const freshSchemaName = `vowbook_it_fresh_${runId}`;
const upgradeSchemaName = `vowbook_it_upgrade_${runId}`;
const productionDriftSchemaName = `vowbook_it_production_drift_${runId}`;
const freshDatabaseUrl = databaseUrlFor(freshSchemaName);
const upgradeDatabaseUrl = databaseUrlFor(upgradeSchemaName);
const productionDriftDatabaseUrl = databaseUrlFor(productionDriftSchemaName);
const prismaCli = path.join(
  process.cwd(),
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
const vitestCli = path.join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
const migrationsDirectory = path.join(process.cwd(), "prisma", "migrations");
const migrationEntries = readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const guestSeniorityMigration = migrationEntries.at(-1);
const familyPartySizeMigration = migrationEntries.at(-2);
const userAccessMigration = migrationEntries.at(-3);
const guestDetailsMigration = migrationEntries.at(-4);
const avatarMigration = migrationEntries.at(-5);
const taskSidesMigration = migrationEntries.at(-6);
const rosterCategoriesMigration = migrationEntries.at(-7);
const duplicateNamesMigration = migrationEntries.at(-8);
const floorPlanMigration = migrationEntries.at(-9);
const preparationSuggestionMigration = migrationEntries.at(-10);
const engagementSuggestionMigration = migrationEntries.at(-11);
const proposalLabelMigration = migrationEntries.at(-12);
const repairMigration = migrationEntries.at(-13);
const sourceHierarchyMigration = migrationEntries.at(-14);
const relatedTaxonomyMigration = migrationEntries.at(-15);
const fixedGroupsMigration = migrationEntries.at(-16);
const failClosedMigration = migrationEntries.at(-17);
const priorHeadMigration = migrationEntries.at(-18);
if (
  !guestSeniorityMigration ||
  !familyPartySizeMigration ||
  !userAccessMigration ||
  !guestDetailsMigration ||
  !avatarMigration ||
  !taskSidesMigration ||
  !rosterCategoriesMigration ||
  !duplicateNamesMigration ||
  !floorPlanMigration ||
  !preparationSuggestionMigration ||
  !engagementSuggestionMigration ||
  !proposalLabelMigration ||
  !repairMigration ||
  !sourceHierarchyMigration ||
  !relatedTaxonomyMigration ||
  !failClosedMigration ||
  !fixedGroupsMigration ||
  !priorHeadMigration ||
  migrationEntries.length < 17
) {
  throw new Error("At least seventeen migrations are required for the upgrade gate.");
}
const priorHeadPosition = migrationEntries.indexOf(priorHeadMigration) + 1;
if (
  migrationEntries.length !== 33 ||
  priorHeadPosition !== 16 ||
  guestSeniorityMigration !== "20260825120000_guest_seniority" ||
  familyPartySizeMigration !==
    "20260824213500_allow_family_party_size" ||
  userAccessMigration !== "20260824004000_user_access_admin" ||
  guestDetailsMigration !==
    "20260823155000_guest_details_invitation_reply_optional" ||
  avatarMigration !== "20260823153000_user_profile_avatar" ||
  taskSidesMigration !== "20260822130000_wedding_task_sides" ||
  rosterCategoriesMigration !==
    "20260822120000_guest_roster_categories" ||
  duplicateNamesMigration !==
    "20260817120000_seating_table_duplicate_names" ||
  floorPlanMigration !== "20260813160000_seating_table_floor_plan" ||
  preparationSuggestionMigration !==
    "20260805130000_budget_preparation_suggestion_key" ||
  engagementSuggestionMigration !==
    "20260805120000_budget_engagement_suggestion_key" ||
  proposalLabelMigration !== "20260804150000_budget_proposal_label" ||
  repairMigration !== "20260804140000_budget_fixed_taxonomy_drift_repair" ||
  sourceHierarchyMigration !== "20260804113000_budget_notion_source_hierarchy_path" ||
  relatedTaxonomyMigration !== "20260803170000_budget_related_taxonomy_item" ||
  fixedGroupsMigration !== "20260803120000_budget_fixed_category_groups" ||
  failClosedMigration !== "20260802152000_linein_party_size_fail_closed" ||
  priorHeadMigration !== "20260802151000_linein_party_size_ownership"
) {
  throw new Error(
    "Upgrade gate requires prior head 16 through migrations 17 to 33.",
  );
}

const priorHeadDirectory = mkdtempSync(
  path.join(process.cwd(), ".tmp-prior-head-"),
);
const priorPrismaDirectory = path.join(priorHeadDirectory, "prisma");
const priorMigrationsDirectory = path.join(priorPrismaDirectory, "migrations");
const priorSchemaPath = path.join(priorPrismaDirectory, "schema.prisma");
const productionDriftDirectory = mkdtempSync(
  path.join(process.cwd(), ".tmp-production-drift-head-"),
);
const productionDriftPrismaDirectory = path.join(
  productionDriftDirectory,
  "prisma",
);
const productionDriftMigrationsDirectory = path.join(
  productionDriftPrismaDirectory,
  "migrations",
);
const productionDriftSchemaPath = path.join(
  productionDriftPrismaDirectory,
  "schema.prisma",
);

function databaseUrlFor(schemaName) {
  const url = new URL(rawTestDatabaseUrl);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

function environmentFor(databaseUrl, integration = false) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ...(integration ? { VOWBOOK_DB_INTEGRATION: "1" } : {}),
  };
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

function preparePriorHeadMigrations() {
  mkdirSync(priorMigrationsDirectory, { recursive: true });
  copyFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), priorSchemaPath);

  for (const entry of migrationEntries.slice(0, priorHeadPosition)) {
    cpSync(
      path.join(migrationsDirectory, entry),
      path.join(priorMigrationsDirectory, entry),
      { recursive: true },
    );
  }

  const migrationLock = path.join(migrationsDirectory, "migration_lock.toml");
  if (existsSync(migrationLock)) {
    copyFileSync(
      migrationLock,
      path.join(priorMigrationsDirectory, "migration_lock.toml"),
    );
  }
}

function prepareProductionDriftMigrations() {
  mkdirSync(productionDriftMigrationsDirectory, { recursive: true });
  copyFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    productionDriftSchemaPath,
  );
  const fixedGroupsPosition = migrationEntries.indexOf(fixedGroupsMigration);
  for (const entry of migrationEntries.slice(0, fixedGroupsPosition)) {
    cpSync(
      path.join(migrationsDirectory, entry),
      path.join(productionDriftMigrationsDirectory, entry),
      { recursive: true },
    );
  }
  const migrationLock = path.join(migrationsDirectory, "migration_lock.toml");
  if (existsSync(migrationLock)) {
    copyFileSync(
      migrationLock,
      path.join(productionDriftMigrationsDirectory, "migration_lock.toml"),
    );
  }
}

function extendProductionDriftMigrations() {
  for (const entry of [
    fixedGroupsMigration,
    relatedTaxonomyMigration,
    sourceHierarchyMigration,
  ]) {
    cpSync(
      path.join(migrationsDirectory, entry),
      path.join(productionDriftMigrationsDirectory, entry),
      { recursive: true },
    );
  }
  const driftFixedMigrationPath = path.join(
    productionDriftMigrationsDirectory,
    fixedGroupsMigration,
    "migration.sql",
  );
  writeFileSync(
    driftFixedMigrationPath,
    `${readFileSync(driftFixedMigrationPath, "utf8")}\n-- production_like_original_marked_applied\n`,
    "utf8",
  );
}

const productionDriftCategories = [
  ["RINGS_KEEPSAKES", "戒指與信物"],
  ["PHOTOGRAPHY_VIDEO", "攝影與影像"],
  ["ATTIRE_STYLING", "服裝與造型"],
  ["VENUE_CATERING", "場地與餐飲"],
  ["TRANSPORT_LODGING", "交通與住宿"],
  ["DECOR_GIFTS", "佈置與禮品"],
  ["PEOPLE_SERVICES", "人員與服務"],
  ["OTHER_PENDING", "其他／待整理"],
];

const fixedTaxonomyExpectedParents = new Map([
  ["STAGE_PREPARATION_1_2_MONTHS", null],
  ["STAGE_PREPARATION_3_MONTH", null],
  ["STAGE_PREPARATION_4_MONTH", null],
  ["STAGE_COUNTDOWN_2_MONTHS", null],
  ["STAGE_ENGAGEMENT_CEREMONY", null],
  ["STAGE_WEDDING_PROCESSION", null],
  ["INTERNAL_UNCLASSIFIED_STAGE", null],
  ["ITEM_PROPOSAL", "STAGE_PREPARATION_1_2_MONTHS"],
  ["ITEM_WEDDING_VENUE", "STAGE_PREPARATION_1_2_MONTHS"],
  ["ITEM_PRE_WEDDING_PHOTOGRAPHY", "STAGE_PREPARATION_1_2_MONTHS"],
  ["ITEM_WEDDING_CAKES", "STAGE_PREPARATION_3_MONTH"],
  ["ITEM_BRIDAL_STYLIST", "STAGE_PREPARATION_3_MONTH"],
  ["ITEM_WEDDING_PHOTOGRAPHY", "STAGE_PREPARATION_3_MONTH"],
  ["ITEM_WEDDING_VIDEOGRAPHY", "STAGE_PREPARATION_3_MONTH"],
  ["ITEM_WEDDING_HOST", "STAGE_PREPARATION_3_MONTH"],
  ["ITEM_WEDDING_BAND", "STAGE_PREPARATION_3_MONTH"],
  ["ITEM_WEDDING_INTERACTION", "STAGE_PREPARATION_3_MONTH"],
  ["ITEM_ATTIRE_RENTAL", "STAGE_PREPARATION_4_MONTH"],
  ["ITEM_WEDDING_SHOES", "STAGE_PREPARATION_4_MONTH"],
  ["ITEM_WEDDING_DECOR", "STAGE_PREPARATION_4_MONTH"],
  ["ITEM_INVITATIONS_POSTAGE", "STAGE_COUNTDOWN_2_MONTHS"],
  ["ITEM_BEAUTY_TREATMENTS", "STAGE_COUNTDOWN_2_MONTHS"],
  ["ITEM_WEDDING_FAVORS", "STAGE_COUNTDOWN_2_MONTHS"],
  ["ITEM_ENGAGEMENT_GROOM", "STAGE_ENGAGEMENT_CEREMONY"],
  ["ITEM_ENGAGEMENT_BRIDE", "STAGE_ENGAGEMENT_CEREMONY"],
  ["ITEM_PROCESSION_GROOM", "STAGE_WEDDING_PROCESSION"],
  ["ITEM_PROCESSION_BRIDE", "STAGE_WEDDING_PROCESSION"],
  ["INTERNAL_UNCLASSIFIED_ITEM", "INTERNAL_UNCLASSIFIED_STAGE"],
]);

async function seedProductionDriftData(client) {
  const workspaceIds = [
    `production_drift_workspace_a_${runId}`,
    `production_drift_workspace_b_${runId}`,
  ];
  const userIds = [
    `production_drift_user_a_${runId}`,
    `production_drift_user_b_${runId}`,
  ];
  const rootId = (workspaceIndex, category) =>
    `production_drift_root_${workspaceIndex}_${category}_${runId}`;
  const notionChildId = (workspaceIndex) =>
    `production_drift_notion_child_${workspaceIndex}_${runId}`;
  const manualChildId = (workspaceIndex) =>
    `production_drift_manual_child_${workspaceIndex}_${runId}`;

  await client.$transaction(async (transaction) => {
    for (const [index, workspaceId] of workspaceIds.entries()) {
      await transaction.$executeRawUnsafe(
        `INSERT INTO "users" ("id", "google_subject", "email", "updated_at")
         VALUES ('${userIds[index]}', 'production-drift-subject-${index}-${runId}',
           'production-drift-${index}-${runId}@example.test', CURRENT_TIMESTAMP)`,
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO "wedding_workspaces" ("id", "name", "created_by_id", "updated_at")
         VALUES ('${workspaceId}', '匿名 drift 工作區 ${index + 1}',
           '${userIds[index]}', CURRENT_TIMESTAMP)`,
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO "memberships" ("id", "workspace_id", "user_id", "role", "updated_at")
         VALUES ('production_drift_membership_${index}_${runId}',
           '${workspaceId}', '${userIds[index]}', 'OWNER', CURRENT_TIMESTAMP)`,
      );
    }

    await transaction.$executeRawUnsafe(
      'ALTER TABLE "budget_items" ADD COLUMN "system_category" "BudgetCostCategory"',
    );

    const rootValues = workspaceIds.flatMap((workspaceId, workspaceIndex) =>
      productionDriftCategories.map(
        ([category, name]) =>
          `('${rootId(workspaceIndex, category)}', '${workspaceId}', NULL,
            'MANUAL', NULL, NULL, NULL, '${name}', 'GROUP', NULL,
            '${category}', NULL, 0, 'PLANNING', FALSE, 0,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ),
    );
    await transaction.$executeRawUnsafe(
      `INSERT INTO "budget_items" (
        "id", "workspace_id", "parent_id", "source", "external_id",
        "source_hash", "source_order", "name", "kind", "category",
        "system_category", "legacy_category", "planned_amount",
        "booking_status", "paid", "version", "created_at", "updated_at"
      ) VALUES ${rootValues.join(",")}`,
    );

    for (const [workspaceIndex, workspaceId] of workspaceIds.entries()) {
      const externalId =
        workspaceIndex === 0
          ? "a0000000-0000-4000-8000-000000000001"
          : "a0000000-0000-4000-8000-000000000002";
      await transaction.$executeRawUnsafe(
        `INSERT INTO "budget_items" (
          "id", "workspace_id", "parent_id", "source", "external_id",
          "source_hash", "source_order", "name", "kind", "category",
          "system_category", "legacy_category", "planned_amount",
          "actual_amount", "deposit_amount", "booking_status", "paid",
          "version", "created_at", "updated_at"
        ) VALUES (
          '${notionChildId(workspaceIndex)}', '${workspaceId}',
          '${rootId(workspaceIndex, "ATTIRE_STYLING")}', 'NOTION',
          '${externalId}', '${"a".repeat(64)}', 9,
          '合成姓名的小白鞋 ${workspaceIndex + 1}', 'EXPENSE',
          'ATTIRE_STYLING', NULL, '服裝與造型', 2795, 2795, 2795,
          'PAID', TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO "budget_items" (
          "id", "workspace_id", "parent_id", "source", "source_order",
          "name", "kind", "category", "system_category", "legacy_category",
          "planned_amount", "booking_status", "paid", "version",
          "created_at", "updated_at"
        ) VALUES (
          '${manualChildId(workspaceIndex)}', '${workspaceId}',
          '${rootId(workspaceIndex, "VENUE_CATERING")}', 'MANUAL', NULL,
          '匿名手動子項 ${workspaceIndex + 1}', 'EXPENSE', 'VENUE_CATERING',
          NULL, '場地與餐飲', 1000, 'PLANNING', FALSE, 0,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
      );
    }

    await transaction.$executeRawUnsafe(
      `ALTER TABLE "budget_items"
        ADD CONSTRAINT "budget_items_root_category_group_check"
          CHECK (((parent_id IS NOT NULL) OR (system_category IS NOT NULL))),
        ADD CONSTRAINT "budget_items_system_category_group_check"
          CHECK (((system_category IS NULL) OR ((kind = 'GROUP'::"BudgetItemKind")
            AND (category IS NULL) AND (parent_id IS NULL)))),
        ADD CONSTRAINT "budget_items_system_category_name_check"
          CHECK (((system_category IS NULL) OR (name = CASE system_category
            WHEN 'RINGS_KEEPSAKES'::"BudgetCostCategory" THEN '戒指與信物'::text
            WHEN 'PHOTOGRAPHY_VIDEO'::"BudgetCostCategory" THEN '攝影與影像'::text
            WHEN 'ATTIRE_STYLING'::"BudgetCostCategory" THEN '服裝與造型'::text
            WHEN 'VENUE_CATERING'::"BudgetCostCategory" THEN '場地與餐飲'::text
            WHEN 'TRANSPORT_LODGING'::"BudgetCostCategory" THEN '交通與住宿'::text
            WHEN 'DECOR_GIFTS'::"BudgetCostCategory" THEN '佈置與禮品'::text
            WHEN 'PEOPLE_SERVICES'::"BudgetCostCategory" THEN '人員與服務'::text
            WHEN 'OTHER_PENDING'::"BudgetCostCategory" THEN '其他／待整理'::text
            ELSE NULL::text END)))`,
    );
    await transaction.$executeRawUnsafe(
      'CREATE UNIQUE INDEX "budget_items_workspace_system_category_key" ON "budget_items"("workspace_id", "system_category")',
    );

    const attachmentDataHex = "255044462d";
    await transaction.$executeRawUnsafe(
      `INSERT INTO "budget_attachments" (
        "id", "workspace_id", "budget_item_id", "original_name",
        "media_type", "byte_size", "sha256", "data",
        "uploaded_by_user_id", "created_at"
      ) VALUES (
        'production_drift_attachment_${runId}', '${workspaceIds[0]}',
        '${notionChildId(0)}', '匿名憑證.pdf', 'application/pdf', 5,
        encode(sha256(decode('${attachmentDataHex}', 'hex')), 'hex'),
        decode('${attachmentDataHex}', 'hex'), '${userIds[0]}',
        CURRENT_TIMESTAMP
      )`,
    );
  });

  return { manualChildId, notionChildId, rootId, userIds, workspaceIds };
}

function runFreshChain() {
  const environment = environmentFor(freshDatabaseUrl, true);
  const migrationStatus = run(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    environment,
  );
  if (migrationStatus !== 0) {
    return migrationStatus;
  }

  const integrationFiles = [
    "src/test/postgres-seating.integration.test.ts",
    "src/test/postgres-wedding-tasks.integration.test.ts",
    "src/test/postgres-guest-rsvp.integration.test.ts",
    "src/test/postgres-budget.integration.test.ts",
    "src/test/postgres-wedding-operations.integration.test.ts",
    "src/test/postgres-budget-attachments.integration.test.ts",
    "src/test/postgres-workspace-invitations.integration.test.ts",
    "src/test/postgres-profile-avatar.integration.test.ts",
    "src/test/postgres-user-access.integration.test.ts",
  ];
  for (const integrationFile of integrationFiles) {
    const testStatus = run(
      process.execPath,
      [vitestCli, "run", integrationFile, "--reporter=verbose"],
      environment,
    );
    if (testStatus !== 0) {
      return testStatus;
    }
  }

  return 0;
}

const priorGuestSnapshotSelect = {
  id: true,
  workspaceId: true,
  name: true,
  side: true,
  attendanceStatus: true,
  partySize: true,
  notes: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  seatingTableId: true,
};

async function seedPriorHeadData(priorClient) {
  const userId = `prior_user_${runId}`;
  const priorUserEmail = `prior-${runId}@example.test`;
  const legacyUserEmail = priorUserEmail;
  const legacyCollisionUserId = `prior_collision_user_${runId}`;
  const legacyCollisionUserEmail = priorUserEmail;
  const workspaceId = `prior_workspace_${runId}`;
  const membershipId = `prior_membership_${runId}`;
  const tableId = `prior_table_${runId}`;
  const guestId = `prior_target_linein_default_${runId}`;
  const lineinSecondaryGuestId = `prior_linein_secondary_guest_${runId}`;
  const futureRsvpGuestId = `prior_future_rsvp_guest_${runId}`;
  const unrelatedGuestId = `prior_unrelated_guest_${runId}`;
  const lineinSecondaryRsvpId = `prior_linein_secondary_rsvp_${runId}`;
  const futureRsvpId = `prior_future_rsvp_record_${runId}`;
  const taskId = `prior_task_${runId}`;
  const rsvpExternalId = ` prior_rsvp_${runId} `;
  const budgetPlanningId = `prior_budget_planning_${runId}`;
  const budgetBookedId = `prior_budget_booked_${runId}`;
  const budgetPaidId = `prior_budget_paid_${runId}`;
  const budgetNeutralGroupId = `prior_budget_group_${runId}`;
  const budgetKnownChildId = `prior_budget_child_${runId}`;
  const budgetPaidAt = new Date("2027-03-01T08:09:10.000Z");
  const rsvpSourceSubmittedAt = new Date("2026-07-22T08:30:00.000Z");
  const rsvpCreatedAt = new Date("2026-07-22T08:31:00.000Z");
  const rsvpUpdatedAt = new Date("2026-07-22T08:32:00.000Z");
  const guestCreatedAt = new Date("2026-07-20T06:00:00.000Z");
  const guestUpdatedAt = new Date("2026-07-21T07:00:00.000Z");

  await priorClient.$transaction([
    priorClient.$executeRaw`
      INSERT INTO "users" (
        "id", "google_subject", "email", "updated_at"
      ) VALUES (
        ${userId}, ${`prior-subject-${runId}`}, ${legacyUserEmail}, CURRENT_TIMESTAMP
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "users" (
        "id", "google_subject", "email", "updated_at"
      ) VALUES (
        ${legacyCollisionUserId},
        ${`prior-collision-subject-${runId}`},
        ${legacyCollisionUserEmail},
        CURRENT_TIMESTAMP
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "wedding_workspaces" (
        "id", "name", "created_by_id", "updated_at"
      ) VALUES (
        ${workspaceId}, ${"Prior-head 婚宴"}, ${userId}, CURRENT_TIMESTAMP
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "memberships" (
        "id", "workspace_id", "user_id", "role", "updated_at"
      ) VALUES (
        ${membershipId}, ${workspaceId}, ${userId}, CAST(${"OWNER"} AS "MembershipRole"), CURRENT_TIMESTAMP
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "seating_tables" (
        "id", "workspace_id", "position", "name", "capacity", "updated_at"
      ) VALUES (
        ${tableId}, ${workspaceId}, ${1}, ${"Prior-head 桌次"}, ${8}, CURRENT_TIMESTAMP
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guests" (
        "id", "workspace_id", "name", "side", "attendance_status",
        "party_size", "notes", "version", "seating_table_id",
        "created_at", "updated_at"
      ) VALUES (
        ${guestId}, ${workspaceId}, ${"Prior-head target 賓客"},
        CAST(${"SHARED"} AS "GuestSide"),
        CAST(${"ATTENDING"} AS "GuestAttendanceStatus"),
        ${3}, ${"target Guest 備註"}, ${7}, ${tableId},
        ${guestCreatedAt}, ${guestUpdatedAt}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guests" (
        "id", "workspace_id", "name", "side", "attendance_status",
        "party_size", "notes", "version", "seating_table_id",
        "created_at", "updated_at"
      ) VALUES (
        ${lineinSecondaryGuestId}, ${workspaceId}, ${"Prior-head secondary 賓客"},
        CAST(${"PARTNER_A"} AS "GuestSide"),
        CAST(${"DECLINED"} AS "GuestAttendanceStatus"),
        ${4}, ${"secondary Guest 備註"}, ${8}, ${null},
        ${new Date("2026-07-20T06:01:00.000Z")},
        ${new Date("2026-07-21T07:01:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guests" (
        "id", "workspace_id", "name", "side", "attendance_status",
        "party_size", "notes", "version", "seating_table_id",
        "created_at", "updated_at"
      ) VALUES (
        ${futureRsvpGuestId}, ${workspaceId}, ${"Prior-head future 賓客"},
        CAST(${"PARTNER_B"} AS "GuestSide"),
        CAST(${"ATTENDING"} AS "GuestAttendanceStatus"),
        ${5}, ${"future Guest 備註"}, ${9}, ${null},
        ${new Date("2026-07-20T06:02:00.000Z")},
        ${new Date("2026-07-21T07:02:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guests" (
        "id", "workspace_id", "name", "side", "attendance_status",
        "party_size", "notes", "version", "seating_table_id",
        "created_at", "updated_at"
      ) VALUES (
        ${unrelatedGuestId}, ${workspaceId}, ${"Prior-head unrelated 賓客"},
        CAST(${"SHARED"} AS "GuestSide"),
        CAST(${"UNDECIDED"} AS "GuestAttendanceStatus"),
        ${2}, ${"unrelated Guest 備註"}, ${10}, ${null},
        ${new Date("2026-07-20T06:03:00.000Z")},
        ${new Date("2026-07-21T07:03:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "wedding_tasks" (
        "id", "workspace_id", "title", "due_date", "updated_at"
      ) VALUES (
        ${taskId}, ${workspaceId}, ${"Prior-head 任務"},
        ${new Date("2028-02-29T00:00:00.000Z")}, CURRENT_TIMESTAMP
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guest_rsvps" (
        "id", "guest_id", "workspace_id", "source", "source_instance",
        "source_label", "source_managed", "managed_fields", "external_id",
        "source_party_size",
        "relationship_label", "contact_phone", "contact_email",
        "ceremony_attendance", "child_seat_count", "vegetarian_count",
        "invitation_delivery", "mailing_address", "guest_message",
        "attendance_reply", "invitation_reply", "source_submitted_at",
        "created_at", "updated_at"
      ) VALUES (
        ${guestId}, ${guestId}, ${workspaceId}, ${"LINEIN"}, ${"default"},
        ${"拍拍印"}, ${true}, ARRAY[
          'NAME'::"GuestManagedField",
          'SIDE'::"GuestManagedField",
          'ATTENDANCE_STATUS'::"GuestManagedField",
          'PARTY_SIZE'::"GuestManagedField"
        ],
        ${rsvpExternalId}, ${null}, ${"Prior-head target 關係"}, ${"0900000000"},
        ${"target@example.test"}, ${true}, ${1}, ${2},
        CAST(${"DIGITAL"} AS "InvitationDelivery"),
        ${"測試市 target 路 1 號"}, ${"target 來源留言"},
        ${"target 出席回覆"}, ${"target 喜帖回覆"},
        ${rsvpSourceSubmittedAt}, ${rsvpCreatedAt}, ${rsvpUpdatedAt}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guest_rsvps" (
        "id", "guest_id", "workspace_id", "source", "source_instance",
        "source_label", "source_managed", "managed_fields", "external_id",
        "source_party_size",
        "relationship_label", "contact_phone", "contact_email",
        "ceremony_attendance", "child_seat_count", "vegetarian_count",
        "invitation_delivery", "mailing_address", "guest_message",
        "attendance_reply", "invitation_reply", "source_submitted_at",
        "created_at", "updated_at"
      ) VALUES (
        ${lineinSecondaryRsvpId}, ${lineinSecondaryGuestId}, ${workspaceId},
        ${"LINEIN"}, ${"secondary"}, ${"LINEIN secondary"}, ${true},
        ARRAY['PARTY_SIZE'::"GuestManagedField"],
        ${` prior_secondary_external_${runId} `}, ${4},
        ${"secondary 完整關係"}, ${"0911111111"},
        ${"secondary@example.test"}, ${false}, ${2}, ${3},
        CAST(${"PAPER"} AS "InvitationDelivery"),
        ${"測試市 secondary 路 2 號"}, ${"secondary 完整留言"},
        ${"secondary 完整出席回覆"}, ${"secondary 完整喜帖回覆"},
        ${new Date("2026-07-22T08:33:00.000Z")},
        ${new Date("2026-07-22T08:34:00.000Z")},
        ${new Date("2026-07-22T08:35:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guest_rsvps" (
        "id", "guest_id", "workspace_id", "source", "source_instance",
        "source_label", "source_managed", "managed_fields", "external_id",
        "source_party_size",
        "relationship_label", "contact_phone", "contact_email",
        "ceremony_attendance", "child_seat_count", "vegetarian_count",
        "invitation_delivery", "mailing_address", "guest_message",
        "attendance_reply", "invitation_reply", "source_submitted_at",
        "created_at", "updated_at"
      ) VALUES (
        ${futureRsvpId}, ${futureRsvpGuestId}, ${workspaceId},
        ${"FUTURE_RSVP"}, ${"default"}, ${"Future RSVP"}, ${true},
        ARRAY['PARTY_SIZE'::"GuestManagedField"],
        ${` prior_future_external_${runId} `}, ${5},
        ${"future 完整關係"}, ${"0922222222"},
        ${"future@example.test"}, ${true}, ${4}, ${5},
        CAST(${"PAPER"} AS "InvitationDelivery"),
        ${"測試市 future 路 3 號"}, ${"future 完整留言"},
        ${"future 完整出席回覆"}, ${"future 完整喜帖回覆"},
        ${new Date("2026-07-22T08:36:00.000Z")},
        ${new Date("2026-07-22T08:37:00.000Z")},
        ${new Date("2026-07-22T08:38:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guest_import_batches" (
        "id", "workspace_id", "source", "source_instance", "source_label",
        "idempotency_key", "mapping_version", "status", "total_rows",
        "succeeded_rows", "failed_rows", "skipped_rows", "conflict_rows",
        "rerun_count", "started_at", "completed_at", "created_at", "updated_at"
      ) VALUES (
        ${`legacy-linein-default:${workspaceId}`}, ${workspaceId}, ${"LINEIN"},
        ${"default"}, ${"拍拍印"}, ${"legacy-unknown"}, ${"legacy-unknown"},
        CAST(${"SUCCEEDED"} AS "GuestImportBatchStatus"),
        ${1}, ${1}, ${0}, ${0}, ${0}, ${0},
        ${rsvpCreatedAt}, ${rsvpUpdatedAt}, ${rsvpCreatedAt}, ${rsvpUpdatedAt}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "guest_import_batch_rows" (
        "id", "workspace_id", "batch_id", "row_key", "external_id",
        "guest_import_record_id", "status", "attempt_count", "created_at", "updated_at"
      ) VALUES (
        ${`legacy-linein-default-row:${workspaceId}:1`}, ${workspaceId},
        ${`legacy-linein-default:${workspaceId}`}, ${"legacy-1"},
        ${rsvpExternalId}, ${guestId},
        CAST(${"SUCCEEDED"} AS "GuestImportRowStatus"),
        ${1}, ${rsvpCreatedAt}, ${rsvpUpdatedAt}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "budget_items" (
        "id", "workspace_id", "parent_id", "name", "kind", "category", "legacy_category",
        "planned_amount", "actual_amount", "due_date", "notes",
        "source", "external_id", "source_hash", "source_order",
        "booking_status", "deposit_amount", "balance_amount",
        "additional_amount", "paid", "paid_at",
        "version", "created_at", "updated_at"
      ) VALUES (
        ${budgetPlanningId}, ${workspaceId}, ${null},
        ${"Prior-head 規劃中預算"}, CAST(${"EXPENSE"} AS "BudgetItemKind"),
        CAST(${"OTHER_PENDING"} AS "BudgetCostCategory"), ${"Prior-head 分類"},
        ${123456}, ${120000},
        ${new Date("2028-02-29T00:00:00.000Z")}, ${"保留規劃中業務欄位"},
        CAST(${"MANUAL"} AS "BudgetItemSource"),
        ${null}, ${null}, ${null},
        CAST(${"PLANNING"} AS "BudgetBookingStatus"),
        ${null}, ${null}, ${null},
        ${false}, ${null}, ${7},
        ${new Date("2026-07-01T00:00:00.000Z")},
        ${new Date("2026-07-10T00:00:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "budget_items" (
        "id", "workspace_id", "parent_id", "name", "kind", "category", "legacy_category",
        "planned_amount", "actual_amount", "due_date", "notes",
        "source", "external_id", "source_hash", "source_order",
        "booking_status", "deposit_amount", "balance_amount",
        "additional_amount", "paid", "paid_at",
        "version", "created_at", "updated_at"
      ) VALUES (
        ${budgetBookedId}, ${workspaceId}, ${null},
        ${"Prior-head 已訂尾款預算"}, CAST(${"EXPENSE"} AS "BudgetItemKind"),
        CAST(${"OTHER_PENDING"} AS "BudgetCostCategory"), ${"Prior-head 分類"},
        ${456789}, ${444444},
        ${new Date("2028-03-15T00:00:00.000Z")}, ${"保留訂金與尾款業務欄位"},
        CAST(${"MANUAL"} AS "BudgetItemSource"),
        ${null}, ${null}, ${null},
        CAST(${"BOOKED_BALANCE_DUE"} AS "BudgetBookingStatus"),
        ${150000}, ${306789}, ${null},
        ${false}, ${null}, ${8},
        ${new Date("2026-07-02T00:00:00.000Z")},
        ${new Date("2026-07-11T00:00:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "budget_items" (
        "id", "workspace_id", "parent_id", "name", "kind", "category", "legacy_category",
        "planned_amount", "actual_amount", "due_date", "notes",
        "source", "external_id", "source_hash", "source_order",
        "booking_status", "deposit_amount", "balance_amount",
        "additional_amount", "paid", "paid_at",
        "version", "created_at", "updated_at"
      ) VALUES (
        ${budgetPaidId}, ${workspaceId}, ${null},
        ${"Prior-head 已付款預算"}, CAST(${"EXPENSE"} AS "BudgetItemKind"),
        CAST(${"OTHER_PENDING"} AS "BudgetCostCategory"), ${"Prior-head 分類"},
        ${654321}, ${650000}, ${null}, ${"保留已付款業務欄位"},
        CAST(${"MANUAL"} AS "BudgetItemSource"),
        ${null}, ${null}, ${null},
        CAST(${"PAID"} AS "BudgetBookingStatus"),
        ${100000}, ${554321}, ${null},
        ${true}, ${budgetPaidAt}, ${9},
        ${new Date("2026-07-03T00:00:00.000Z")},
        ${new Date("2026-07-12T00:00:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "budget_items" (
        "id", "workspace_id", "parent_id", "name", "kind", "category", "legacy_category",
        "planned_amount", "actual_amount", "due_date", "notes",
        "source", "external_id", "source_hash", "source_order",
        "booking_status", "deposit_amount", "balance_amount",
        "additional_amount", "paid", "paid_at",
        "version", "created_at", "updated_at"
      ) VALUES (
        ${budgetNeutralGroupId}, ${workspaceId}, ${null},
        ${"Prior-head 中性群組"}, CAST(${"GROUP"} AS "BudgetItemKind"),
        CAST(${null} AS "BudgetCostCategory"), ${"未知群組分類"},
        ${0}, ${null}, ${null}, ${null},
        CAST(${"MANUAL"} AS "BudgetItemSource"),
        ${null}, ${null}, ${null},
        CAST(${"PLANNING"} AS "BudgetBookingStatus"),
        ${null}, ${null}, ${null},
        ${false}, ${null}, ${10},
        ${new Date("2026-07-04T00:00:00.000Z")},
        ${new Date("2026-07-13T00:00:00.000Z")}
      )
    `,
    priorClient.$executeRaw`
      INSERT INTO "budget_items" (
        "id", "workspace_id", "parent_id", "name", "kind", "category", "legacy_category",
        "planned_amount", "actual_amount", "due_date", "notes",
        "source", "external_id", "source_hash", "source_order",
        "booking_status", "deposit_amount", "balance_amount",
        "additional_amount", "paid", "paid_at",
        "version", "created_at", "updated_at"
      ) VALUES (
        ${budgetKnownChildId}, ${workspaceId}, ${budgetNeutralGroupId},
        ${"Prior-head 已知分類子項"}, CAST(${"EXPENSE"} AS "BudgetItemKind"),
        CAST(${"VENUE_CATERING"} AS "BudgetCostCategory"), ${"場地與餐飲"},
        ${321}, ${null}, ${null}, ${"保留已知分類與階層"},
        CAST(${"MANUAL"} AS "BudgetItemSource"),
        ${null}, ${null}, ${null},
        CAST(${"PLANNING"} AS "BudgetBookingStatus"),
        ${null}, ${null}, ${null},
        ${false}, ${null}, ${11},
        ${new Date("2026-07-05T00:00:00.000Z")},
        ${new Date("2026-07-14T00:00:00.000Z")}
      )
    `,
  ]);

  const [priorGuests, priorRsvps] = await Promise.all([
    priorClient.guest.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
      select: priorGuestSnapshotSelect,
    }),
    priorClient.guestImportRecord.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
    }),
  ]);

  return {
    budgetBookedId,
    budgetKnownChildId,
    budgetNeutralGroupId,
    budgetPaidAt,
    budgetPaidId,
    budgetPlanningId,
    guestId,
    tableId,
    taskId,
    rsvpExternalId,
    rsvpSourceSubmittedAt,
    rsvpCreatedAt,
    rsvpUpdatedAt,
    userId,
    legacyCollisionUserId,
    priorUserEmail,
    priorGuestSnapshots: JSON.stringify(priorGuests),
    priorRsvpSnapshots: JSON.stringify(priorRsvps),
    workspaceId,
  };
}

async function runPriorHeadUpgrade() {
  preparePriorHeadMigrations();
  const environment = environmentFor(upgradeDatabaseUrl);
  const priorMigrationStatus = run(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", priorSchemaPath],
    environment,
  );
  if (priorMigrationStatus !== 0) {
    return priorMigrationStatus;
  }

  const priorClient = new PrismaClient({
    datasources: { db: { url: upgradeDatabaseUrl } },
  });
  let tableId;
  let guestId;
  let taskId;
  let rsvpExternalId;
  let rsvpSourceSubmittedAt;
  let rsvpCreatedAt;
  let rsvpUpdatedAt;
  let workspaceId;
  let budgetPlanningId;
  let budgetBookedId;
  let budgetPaidId;
  let budgetPaidAt;
  let budgetNeutralGroupId;
  let budgetKnownChildId;
  let userId;
  let legacyCollisionUserId;
  let priorUserEmail;
  let priorGuestSnapshots;
  let priorRsvpSnapshots;
  try {
    ({
      tableId,
      guestId,
      taskId,
      rsvpExternalId,
      rsvpSourceSubmittedAt,
      rsvpCreatedAt,
      rsvpUpdatedAt,
      workspaceId,
      budgetPlanningId,
      budgetBookedId,
      budgetPaidId,
      budgetPaidAt,
      budgetNeutralGroupId,
      budgetKnownChildId,
      userId,
      legacyCollisionUserId,
      priorUserEmail,
      priorGuestSnapshots,
      priorRsvpSnapshots,
    } = await seedPriorHeadData(priorClient));
  } finally {
    await priorClient.$disconnect();
  }

  const upgradeStatus = run(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    environment,
  );
  if (upgradeStatus !== 0) {
    return upgradeStatus;
  }

  const upgradedClient = new PrismaClient({
    datasources: { db: { url: upgradeDatabaseUrl } },
  });
  try {
    const [
      users,
      workspaces,
      memberships,
      guests,
      tables,
      tasks,
      rsvps,
      guestImportBatches,
      guestImportBatchRows,
      legacyImportBatch,
      budgetItems,
      fixedTaxonomyNodes,
      storedGuests,
      storedRsvps,
      storedGuest,
      storedTable,
      storedTask,
      storedRsvp,
      storedPlanningBudget,
      storedBookedBudget,
      storedPaidBudget,
      storedNeutralGroup,
      storedKnownChild,
      weddingStaff,
      weddingTimelineItems,
      weddingTimelineStaffAssignments,
      budgetAttachments,
      workspaceInvitations,
      userAvatars,
      storedPriorUser,
      storedCollisionUser,
      usersEmailConstraint,
      usersEmailUniqueIndex,
      usersEmailIndexes,
      lineinPartySizeConstraint,
      budgetRelatedTaxonomyConstraint,
      budgetSourceHierarchyPathConstraint,
      budgetTaxonomyNameConstraint,
    ] =
      await Promise.all([
        upgradedClient.user.count(),
        upgradedClient.weddingWorkspace.count(),
        upgradedClient.membership.count(),
        upgradedClient.guest.count(),
        upgradedClient.seatingTable.count(),
        upgradedClient.weddingTask.count(),
        upgradedClient.guestImportRecord.count(),
        upgradedClient.guestImportBatch.count(),
        upgradedClient.guestImportBatchRow.count(),
        upgradedClient.guestImportBatch.findUnique({
          where: { id: `legacy-linein-default:${workspaceId}` },
          include: { rows: true },
        }),
        upgradedClient.budgetItem.count(),
        upgradedClient.budgetItem.findMany({
          where: { workspaceId, systemTaxonomyKey: { not: null } },
          select: {
            id: true,
            name: true,
            parentId: true,
            systemTaxonomyKey: true,
          },
          orderBy: { systemTaxonomyKey: "asc" },
        }),
        upgradedClient.guest.findMany({
          where: { workspaceId },
          orderBy: { id: "asc" },
          select: priorGuestSnapshotSelect,
        }),
        upgradedClient.guestImportRecord.findMany({
          where: { workspaceId },
          orderBy: { id: "asc" },
        }),
        upgradedClient.guest.findUnique({
          where: { id: guestId },
        }),
        upgradedClient.seatingTable.findUnique({
          where: { id: tableId },
        }),
        upgradedClient.weddingTask.findUnique({
          where: { id: taskId },
        }),
        upgradedClient.guestImportRecord.findUnique({
          where: { id: guestId },
        }),
        upgradedClient.budgetItem.findUnique({
          where: { id: budgetPlanningId },
        }),
        upgradedClient.budgetItem.findUnique({
          where: { id: budgetBookedId },
        }),
        upgradedClient.budgetItem.findUnique({
          where: { id: budgetPaidId },
        }),
        upgradedClient.budgetItem.findUnique({
          where: { id: budgetNeutralGroupId },
        }),
        upgradedClient.budgetItem.findUnique({
          where: { id: budgetKnownChildId },
        }),
        upgradedClient.weddingStaffAssignment.count(),
        upgradedClient.weddingTimelineItem.count(),
        upgradedClient.weddingTimelineStaffAssignment.count(),
        upgradedClient.budgetAttachment.count(),
        upgradedClient.workspaceInvitation.count(),
        upgradedClient.userAvatar.count(),
        upgradedClient.user.findUnique({ where: { id: userId } }),
        upgradedClient.user.findUnique({
          where: { id: legacyCollisionUserId },
        }),
        upgradedClient.$queryRaw`
          SELECT conname
          FROM pg_constraint
          WHERE conname = ${"users_email_check"}
            AND conrelid = '"users"'::regclass
        `,
        upgradedClient.$queryRaw`
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = ${"users_email_key"}
        `,
        upgradedClient.$queryRaw`
          SELECT
            index_class.relname AS "indexName",
            index_meta.indisunique AS "isUnique"
          FROM pg_index AS index_meta
          JOIN pg_class AS table_class
            ON table_class.oid = index_meta.indrelid
          JOIN pg_class AS index_class
            ON index_class.oid = index_meta.indexrelid
          WHERE table_class.oid = '"users"'::regclass
            AND index_class.relname = ${"users_email_idx"}
        `,
        upgradedClient.$queryRaw`
          SELECT
            conname AS "constraintName",
            convalidated AS "validated"
          FROM pg_constraint
          WHERE conrelid = '"guest_rsvps"'::regclass
            AND conname = ${"guest_rsvps_linein_default_no_party_size_check"}
        `,
        upgradedClient.$queryRaw`
          SELECT
            conname AS "constraintName",
            convalidated AS "validated"
          FROM pg_constraint
          WHERE conrelid = '"budget_items"'::regclass
            AND conname = ${"budget_items_related_taxonomy_item_key_check"}
        `,
        upgradedClient.$queryRaw`
          SELECT
            conname AS "constraintName",
            convalidated AS "validated"
          FROM pg_constraint
          WHERE conrelid = '"budget_items"'::regclass
            AND conname = ${"budget_items_source_hierarchy_path_check"}
        `,
        upgradedClient.$queryRaw`
          SELECT
            conname AS "constraintName",
            convalidated AS "validated",
            pg_get_constraintdef(oid) AS "definition"
          FROM pg_constraint
          WHERE conrelid = '"budget_items"'::regclass
            AND conname = ${"budget_items_system_taxonomy_name_check"}
        `,
      ]);

    const storedGuestSnapshots = JSON.stringify(storedGuests);
    const expectedRsvpSnapshots = JSON.stringify(
      JSON.parse(priorRsvpSnapshots).map((record) =>
        record.id === guestId
          ? {
              ...record,
              sourceManaged: true,
              managedFields: record.managedFields.filter(
                (field) => field !== "PARTY_SIZE",
              ),
              sourcePartySize: record.sourcePartySize ?? storedGuest?.partySize,
              updatedAt: storedRsvp?.updatedAt?.toISOString(),
            }
          : record,
      ),
    );
    const storedRsvpSnapshots = JSON.stringify(storedRsvps);
    const fixedTaxonomyByKey = new Map(
      fixedTaxonomyNodes.map((node) => [node.systemTaxonomyKey, node]),
    );
    const fixedTaxonomyById = new Map(
      fixedTaxonomyNodes.map((node) => [node.id, node]),
    );
    const expectedStageKeys = new Set([
      "STAGE_PREPARATION_1_2_MONTHS",
      "STAGE_PREPARATION_3_MONTH",
      "STAGE_PREPARATION_4_MONTH",
      "STAGE_COUNTDOWN_2_MONTHS",
      "STAGE_ENGAGEMENT_CEREMONY",
      "STAGE_WEDDING_PROCESSION",
      "INTERNAL_UNCLASSIFIED_STAGE",
    ]);
    const expectedItemParentKeys = new Map([
      ["ITEM_PROPOSAL", "STAGE_PREPARATION_1_2_MONTHS"],
      ["ITEM_WEDDING_VENUE", "STAGE_PREPARATION_1_2_MONTHS"],
      ["ITEM_PRE_WEDDING_PHOTOGRAPHY", "STAGE_PREPARATION_1_2_MONTHS"],
      ["ITEM_WEDDING_CAKES", "STAGE_PREPARATION_3_MONTH"],
      ["ITEM_BRIDAL_STYLIST", "STAGE_PREPARATION_3_MONTH"],
      ["ITEM_WEDDING_PHOTOGRAPHY", "STAGE_PREPARATION_3_MONTH"],
      ["ITEM_WEDDING_VIDEOGRAPHY", "STAGE_PREPARATION_3_MONTH"],
      ["ITEM_WEDDING_HOST", "STAGE_PREPARATION_3_MONTH"],
      ["ITEM_WEDDING_BAND", "STAGE_PREPARATION_3_MONTH"],
      ["ITEM_WEDDING_INTERACTION", "STAGE_PREPARATION_3_MONTH"],
      ["ITEM_ATTIRE_RENTAL", "STAGE_PREPARATION_4_MONTH"],
      ["ITEM_WEDDING_SHOES", "STAGE_PREPARATION_4_MONTH"],
      ["ITEM_WEDDING_DECOR", "STAGE_PREPARATION_4_MONTH"],
      ["ITEM_INVITATIONS_POSTAGE", "STAGE_COUNTDOWN_2_MONTHS"],
      ["ITEM_BEAUTY_TREATMENTS", "STAGE_COUNTDOWN_2_MONTHS"],
      ["ITEM_WEDDING_FAVORS", "STAGE_COUNTDOWN_2_MONTHS"],
      ["ITEM_ENGAGEMENT_GROOM", "STAGE_ENGAGEMENT_CEREMONY"],
      ["ITEM_ENGAGEMENT_BRIDE", "STAGE_ENGAGEMENT_CEREMONY"],
      ["ITEM_PROCESSION_GROOM", "STAGE_WEDDING_PROCESSION"],
      ["ITEM_PROCESSION_BRIDE", "STAGE_WEDDING_PROCESSION"],
      ["INTERNAL_UNCLASSIFIED_ITEM", "INTERNAL_UNCLASSIFIED_STAGE"],
    ]);
    const fixedTaxonomyTopologyIsValid =
      fixedTaxonomyNodes.length === 28 &&
      fixedTaxonomyByKey.size === 28 &&
      [...fixedTaxonomyByKey.keys()].filter((key) => key.startsWith("ITEM_"))
        .length === 20 &&
      expectedStageKeys.size === 7 &&
      expectedItemParentKeys.size === 21 &&
      fixedTaxonomyByKey.get("ITEM_PROPOSAL")?.name === "求婚" &&
      [...expectedStageKeys].every(
        (stageKey) => fixedTaxonomyByKey.get(stageKey)?.parentId === null,
      ) &&
      [...expectedItemParentKeys].every(([itemKey, parentKey]) => {
        const item = fixedTaxonomyByKey.get(itemKey);
        const parent = item?.parentId
          ? fixedTaxonomyById.get(item.parentId)
          : null;
        return parent?.systemTaxonomyKey === parentKey;
      });
    const internalItemId = fixedTaxonomyByKey.get(
      "INTERNAL_UNCLASSIFIED_ITEM",
    )?.id;

    if (
      users !== 2 ||
      workspaces !== 1 ||
      memberships !== 1 ||
      guests !== 4 ||
      tables !== 1 ||
      tasks !== 1 ||
      rsvps !== 3 ||
      guestImportBatches !== 1 ||
      guestImportBatchRows !== 1 ||
      legacyImportBatch?.workspaceId !== workspaceId ||
      legacyImportBatch?.source !== "LINEIN" ||
      legacyImportBatch?.sourceInstance !== "default" ||
      legacyImportBatch?.idempotencyKey !== "legacy-unknown" ||
      legacyImportBatch?.mappingVersion !== "legacy-unknown" ||
      legacyImportBatch?.status !== "SUCCEEDED" ||
      legacyImportBatch?.totalRows !== 1 ||
      legacyImportBatch?.succeededRows !== 1 ||
      legacyImportBatch?.rows.length !== 1 ||
      legacyImportBatch?.rows[0]?.workspaceId !== workspaceId ||
      legacyImportBatch?.rows[0]?.guestImportRecordId !== guestId ||
      legacyImportBatch?.rows[0]?.externalId !== rsvpExternalId ||
      legacyImportBatch?.rows[0]?.status !== "SUCCEEDED" ||
      budgetItems !== 33 ||
      !fixedTaxonomyTopologyIsValid ||
      !internalItemId ||
      storedGuest?.seatingTableId !== tableId ||
      storedGuest?.partySize !== 3 ||
      storedGuest?.category !== "GUEST" ||
      storedGuest?.seniority !== "UNSPECIFIED" ||
      storedGuest?.version !== 7 ||
      storedTable?.workspaceId !== workspaceId ||
      storedTable?.name !== "Prior-head 桌次" ||
      storedTable?.capacity !== 8 ||
      storedTable?.position !== 1 ||
      storedTable?.layoutX !== null ||
      storedTable?.layoutY !== null ||
      storedTask?.workspaceId !== workspaceId ||
      storedTask?.title !== "Prior-head 任務" ||
      storedTask?.side !== "SHARED" ||
      storedRsvp?.id !== guestId ||
      storedRsvp?.workspaceId !== workspaceId ||
      storedRsvp?.guestId !== guestId ||
      storedRsvp?.source !== "LINEIN" ||
      storedRsvp?.sourceInstance !== "default" ||
      storedRsvp?.sourceLabel !== "拍拍印" ||
      storedRsvp?.sourceManaged !== true ||
      storedRsvp?.managedFields.join(",") !==
        "NAME,SIDE,ATTENDANCE_STATUS" ||
      storedRsvp?.sourcePartySize !== 3 ||
      storedRsvp?.externalId !== rsvpExternalId ||
      storedRsvp?.relationshipLabel !== "Prior-head target 關係" ||
      storedRsvp?.contactPhone !== "0900000000" ||
      storedRsvp?.contactEmail !== "target@example.test" ||
      storedRsvp?.ceremonyAttendance !== true ||
      storedRsvp?.childSeatCount !== 1 ||
      storedRsvp?.vegetarianCount !== 2 ||
      storedRsvp?.invitationDelivery !== "DIGITAL" ||
      storedRsvp?.mailingAddress !== "測試市 target 路 1 號" ||
      storedRsvp?.guestMessage !== "target 來源留言" ||
      storedRsvp?.attendanceReply !== "target 出席回覆" ||
      storedRsvp?.invitationReply !== "target 喜帖回覆" ||
      storedRsvp?.sourceSubmittedAt?.toISOString() !==
        rsvpSourceSubmittedAt.toISOString() ||
      storedRsvp?.createdAt?.toISOString() !== rsvpCreatedAt.toISOString() ||
      (storedRsvp?.updatedAt?.getTime() ?? 0) <= rsvpUpdatedAt.getTime() ||
      storedGuestSnapshots !== priorGuestSnapshots ||
      storedRsvpSnapshots !== expectedRsvpSnapshots ||
      storedPlanningBudget?.workspaceId !== workspaceId ||
      storedPlanningBudget?.parentId !== internalItemId ||
      storedPlanningBudget?.source !== "MANUAL" ||
      storedPlanningBudget?.externalId !== null ||
      storedPlanningBudget?.sourceHash !== null ||
      storedPlanningBudget?.sourceOrder !== null ||
      storedPlanningBudget?.bookingStatus !== "PLANNING" ||
      storedPlanningBudget?.name !== "Prior-head 規劃中預算" ||
      storedPlanningBudget?.kind !== "EXPENSE" ||
      storedPlanningBudget?.category !== "OTHER_PENDING" ||
      storedPlanningBudget?.legacyCategory !== "Prior-head 分類" ||
      storedPlanningBudget?.plannedAmount !== 123456 ||
      storedPlanningBudget?.actualAmount !== 120000 ||
      storedPlanningBudget?.dueDate?.toISOString().slice(0, 10) !==
        "2028-02-29" ||
      storedPlanningBudget?.notes !== "保留規劃中業務欄位" ||
      storedPlanningBudget?.depositAmount !== null ||
      storedPlanningBudget?.balanceAmount !== null ||
      storedPlanningBudget?.additionalAmount !== null ||
      storedPlanningBudget?.paid !== false ||
      storedPlanningBudget?.paidAt !== null ||
      storedPlanningBudget?.version !== 8 ||
      storedPlanningBudget?.relatedTaxonomyItemKey !== null ||
      storedPlanningBudget?.sourceHierarchyPath.length !== 0 ||
      storedBookedBudget?.workspaceId !== workspaceId ||
      storedBookedBudget?.parentId !== internalItemId ||
      storedBookedBudget?.source !== "MANUAL" ||
      storedBookedBudget?.externalId !== null ||
      storedBookedBudget?.sourceHash !== null ||
      storedBookedBudget?.sourceOrder !== null ||
      storedBookedBudget?.bookingStatus !== "BOOKED_BALANCE_DUE" ||
      storedBookedBudget?.name !== "Prior-head 已訂尾款預算" ||
      storedBookedBudget?.kind !== "EXPENSE" ||
      storedBookedBudget?.category !== "OTHER_PENDING" ||
      storedBookedBudget?.legacyCategory !== "Prior-head 分類" ||
      storedBookedBudget?.plannedAmount !== 456789 ||
      storedBookedBudget?.actualAmount !== 444444 ||
      storedBookedBudget?.dueDate?.toISOString().slice(0, 10) !==
        "2028-03-15" ||
      storedBookedBudget?.notes !== "保留訂金與尾款業務欄位" ||
      storedBookedBudget?.depositAmount !== 150000 ||
      storedBookedBudget?.balanceAmount !== 306789 ||
      storedBookedBudget?.additionalAmount !== null ||
      storedBookedBudget?.paid !== false ||
      storedBookedBudget?.paidAt !== null ||
      storedBookedBudget?.version !== 9 ||
      storedPaidBudget?.workspaceId !== workspaceId ||
      storedBookedBudget?.relatedTaxonomyItemKey !== null ||
      storedBookedBudget?.sourceHierarchyPath.length !== 0 ||
      storedPaidBudget?.parentId !== internalItemId ||
      storedPaidBudget?.source !== "MANUAL" ||
      storedPaidBudget?.externalId !== null ||
      storedPaidBudget?.sourceHash !== null ||
      storedPaidBudget?.sourceOrder !== null ||
      storedPaidBudget?.bookingStatus !== "PAID" ||
      storedPaidBudget?.name !== "Prior-head 已付款預算" ||
      storedPaidBudget?.kind !== "EXPENSE" ||
      storedPaidBudget?.category !== "OTHER_PENDING" ||
      storedPaidBudget?.legacyCategory !== "Prior-head 分類" ||
      storedPaidBudget?.plannedAmount !== 654321 ||
      storedPaidBudget?.actualAmount !== 650000 ||
      storedPaidBudget?.dueDate !== null ||
      storedPaidBudget?.notes !== "保留已付款業務欄位" ||
      storedPaidBudget?.depositAmount !== 100000 ||
      storedPaidBudget?.balanceAmount !== 554321 ||
      storedPaidBudget?.additionalAmount !== null ||
      storedPaidBudget?.paid !== true ||
      storedPaidBudget?.relatedTaxonomyItemKey !== null ||
      storedPaidBudget?.sourceHierarchyPath.length !== 0 ||
      storedPaidBudget?.paidAt?.toISOString() !== budgetPaidAt.toISOString() ||
      storedPaidBudget?.version !== 10 ||
      storedNeutralGroup?.workspaceId !== workspaceId ||
      storedNeutralGroup?.parentId !== internalItemId ||
      storedNeutralGroup?.name !== "Prior-head 中性群組" ||
      storedNeutralGroup?.kind !== "GROUP" ||
      storedNeutralGroup?.category !== null ||
      storedNeutralGroup?.legacyCategory !== "未知群組分類" ||
      storedNeutralGroup?.plannedAmount !== 0 ||
      storedNeutralGroup?.actualAmount !== null ||
      storedNeutralGroup?.bookingStatus !== "PLANNING" ||
      storedNeutralGroup?.paid !== false ||
      storedNeutralGroup?.relatedTaxonomyItemKey !== null ||
      storedNeutralGroup?.sourceHierarchyPath.length !== 0 ||
      storedNeutralGroup?.version !== 11 ||
      storedKnownChild?.workspaceId !== workspaceId ||
      storedKnownChild?.parentId !== budgetNeutralGroupId ||
      storedKnownChild?.name !== "Prior-head 已知分類子項" ||
      storedKnownChild?.kind !== "EXPENSE" ||
      storedKnownChild?.category !== "VENUE_CATERING" ||
      storedKnownChild?.legacyCategory !== "場地與餐飲" ||
      storedKnownChild?.plannedAmount !== 321 ||
      storedKnownChild?.notes !== "保留已知分類與階層" ||
      storedKnownChild?.version !== 11 ||
      weddingStaff !== 0 ||
      storedKnownChild?.relatedTaxonomyItemKey !== null ||
      storedKnownChild?.sourceHierarchyPath.length !== 0 ||
      weddingTimelineItems !== 0 ||
      weddingTimelineStaffAssignments !== 0 ||
      budgetAttachments !== 0 ||
      workspaceInvitations !== 0 ||
      userAvatars !== 0 ||
      storedPriorUser?.email !== priorUserEmail ||
      storedPriorUser?.accessStatus !== "ACTIVE" ||
      storedPriorUser?.accessStatusChangedAt !== null ||
      storedPriorUser?.lastLoginAt !== null ||
      storedPriorUser?.version !== 0 ||
      storedCollisionUser?.email !== priorUserEmail ||
      storedCollisionUser?.accessStatus !== "ACTIVE" ||
      storedCollisionUser?.accessStatusChangedAt !== null ||
      storedCollisionUser?.lastLoginAt !== null ||
      storedCollisionUser?.version !== 0 ||
      !Array.isArray(usersEmailConstraint) ||
      usersEmailConstraint.length !== 1 ||
      !Array.isArray(usersEmailUniqueIndex) ||
      usersEmailUniqueIndex.length !== 0 ||
      !Array.isArray(usersEmailIndexes) ||
      usersEmailIndexes.length !== 1 ||
      usersEmailIndexes[0]?.isUnique !== false ||
      !Array.isArray(lineinPartySizeConstraint) ||
      lineinPartySizeConstraint.length !== 1 ||
      lineinPartySizeConstraint[0]?.validated !== true ||
      !Array.isArray(budgetRelatedTaxonomyConstraint) ||
      budgetRelatedTaxonomyConstraint.length !== 1 ||
      budgetRelatedTaxonomyConstraint[0]?.validated !== true ||
      !Array.isArray(budgetSourceHierarchyPathConstraint) ||
      budgetSourceHierarchyPathConstraint.length !== 1 ||
      budgetSourceHierarchyPathConstraint[0]?.validated !== true ||
      !Array.isArray(budgetTaxonomyNameConstraint) ||
      budgetTaxonomyNameConstraint.length !== 1 ||
      budgetTaxonomyNameConstraint[0]?.validated !== true ||
      !budgetTaxonomyNameConstraint[0]?.definition?.includes("ITEM_PROPOSAL") ||
      !budgetTaxonomyNameConstraint[0]?.definition?.includes("求婚") ||
      budgetTaxonomyNameConstraint[0]?.definition?.includes("提親")
    ) {
      console.error(
        "Prior-head verification snapshot:",
        JSON.stringify(
          {
            counts: {
              users,
              workspaces,
              memberships,
              guests,
              tables,
              tasks,
              rsvps,
              guestImportBatches,
              guestImportBatchRows,
              budgetItems,
              weddingStaff,
              weddingTimelineItems,
              weddingTimelineStaffAssignments,
              budgetAttachments,
              workspaceInvitations,
              userAvatars,
            },
            fixedTaxonomyNodes,
            storedPriorUser,
            storedCollisionUser,
            usersEmailConstraint,
            usersEmailUniqueIndex,
            usersEmailIndexes,
            lineinPartySizeConstraint,
            budgetRelatedTaxonomyConstraint,
            budgetSourceHierarchyPathConstraint,
            budgetTaxonomyNameConstraint,
            priorGuestSnapshots,
            priorRsvpSnapshots,
            storedGuestSnapshots,
            expectedRsvpSnapshots,
            storedRsvpSnapshots,
            storedGuest,
            storedTable,
            storedTask,
            storedRsvp,
            storedPlanningBudget,
            storedBookedBudget,
            storedPaidBudget,
            storedNeutralGroup,
            storedKnownChild,
          },
          null,
          2,
        ),
      );
      throw new Error("prior-head upgrade verification failed");
    }

    const appliedPreparationSuggestion = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${preparationSuggestionMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedPreparationSuggestion) ||
      appliedPreparationSuggestion.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: preparation-suggestion migration missing",
      );
    }
    const appliedFloorPlan = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${floorPlanMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (!Array.isArray(appliedFloorPlan) || appliedFloorPlan.length !== 1) {
      throw new Error(
        "prior-head upgrade verification failed: floor-plan migration missing",
      );
    }
    const appliedDuplicateNames = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${duplicateNamesMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedDuplicateNames) ||
      appliedDuplicateNames.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: duplicate-names migration missing",
      );
    }
    const appliedRosterCategories = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${rosterCategoriesMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedRosterCategories) ||
      appliedRosterCategories.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: roster-categories migration missing",
      );
    }
    const appliedTaskSides = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${taskSidesMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (!Array.isArray(appliedTaskSides) || appliedTaskSides.length !== 1) {
      throw new Error(
        "prior-head upgrade verification failed: task-sides migration missing",
      );
    }
    const appliedAvatar = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${avatarMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (!Array.isArray(appliedAvatar) || appliedAvatar.length !== 1) {
      throw new Error(
        "prior-head upgrade verification failed: profile-avatar migration missing",
      );
    }
    const appliedGuestDetails = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${guestDetailsMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (!Array.isArray(appliedGuestDetails) || appliedGuestDetails.length !== 1) {
      throw new Error(
        "prior-head upgrade verification failed: guest-details migration missing",
      );
    }
    const appliedUserAccess = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${userAccessMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (!Array.isArray(appliedUserAccess) || appliedUserAccess.length !== 1) {
      throw new Error(
        "prior-head upgrade verification failed: user-access migration missing",
      );
    }
    const appliedFamilyPartySize = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${familyPartySizeMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedFamilyPartySize) ||
      appliedFamilyPartySize.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: family-party-size migration missing",
      );
    }
    const appliedGuestSeniority = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${guestSeniorityMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedGuestSeniority) ||
      appliedGuestSeniority.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: guest-seniority migration missing",
      );
    }
    const duplicateNameIndexes = await upgradedClient.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = ${"seating_tables"}
        AND indexname = ${"seating_tables_workspace_id_name_key"}
    `;
    if (
      !Array.isArray(duplicateNameIndexes) ||
      duplicateNameIndexes.length !== 0
    ) {
      throw new Error(
        "prior-head upgrade verification failed: table-name uniqueness still exists",
      );
    }
    const appliedEngagementSuggestion = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${engagementSuggestionMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedEngagementSuggestion) ||
      appliedEngagementSuggestion.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: engagement-suggestion migration missing",
      );
    }
    const appliedProposalLabel = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${proposalLabelMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedProposalLabel) ||
      appliedProposalLabel.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: proposal-label migration missing",
      );
    }
    const appliedRepair = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${repairMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (!Array.isArray(appliedRepair) || appliedRepair.length !== 1) {
      throw new Error("prior-head upgrade verification failed: repair migration missing");
    }
    const appliedSourceHierarchy = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${sourceHierarchyMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedSourceHierarchy) ||
      appliedSourceHierarchy.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: source-hierarchy migration missing",
      );
    }
    const appliedRelatedTaxonomy = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${relatedTaxonomyMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedRelatedTaxonomy) ||
      appliedRelatedTaxonomy.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: related-taxonomy migration missing",
      );
    }
    const appliedFixedGroups = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${fixedGroupsMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (
      !Array.isArray(appliedFixedGroups) ||
      appliedFixedGroups.length !== 1
    ) {
      throw new Error(
        "prior-head upgrade verification failed: fixed-groups migration missing",
      );
    }
    const appliedFailClosed = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${failClosedMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (!Array.isArray(appliedFailClosed) || appliedFailClosed.length !== 1) {
      throw new Error(
        "prior-head upgrade verification failed: fail-closed migration missing",
      );
    }
    const appliedPriorHead = await upgradedClient.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = ${priorHeadMigration}
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    if (!Array.isArray(appliedPriorHead) || appliedPriorHead.length !== 1) {
      throw new Error(
        "prior-head upgrade verification failed: immediate prior head missing",
      );
    }
  } finally {
    await upgradedClient.$disconnect();
  }

  console.log(
    `Prior-head upgrade passed: ${failClosedMigration} normalized the stale LINEIN/default target and validated the fail-closed PARTY_SIZE constraint, then ${fixedGroupsMigration} established six public Drive budget stages and twenty public Drive item groups plus one hidden internal preservation stage and item group, ${relatedTaxonomyMigration} added the validated optional public Drive item purpose relation, ${sourceHierarchyMigration} added the validated Notion source hierarchy path with an empty path for every existing Budget row, ${repairMigration} accepted the canonical final shape as a data no-op, ${proposalLabelMigration} changed only ITEM_PROPOSAL from 提親 to 求婚, and ${engagementSuggestionMigration} added the nullable workspace-scoped engagement suggestion identity, then ${preparationSuggestionMigration} expanded the validated identity constraint to PREPARATION keys while preserving the same key, all twenty public item groups, and all twenty-eight system nodes; ${floorPlanMigration} added nullable paired floor-plan coordinates without backfilling the legacy table; ${duplicateNamesMigration} removed table-name uniqueness while preserving position identity; ${taskSidesMigration} defaulted the verified prior-head task to SHARED; ${avatarMigration} added an empty one-to-one private avatar table; ${guestDetailsMigration} allowed normalized invitation choices without source-specific reply text while preserving paper-address enforcement; ${userAccessMigration} defaulted existing users to ACTIVE with null access audit and login timestamps; ${familyPartySizeMigration} allowed FAMILY party size while keeping COUPLE one person; ${guestSeniorityMigration} kept existing ordinary guests explicitly UNSPECIFIED for manual classification; preserved all scalar values across 4 Guests, preserved all scalar provenance values for LINEIN/secondary and FUTURE_RSVP, changed only the target sourcePartySize, managedFields, sourceManaged, and updatedAt values, preserved the table ID, name, capacity, position, and target Guest assignment, and kept the verified prior-head task, audit, Budget, attachment, invitation, user, workspace, and membership fixtures unchanged.`,
  );
  return 0;
}

async function snapshotProductionDriftAttachments(client) {
  const [snapshot] = await client.$queryRaw`
    SELECT
      count(*)::INTEGER AS "count",
      COALESCE(
        md5(string_agg(
          concat_ws(
            E'\\x1f',
            "id", "workspace_id", "budget_item_id", "original_name",
            "media_type", "byte_size"::TEXT, "sha256", encode("data", 'hex'),
            "uploaded_by_user_id", "created_at"::TEXT
          ),
          E'\\x1e' ORDER BY "id"
        )),
        md5('')
      ) AS "digest"
    FROM "budget_attachments"
  `;
  return snapshot;
}

async function snapshotProductionDriftChildren(client) {
  const [snapshot] = await client.$queryRaw`
    SELECT
      count(*)::INTEGER AS "count",
      COALESCE(
        md5(string_agg(
          (
            to_jsonb("child")
            - 'system_category'
            - 'system_taxonomy_key'
            - 'suggestion_key'
          )::TEXT,
          E'\\x1e' ORDER BY "child"."id"
        )),
        md5('')
      ) AS "digest"
    FROM "budget_items" AS "child"
    WHERE "child"."id" LIKE ${`production_drift_%_child_%_${runId}`}
  `;
  return snapshot;
}

async function snapshotProductionDriftOrdinaryRows(client) {
  const [snapshot] = await client.$queryRaw`
    SELECT
      count(*)::INTEGER AS "count",
      COALESCE(
        md5(string_agg(
          (
            to_jsonb("item")
            - 'parent_id'
            - 'source_order'
            - 'version'
            - 'updated_at'
            - 'system_category'
            - 'system_taxonomy_key'
            - 'suggestion_key'
          )::TEXT,
          E'\\x1e' ORDER BY "item"."id"
        )),
        md5('')
      ) AS "digest"
    FROM "budget_items" AS "item"
    WHERE "item"."id" LIKE ${`production_drift_%_${runId}`}
  `;
  return snapshot;
}

async function snapshotAllBudgetRows(client) {
  const [snapshot] = await client.$queryRaw`
    SELECT
      count(*)::INTEGER AS "count",
      COALESCE(
        md5(string_agg(
          to_jsonb("item")::TEXT,
          E'\\x1e' ORDER BY "item"."id"
        )),
        md5('')
      ) AS "digest"
    FROM "budget_items" AS "item"
  `;
  return snapshot;
}

async function runProductionDriftRepair() {
  prepareProductionDriftMigrations();
  const environment = environmentFor(productionDriftDatabaseUrl);
  const driftBaseStatus = run(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", productionDriftSchemaPath],
    environment,
  );
  if (driftBaseStatus !== 0) {
    return driftBaseStatus;
  }

  const driftClient = new PrismaClient({
    datasources: { db: { url: productionDriftDatabaseUrl } },
  });
  let fixture;
  try {
    fixture = await seedProductionDriftData(driftClient);
  } finally {
    await driftClient.$disconnect();
  }

  extendProductionDriftMigrations();
  const resolveStatus = run(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "resolve",
      "--applied",
      fixedGroupsMigration,
      "--schema",
      productionDriftSchemaPath,
    ],
    environment,
  );
  if (resolveStatus !== 0) {
    return resolveStatus;
  }
  const driftTailStatus = run(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", productionDriftSchemaPath],
    environment,
  );
  if (driftTailStatus !== 0) {
    return driftTailStatus;
  }

  const preRepairClient = new PrismaClient({
    datasources: { db: { url: productionDriftDatabaseUrl } },
  });
  let beforeAttachmentSnapshot;
  let beforeChildSnapshot;
  let beforeOrdinarySnapshot;
  let beforeRoots;
  let currentHeadBudgetSnapshot;
  let currentHeadAttachmentSnapshot;
  try {
    await preRepairClient.$executeRaw`
      UPDATE "budget_items"
      SET
        "related_taxonomy_item_key" = 'ITEM_PRE_WEDDING_PHOTOGRAPHY',
        "source_hierarchy_path" = ARRAY[
          '拍攝婚紗', '服裝與造型', '小白鞋'
        ]::TEXT[]
      WHERE "id" = ${fixture.notionChildId(0)}
    `;

    const checkedInFixedChecksum = createHash("sha256")
      .update(
        readFileSync(
          path.join(
            migrationsDirectory,
            fixedGroupsMigration,
            "migration.sql",
          ),
        ),
      )
      .digest("hex");
    const driftFixedChecksum = createHash("sha256")
      .update(
        readFileSync(
          path.join(
            productionDriftMigrationsDirectory,
            fixedGroupsMigration,
            "migration.sql",
          ),
        ),
      )
      .digest("hex");
    const [storedFixedMigration] = await preRepairClient.$queryRaw`
      SELECT "checksum"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${fixedGroupsMigration}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;
    const preRepairHistory = await preRepairClient.$queryRaw`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" IN (
        ${fixedGroupsMigration},
        ${relatedTaxonomyMigration},
        ${sourceHierarchyMigration},
        ${repairMigration}
      )
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
      ORDER BY "migration_name"
    `;
    const [preRepairShape] = await preRepairClient.$queryRaw`
      SELECT
        (
          SELECT count(*)::INTEGER
          FROM "information_schema"."columns"
          WHERE "table_schema" = current_schema()
            AND "table_name" = 'budget_items'
            AND "column_name" = 'system_category'
            AND "is_nullable" = 'YES'
            AND "udt_name" = 'BudgetCostCategory'
            AND "column_default" IS NULL
        ) AS "systemCategoryColumns",
        EXISTS (
          SELECT 1
          FROM "information_schema"."columns"
          WHERE "table_schema" = current_schema()
            AND "table_name" = 'budget_items'
            AND "column_name" = 'system_taxonomy_key'
        ) AS "hasSystemTaxonomy",
        (
          SELECT count(*)::INTEGER
          FROM "pg_constraint"
          WHERE "conrelid" = '"budget_items"'::regclass
            AND "conname" IN (
              'budget_items_source_identity_check',
              'budget_items_root_category_group_check',
              'budget_items_system_category_group_check',
              'budget_items_system_category_name_check',
              'budget_items_related_taxonomy_item_key_check',
              'budget_items_source_hierarchy_path_check'
            )
            AND "convalidated"
        ) AS "validatedExpectedConstraints",
        EXISTS (
          SELECT 1
          FROM "pg_class" AS "index_class"
          INNER JOIN "pg_index" AS "index_meta"
            ON "index_meta"."indexrelid" = "index_class"."oid"
          WHERE "index_class"."relname" =
              'budget_items_workspace_system_category_key'
            AND "index_meta"."indrelid" = '"budget_items"'::regclass
            AND "index_meta"."indisunique"
            AND "index_meta"."indisvalid"
            AND "index_meta"."indisready"
            AND "index_meta"."indpred" IS NULL
            AND "index_meta"."indexprs" IS NULL
            AND "index_meta"."indnkeyatts" = 2
            AND "index_meta"."indnatts" = 2
        ) AS "experimentalIndexExact"
    `;
    const preRepairRootSummary = await preRepairClient.$queryRaw`
      SELECT
        "workspace_id" AS "workspaceId",
        count(*)::INTEGER AS "rootCount",
        count(DISTINCT "system_category")::INTEGER AS "categoryCount"
      FROM "budget_items"
      WHERE "parent_id" IS NULL
        AND "system_category" IS NOT NULL
      GROUP BY "workspace_id"
      ORDER BY "workspace_id"
    `;
    const [{ count: preRepairOrdinaryRoots }] = await preRepairClient.$queryRaw`
      SELECT count(*)::INTEGER AS "count"
      FROM "budget_items"
      WHERE "parent_id" IS NULL
        AND "system_category" IS NULL
    `;

    beforeRoots = await preRepairClient.$queryRaw`
      SELECT
        "id", "workspace_id" AS "workspaceId", "system_category"::TEXT AS "category",
        "parent_id" AS "parentId", "source_order" AS "sourceOrder",
        "version", "updated_at" AS "updatedAt"
      FROM "budget_items"
      WHERE "id" LIKE ${`production_drift_root_%_${runId}`}
      ORDER BY "id"
    `;
    beforeAttachmentSnapshot =
      await snapshotProductionDriftAttachments(preRepairClient);
    beforeChildSnapshot = await snapshotProductionDriftChildren(preRepairClient);
    beforeOrdinarySnapshot =
      await snapshotProductionDriftOrdinaryRows(preRepairClient);

    const expectedPreRepairMigrations = new Set([
      fixedGroupsMigration,
      relatedTaxonomyMigration,
      sourceHierarchyMigration,
    ]);
    if (
      checkedInFixedChecksum === driftFixedChecksum ||
      storedFixedMigration?.checksum !== driftFixedChecksum ||
      storedFixedMigration?.checksum === checkedInFixedChecksum ||
      preRepairHistory.length !== 3 ||
      !preRepairHistory.every((row) =>
        expectedPreRepairMigrations.has(row.migration_name),
      ) ||
      preRepairShape?.systemCategoryColumns !== 1 ||
      preRepairShape?.hasSystemTaxonomy !== false ||
      preRepairShape?.validatedExpectedConstraints !== 6 ||
      preRepairShape?.experimentalIndexExact !== true ||
      preRepairRootSummary.length !== 2 ||
      preRepairRootSummary.some(
        (row) => row.rootCount !== 8 || row.categoryCount !== 8,
      ) ||
      preRepairOrdinaryRoots !== 0 ||
      beforeRoots.length !== 16 ||
      beforeRoots.some(
        (root) =>
          root.parentId !== null ||
          root.sourceOrder !== null ||
          root.version !== 0,
      ) ||
      beforeAttachmentSnapshot?.count !== 1 ||
      beforeChildSnapshot?.count !== 4 ||
      beforeOrdinarySnapshot?.count !== 20
    ) {
      throw new Error("production-like drift pre-repair verification failed");
    }
  } finally {
    await preRepairClient.$disconnect();
  }

  const repairStatus = run(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    environment,
  );
  if (repairStatus !== 0) {
    return repairStatus;
  }

  const repairedClient = new PrismaClient({
    datasources: { db: { url: productionDriftDatabaseUrl } },
  });
  try {
    const afterAttachmentSnapshot =
      await snapshotProductionDriftAttachments(repairedClient);
    const afterChildSnapshot = await snapshotProductionDriftChildren(repairedClient);
    const afterOrdinarySnapshot =
      await snapshotProductionDriftOrdinaryRows(repairedClient);
    const afterRoots = await repairedClient.$queryRaw`
      SELECT
        "root"."id", "root"."workspace_id" AS "workspaceId",
        "root"."parent_id" AS "parentId", "root"."source_order" AS "sourceOrder",
        "root"."version", "root"."updated_at" AS "updatedAt",
        "parent"."system_taxonomy_key" AS "parentTaxonomyKey"
      FROM "budget_items" AS "root"
      LEFT JOIN "budget_items" AS "parent" ON "parent"."id" = "root"."parent_id"
      WHERE "root"."id" LIKE ${`production_drift_root_%_${runId}`}
      ORDER BY "root"."id"
    `;
    const taxonomySummary = await repairedClient.$queryRaw`
      SELECT
        "workspace_id" AS "workspaceId",
        count(*)::INTEGER AS "nodeCount",
        count(*) FILTER (WHERE "parent_id" IS NULL)::INTEGER AS "stageCount",
        count(*) FILTER (WHERE "parent_id" IS NOT NULL)::INTEGER AS "itemCount",
        count(*) FILTER (
          WHERE "system_taxonomy_key" LIKE 'ITEM\\_%' ESCAPE '\\'
        )::INTEGER AS "publicItemCount"
      FROM "budget_items"
      WHERE "system_taxonomy_key" IS NOT NULL
      GROUP BY "workspace_id"
      ORDER BY "workspace_id"
    `;
    const taxonomyNodes = await repairedClient.$queryRaw`
      SELECT
        "node"."workspace_id" AS "workspaceId",
        "node"."system_taxonomy_key" AS "key",
        "node"."name" AS "name",
        "parent"."system_taxonomy_key" AS "parentKey"
      FROM "budget_items" AS "node"
      LEFT JOIN "budget_items" AS "parent" ON "parent"."id" = "node"."parent_id"
      WHERE "node"."system_taxonomy_key" IS NOT NULL
      ORDER BY "node"."workspace_id", "node"."system_taxonomy_key"
    `;
    const [postRepairShape] = await repairedClient.$queryRaw`
      SELECT
        EXISTS (
          SELECT 1 FROM "information_schema"."columns"
          WHERE "table_schema" = current_schema()
            AND "table_name" = 'budget_items'
            AND "column_name" = 'system_category'
        ) AS "hasSystemCategory",
        (
          SELECT count(*)::INTEGER
          FROM "information_schema"."columns"
          WHERE "table_schema" = current_schema()
            AND "table_name" = 'budget_items'
            AND "column_name" = 'system_taxonomy_key'
            AND "data_type" = 'character varying'
            AND "character_maximum_length" = 80
            AND "is_nullable" = 'YES'
            AND "column_default" IS NULL
        ) AS "systemTaxonomyColumns",
        (
          SELECT count(*)::INTEGER
          FROM "pg_constraint"
          WHERE "conrelid" = '"budget_items"'::regclass
            AND "conname" IN (
              'budget_items_source_identity_check',
              'budget_items_system_taxonomy_group_check',
              'budget_items_root_taxonomy_stage_check',
              'budget_items_system_taxonomy_hierarchy_check',
              'budget_items_system_taxonomy_name_check'
            )
            AND "convalidated"
        ) AS "validatedFinalConstraints",
        EXISTS (
          SELECT 1
          FROM "pg_class" AS "index_class"
          INNER JOIN "pg_index" AS "index_meta"
            ON "index_meta"."indexrelid" = "index_class"."oid"
          WHERE "index_class"."relname" =
              'budget_items_workspace_system_taxonomy_key'
            AND "index_meta"."indrelid" = '"budget_items"'::regclass
            AND "index_meta"."indisunique"
            AND "index_meta"."indisvalid"
            AND "index_meta"."indisready"
            AND "index_meta"."indpred" IS NULL
            AND "index_meta"."indexprs" IS NULL
            AND "index_meta"."indnkeyatts" = 2
            AND "index_meta"."indnatts" = 2
        ) AS "finalIndexExact",
        EXISTS (
          SELECT 1
          FROM "pg_constraint"
          WHERE "conrelid" = '"budget_items"'::regclass
            AND "conname" = 'budget_items_system_taxonomy_name_check'
            AND "convalidated"
            AND position('ITEM_PROPOSAL' IN pg_get_constraintdef("oid")) > 0
            AND position('求婚' IN pg_get_constraintdef("oid")) > 0
            AND position('提親' IN pg_get_constraintdef("oid")) = 0
        ) AS "proposalLabelConstraintExact"
    `;
    const [postRepairCounts] = await repairedClient.$queryRaw`
      SELECT
        count(*) FILTER (
          WHERE "system_taxonomy_key" IS NULL
        )::INTEGER AS "ordinaryRows",
        count(*) FILTER (
          WHERE "parent_id" IS NULL AND "system_taxonomy_key" IS NULL
        )::INTEGER AS "ordinaryRoots",
        count(*) FILTER (
          WHERE NOT (
            (
              "source" = 'MANUAL'
              AND "external_id" IS NULL
              AND "source_hash" IS NULL
              AND (
                ("system_taxonomy_key" IS NULL AND "source_order" IS NULL)
                OR
                ("system_taxonomy_key" IS NOT NULL AND "source_order" IS NOT NULL)
              )
            )
            OR (
              "source" = 'NOTION'
              AND "system_taxonomy_key" IS NULL
              AND "external_id" IS NOT NULL
              AND "source_hash" IS NOT NULL
              AND "source_order" IS NOT NULL
            )
          )
        )::INTEGER AS "sourceIdentityViolations"
      FROM "budget_items"
    `;
    const [repairedNotionChild] = await repairedClient.$queryRaw`
      SELECT
        "parent_id" AS "parentId", "version",
        "related_taxonomy_item_key" AS "relatedTaxonomyItemKey",
        "source_hierarchy_path" AS "sourceHierarchyPath"
      FROM "budget_items"
      WHERE "id" = ${fixture.notionChildId(0)}
    `;
    const repairedHistory = await repairedClient.$queryRaw`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${repairMigration}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;
    const proposalLabelHistory = await repairedClient.$queryRaw`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${proposalLabelMigration}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;
    const engagementSuggestionHistory = await repairedClient.$queryRaw`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${engagementSuggestionMigration}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;

    const preparationSuggestionHistory = await repairedClient.$queryRaw`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${preparationSuggestionMigration}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;

    const rootParentByCategory = new Map([
      ["RINGS_KEEPSAKES", "ITEM_PROPOSAL"],
      ["PHOTOGRAPHY_VIDEO", "ITEM_WEDDING_PHOTOGRAPHY"],
      ["ATTIRE_STYLING", "ITEM_ATTIRE_RENTAL"],
      ["VENUE_CATERING", "ITEM_WEDDING_VENUE"],
      ["TRANSPORT_LODGING", "INTERNAL_UNCLASSIFIED_ITEM"],
      ["DECOR_GIFTS", "ITEM_WEDDING_DECOR"],
      ["PEOPLE_SERVICES", "ITEM_WEDDING_HOST"],
      ["OTHER_PENDING", "INTERNAL_UNCLASSIFIED_ITEM"],
    ]);
    const beforeRootById = new Map(beforeRoots.map((root) => [root.id, root]));
    const taxonomyKeysByWorkspace = new Map();
    for (const node of taxonomyNodes) {
      const keys = taxonomyKeysByWorkspace.get(node.workspaceId) ?? new Set();
      keys.add(node.key);
      taxonomyKeysByWorkspace.set(node.workspaceId, keys);
    }
    const taxonomyTopologyIsExact =
      fixedTaxonomyExpectedParents.size === 28 &&
      taxonomyNodes.length === 56 &&
      taxonomyKeysByWorkspace.size === 2 &&
      [...taxonomyKeysByWorkspace.values()].every((keys) => keys.size === 28) &&
      taxonomyNodes.every(
        (node) =>
          fixedTaxonomyExpectedParents.has(node.key) &&
          node.parentKey === fixedTaxonomyExpectedParents.get(node.key) &&
          (node.key !== "ITEM_PROPOSAL" || node.name === "求婚"),
      );
    const rootsAreRepaired =
      afterRoots.length === 16 &&
      afterRoots.every((root) => {
        const before = beforeRootById.get(root.id);
        return (
          before &&
          root.parentId !== null &&
          root.parentTaxonomyKey === rootParentByCategory.get(before.category) &&
          root.sourceOrder === null &&
          root.version === before.version + 1 &&
          root.updatedAt.getTime() > before.updatedAt.getTime()
        );
      });

    if (
      afterAttachmentSnapshot?.count !== beforeAttachmentSnapshot?.count ||
      afterAttachmentSnapshot?.digest !== beforeAttachmentSnapshot?.digest ||
      afterChildSnapshot?.count !== beforeChildSnapshot?.count ||
      afterChildSnapshot?.digest !== beforeChildSnapshot?.digest ||
      afterOrdinarySnapshot?.count !== beforeOrdinarySnapshot?.count ||
      afterOrdinarySnapshot?.digest !== beforeOrdinarySnapshot?.digest ||
      !rootsAreRepaired ||
      !taxonomyTopologyIsExact ||
      taxonomySummary.length !== 2 ||
      taxonomySummary.some(
        (row) =>
          row.nodeCount !== 28 ||
          row.stageCount !== 7 ||
          row.itemCount !== 21 ||
          row.publicItemCount !== 20,
      ) ||
      postRepairShape?.hasSystemCategory !== false ||
      postRepairShape?.systemTaxonomyColumns !== 1 ||
      postRepairShape?.validatedFinalConstraints !== 5 ||
      postRepairShape?.finalIndexExact !== true ||
      postRepairShape?.proposalLabelConstraintExact !== true ||
      postRepairCounts?.ordinaryRows !== 20 ||
      postRepairCounts?.ordinaryRoots !== 0 ||
      postRepairCounts?.sourceIdentityViolations !== 0 ||
      repairedNotionChild?.parentId !== fixture.rootId(0, "ATTIRE_STYLING") ||
      repairedNotionChild?.version !== 0 ||
      repairedNotionChild?.relatedTaxonomyItemKey !==
        "ITEM_PRE_WEDDING_PHOTOGRAPHY" ||
      repairedNotionChild?.sourceHierarchyPath?.join("/") !==
        "拍攝婚紗/服裝與造型/小白鞋" ||
      repairedHistory.length !== 1 ||
      proposalLabelHistory.length !== 1 ||
      engagementSuggestionHistory.length !== 1 ||
      preparationSuggestionHistory.length !== 1
    ) {
      throw new Error("production-like drift repair verification failed");
    }
    currentHeadBudgetSnapshot = await snapshotAllBudgetRows(repairedClient);
    currentHeadAttachmentSnapshot = afterAttachmentSnapshot;
  } finally {
    await repairedClient.$disconnect();
  }

  const currentHeadNoOpStatus = run(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    environment,
  );
  if (currentHeadNoOpStatus !== 0) {
    return currentHeadNoOpStatus;
  }

  const currentHeadClient = new PrismaClient({
    datasources: { db: { url: productionDriftDatabaseUrl } },
  });
  try {
    const afterNoOpBudgetSnapshot =
      await snapshotAllBudgetRows(currentHeadClient);
    const afterNoOpAttachmentSnapshot =
      await snapshotProductionDriftAttachments(currentHeadClient);
    const [proposalLabelSummary] = await currentHeadClient.$queryRaw`
      SELECT
        count(*)::INTEGER AS "proposalNodes",
        count(DISTINCT "workspace_id")::INTEGER AS "workspaces",
        count(*) FILTER (WHERE "name" = '求婚')::INTEGER AS "finalLabels",
        count(*) FILTER (WHERE "name" = '提親')::INTEGER AS "oldLabels"
      FROM "budget_items"
      WHERE "system_taxonomy_key" = 'ITEM_PROPOSAL'
    `;
    const appliedProposalLabels = await currentHeadClient.$queryRaw`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${proposalLabelMigration}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;
    const appliedEngagementSuggestions = await currentHeadClient.$queryRaw`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${engagementSuggestionMigration}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;
    const appliedPreparationSuggestions = await currentHeadClient.$queryRaw`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${preparationSuggestionMigration}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;
    if (
      afterNoOpBudgetSnapshot?.count !== currentHeadBudgetSnapshot?.count ||
      afterNoOpBudgetSnapshot?.digest !== currentHeadBudgetSnapshot?.digest ||
      afterNoOpAttachmentSnapshot?.count !==
        currentHeadAttachmentSnapshot?.count ||
      afterNoOpAttachmentSnapshot?.digest !==
        currentHeadAttachmentSnapshot?.digest ||
      proposalLabelSummary?.proposalNodes !== 2 ||
      proposalLabelSummary?.workspaces !== 2 ||
      proposalLabelSummary?.finalLabels !== 2 ||
      proposalLabelSummary?.oldLabels !== 0 ||
      appliedProposalLabels.length !== 1 ||
      appliedEngagementSuggestions.length !== 1 ||
      appliedPreparationSuggestions.length !== 1
    ) {
      throw new Error("current-head migration no-op verification failed");
    }
  } finally {
    await currentHeadClient.$disconnect();
  }

  console.log(
    `Production-like drift repair passed: a modified-checksum ${fixedGroupsMigration} history row plus the exact experimental eight-root shape was repaired by ${repairMigration}, then ${proposalLabelMigration} changed only ITEM_PROPOSAL from 提親 to 求婚 and ${engagementSuggestionMigration} added the nullable workspace-scoped engagement suggestion identity and ${preparationSuggestionMigration} expanded the validated identity constraint to PREPARATION keys; all 20 ordinary rows, nested hierarchy and versions, Notion purpose/path metadata, and attachment bytes were preserved while 16 legacy roots were attached beneath the canonical 28-node-per-workspace Drive taxonomy with 20 public item groups. A second current-head migrate deploy was an exact Budget and attachment data no-op.`,
  );
  return 0;
}

async function dropSchema(schemaName, databaseUrl) {
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

let status = 1;
try {
  status = runFreshChain();
  if (status === 0) {
    status = await runPriorHeadUpgrade();
  }
  if (status === 0) {
    status = await runProductionDriftRepair();
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "PostgreSQL integration runner failed.",
  );
  status = 1;
} finally {
  try {
    await dropSchema(freshSchemaName, freshDatabaseUrl);
  } finally {
    try {
      await dropSchema(upgradeSchemaName, upgradeDatabaseUrl);
    } finally {
      try {
        await dropSchema(
          productionDriftSchemaName,
          productionDriftDatabaseUrl,
        );
      } finally {
        rmSync(priorHeadDirectory, { recursive: true, force: true });
        rmSync(productionDriftDirectory, { recursive: true, force: true });
      }
    }
  }
}

process.exit(status);
