import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ userId: "" }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({ id: authState.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  addBudgetEngagementSuggestionsAction,
  addBudgetPreparationSuggestionsAction,
  changeBudgetItemBookingStatusAction,
  createBudgetGroupAction,
  createBudgetItemAction,
  deleteBudgetGroupSubtreeAction,
  deleteBudgetItemAction,
  dissolveBudgetGroupAction,
  moveBudgetItemAction,
  resetBudgetDataAction,
  updateBudgetGroupAction,
  updateBudgetItemAction,
} from "@/actions/budget-items";
import {
  BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
  BUDGET_SYSTEM_NODES,
  type BudgetTaxonomyItemKey,
  type BudgetSystemNodeKey,
} from "@/domain/budget-item";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { getBudgetPageData } from "@/lib/budget-list";
import {
  importNotionBudgetRecords,
  parseNormalizedNotionBudgetJson,
} from "../../scripts/notion-budget-import.mjs";
import {
  computeBudgetHierarchyProjection,
  parseBudgetHierarchyPlanJson,
  reorganizeBudgetHierarchy,
} from "../../scripts/budget-hierarchy-operator.mjs";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const idleState = { status: "idle" as const };
let sequence = 0;

function detailsForm({
  name = "婚宴場地",
  category = "VENUE_CATERING",
  taxonomyItemKey = "ITEM_WEDDING_VENUE",
  relatedTaxonomyItemKey,
  plannedAmount = "120000",
  actualAmount = "118000",
  depositAmount,
  balanceAmount,
  additionalAmount,
  bookingStatus,
  dueDate = "2028-02-29",
  notes = "真 PostgreSQL integration",
  expectedVersion,
}: {
  name?: string;
  category?: string;
  taxonomyItemKey?: BudgetTaxonomyItemKey;
  relatedTaxonomyItemKey?: BudgetTaxonomyItemKey;
  plannedAmount?: string;
  actualAmount?: string;
  depositAmount?: string;
  balanceAmount?: string;
  additionalAmount?: string;
  bookingStatus?: string;
  dueDate?: string;
  notes?: string;
  expectedVersion?: number;
} = {}): FormData {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("category", category);
  formData.set("taxonomyItemKey", taxonomyItemKey);
  if (relatedTaxonomyItemKey !== undefined) {
    formData.set("relatedTaxonomyItemKey", relatedTaxonomyItemKey);
  }
  formData.set("plannedAmount", plannedAmount);
  formData.set("actualAmount", actualAmount);
  if (depositAmount !== undefined) {
    formData.set("depositAmount", depositAmount);
  }
  if (balanceAmount !== undefined) {
    formData.set("balanceAmount", balanceAmount);
  }
  if (additionalAmount !== undefined) {
    formData.set("additionalAmount", additionalAmount);
  }
  if (bookingStatus !== undefined) {
    formData.set("bookingStatus", bookingStatus);
  }
  formData.set("dueDate", dueDate);
  formData.set("notes", notes);
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

function engagementSuggestionForm(...keys: string[]): FormData {
  const formData = new FormData();
  keys.forEach((key) => formData.append("suggestionKey", key));
  return formData;
}

function directChildSetHash(ids: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(ids.toSorted()))
    .digest("hex");
}

function dissolveForm(expectedVersion: number, directChildIds: string[]): FormData {
  const formData = versionForm(expectedVersion);
  formData.set(
    "expectedDirectChildSetHash",
    directChildSetHash(directChildIds),
  );
  return formData;
}

function subtreeDeleteForm(
  expectedVersion: number,
  expectedSubtreeSnapshotToken: string,
  confirmationName: string,
): FormData {
  const formData = versionForm(expectedVersion);
  formData.set("expectedSubtreeSnapshotToken", expectedSubtreeSnapshotToken);
  formData.set("confirmationName", confirmationName);
  return formData;
}

function groupForm(
  name: string,
  expectedVersion?: number,
  taxonomyItemKey: BudgetTaxonomyItemKey = "ITEM_WEDDING_VENUE",
): FormData {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("taxonomyItemKey", taxonomyItemKey);
  if (expectedVersion !== undefined) {
    formData.set("expectedVersion", String(expectedVersion));
  }
  return formData;
}

function moveForm(expectedVersion: number, targetParentId: string | null): FormData {
  const formData = versionForm(expectedVersion);
  formData.set("targetParentId", targetParentId ?? "");
  return formData;
}

const LOCK_WAIT_ATTEMPTS = 100;
const LOCK_WAIT_POLL_MS = 10;

type ExpectedLockWait = "advisory" | "row";
type BlockingWaiter = {
  waiterPid: number;
  blockingPids: number[];
  waitEvent: string | null;
};

async function waitForBlockingChain(
  blockerPid: number,
  expectedLockWait: ExpectedLockWait,
): Promise<number> {
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const rows = await prisma.$queryRaw<BlockingWaiter[]>`
      SELECT
        "activity"."pid"::int AS "waiterPid",
        pg_blocking_pids("activity"."pid")::int[] AS "blockingPids",
        "activity"."wait_event" AS "waitEvent"
      FROM "pg_stat_activity" AS "activity"
      WHERE "activity"."datname" = current_database()
        AND "activity"."pid" <> pg_backend_pid()
        AND "activity"."wait_event_type" = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids("activity"."pid"))
      ORDER BY "activity"."pid"
    `;
    const matchingRows = rows.filter((row) =>
      expectedLockWait === "advisory"
        ? row.waitEvent?.toLowerCase() === "advisory"
        : row.waitEvent?.toLowerCase() !== "advisory",
    );
    if (matchingRows.length > 1) {
      throw new Error(
        `Expected exactly one ${expectedLockWait} waiter blocked by PID ${blockerPid}, found ${matchingRows.length}.`,
      );
    }
    const matchingRow = matchingRows[0];
    if (matchingRow) {
      const distinctBlockingPids = [...new Set(matchingRow.blockingPids)];
      if (
        distinctBlockingPids.length !== 1 ||
        distinctBlockingPids[0] !== blockerPid
      ) {
        throw new Error(
          `Waiter PID ${matchingRow.waiterPid} had an ambiguous blocking chain.`,
        );
      }
      return matchingRow.waiterPid;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
  }
  throw new Error(
    `Timed out waiting for PID ${blockerPid} to block one ${expectedLockWait} waiter.`,
  );
}

async function failClosedWithin<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(message)),
          LOCK_WAIT_ATTEMPTS * LOCK_WAIT_POLL_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type RowLockBarrier = {
  pid: number;
  release: () => void;
  completion: Promise<void>;
};

async function holdBudgetItemRowLock(itemId: string): Promise<RowLockBarrier> {
  let reportReady!: (pid: number) => void;
  let reportFailure!: (error: unknown) => void;
  const ready = new Promise<number>((resolve, reject) => {
    reportReady = resolve;
    reportFailure = reject;
  });
  let releaseBarrier!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseBarrier();
  };
  const completion = prisma.$transaction(async (transaction) => {
    const lockedRows = await transaction.$queryRaw<Array<{ pid: number }>>(
      Prisma.sql`
        SELECT pg_backend_pid()::int AS "pid"
        FROM "budget_items"
        WHERE "id" = ${itemId}
        FOR UPDATE
      `,
    );
    if (lockedRows.length !== 1) {
      throw new Error("The row-lock barrier target did not exist.");
    }
    reportReady(lockedRows[0].pid);
    await held;
  });
  void completion.catch(reportFailure);

  try {
    const pid = await failClosedWithin(
      ready,
      `Timed out acquiring the row-lock barrier for budget item ${itemId}.`,
    );
    return { pid, release, completion };
  } catch (error) {
    release();
    await Promise.allSettled([completion]);
    throw error;
  }
}

async function databaseDeadlockCount(): Promise<string> {
  const [stats] = await prisma.$queryRaw<Array<{ deadlocks: string }>>`
    SELECT "deadlocks"::text AS "deadlocks"
    FROM "pg_stat_database"
    WHERE "datname" = current_database()
  `;
  if (!stats) throw new Error("Current database statistics were unavailable.");
  return stats.deadlocks;
}

function bookingStatusForm(
  bookingStatus: "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID",
  expectedVersion: number,
): FormData {
  const formData = versionForm(expectedVersion);
  formData.set("bookingStatus", bookingStatus);
  return formData;
}

type SyntheticNotionBudgetRow = {
  source: "NOTION";
  externalId: string;
  parentExternalId: string | null;
  sourceOrder: number;
  name: string;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  totalAmount: number;
  rollupAmount: number;
  estimatedRange: string | null;
  candidateVendors: string | null;
  confirmedVendor: string | null;
  vendorContact: string | null;
  primaryContact: "PARTNER_A" | "PARTNER_B" | null;
  bookingStatus: "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID";
  notes: string | null;
};

function syntheticNotionUuid(index: number): string {
  return `b0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function syntheticNotionBudgetRecords() {
  const parentIndexes: Array<number | null> = [
    null,
    null,
    null,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    3,
    4,
    4,
    4,
    5,
    5,
    5,
    6,
    6,
    6,
    7,
    7,
    8,
    9,
    9,
    9,
    9,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    2,
    2,
  ];
  const rows: SyntheticNotionBudgetRow[] = parentIndexes.map(
    (parentIndex, index) => {
      const directAmount = index === 36 ? 754_185 : 1_000 + index * 100;
      const bookingStatus =
        index < 18
          ? "PAID"
          : index < 25
            ? "BOOKED_BALANCE_DUE"
            : "PLANNING";
      return {
        source: "NOTION",
        externalId: syntheticNotionUuid(index),
        parentExternalId:
          parentIndex === null ? null : syntheticNotionUuid(parentIndex),
        sourceOrder: index,
        name: `PostgreSQL 合成預算節點 ${index + 1}`,
        depositAmount: directAmount,
        balanceAmount: null,
        additionalAmount: null,
        totalAmount: directAmount,
        rollupAmount: 0,
        estimatedRange: null,
        candidateVendors: null,
        confirmedVendor: null,
        vendorContact: null,
        primaryContact: index % 3 === 0 ? "PARTNER_A" : null,
        bookingStatus,
        notes: null,
      };
    },
  );
  const children = new Map<string, SyntheticNotionBudgetRow[]>();
  for (const row of rows) {
    if (row.parentExternalId) {
      const siblings = children.get(row.parentExternalId) ?? [];
      siblings.push(row);
      children.set(row.parentExternalId, siblings);
    }
  }
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    row.rollupAmount = (children.get(row.externalId) ?? []).reduce(
      (sum, childRow) => sum + childRow.totalAmount,
      0,
    );
    row.totalAmount =
      (row.depositAmount ?? 0) +
      (row.balanceAmount ?? 0) +
      (row.additionalAmount ?? 0) +
      row.rollupAmount;
  }
  return parseNormalizedNotionBudgetJson(JSON.stringify(rows));
}

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      googleSubject: `budget-it-${label}-${sequence}`,
      email: `budget-it-${label}-${sequence}@example.test`,
    },
  });
}

async function internalTaxonomyItemId(workspaceId: string): Promise<string> {
  const internal = await prisma.budgetItem.findUnique({
    where: {
      workspaceId_systemTaxonomyKey: {
        workspaceId,
        systemTaxonomyKey: BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
      },
    },
    select: { id: true },
  });
  if (!internal) {
    throw new Error(
      `Workspace ${workspaceId} is missing the internal taxonomy item.`,
    );
  }
  return internal.id;
}

async function createBudgetItem(args: Prisma.BudgetItemCreateArgs) {
  const data = args.data as Prisma.BudgetItemUncheckedCreateInput;
  const hasExplicitParent = Object.prototype.hasOwnProperty.call(
    data,
    "parentId",
  );
  const hasFixedTaxonomyKey = data.systemTaxonomyKey != null;
  if (hasExplicitParent || hasFixedTaxonomyKey) {
    return prisma.budgetItem.create(args);
  }

  return prisma.budgetItem.create({
    ...args,
    data: {
      ...data,
      parentId: await internalTaxonomyItemId(data.workspaceId),
    },
  });
}

function taxonomyPlanReference(key: BudgetSystemNodeKey): string {
  return `taxonomy:${key}`;
}

function taxonomyPlanPath(key: BudgetSystemNodeKey): string[] {
  const node = BUDGET_SYSTEM_NODES.find((candidate) => candidate.key === key);
  if (!node) throw new Error(`Unknown budget taxonomy node ${key}.`);
  return node.parentKey === null
    ? [node.label]
    : [...taxonomyPlanPath(node.parentKey), node.label];
}

function fixedTaxonomyPlanItems() {
  return BUDGET_SYSTEM_NODES.map((node) => ({
    ref: taxonomyPlanReference(node.key),
    beforePath: taxonomyPlanPath(node.key),
    finalPath: taxonomyPlanPath(node.key),
    finalKind: "GROUP",
    finalCategory: null,
    finalName: node.label,
    parentRef:
      node.parentKey === null ? null : taxonomyPlanReference(node.parentKey),
  }));
}

async function createWorkspaceForUser(userId: string, label: string) {
  const taxonomyNodeIds = Object.fromEntries(
    BUDGET_SYSTEM_NODES.map((node) => [node.key, randomUUID()]),
  ) as Record<BudgetSystemNodeKey, string>;

  return prisma.weddingWorkspace.create({
    data: {
      name: label,
      createdById: userId,
      memberships: { create: { userId, role: "OWNER" } },
      budgetItems: {
        create: BUDGET_SYSTEM_NODES.map((node) => ({
          id: taxonomyNodeIds[node.key],
          parentId:
            node.parentKey === null
              ? null
              : taxonomyNodeIds[node.parentKey],
          source: "MANUAL" as const,
          sourceOrder: node.sourceOrder,
          name: node.label,
          kind: "GROUP" as const,
          category: null,
          systemTaxonomyKey: node.key,
          legacyCategory: null,
          plannedAmount: 0,
        })),
      },
    },
  });
}

async function createOwnerWorkspace(label = "預算 integration") {
  const user = await createUser("owner");
  const workspace = await createWorkspaceForUser(user.id, label);
  authState.userId = user.id;
  return { user, workspace };
}

describeDatabase.sequential("PostgreSQL BudgetItem invariants", () => {
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

  it("applies DATE, every CHECK, index, and workspace cascade", async () => {
    const { workspace } = await createOwnerWorkspace();
    const dueDateColumn = await prisma.$queryRaw<
      Array<{ data_type: string; udt_name: string }>
    >`SELECT data_type, udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'budget_items' AND column_name = 'due_date'`;
    expect(dueDateColumn).toEqual([{ data_type: "date", udt_name: "date" }]);

    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'budget_items'::regclass
      ORDER BY conname
    `;
    expect(constraints.map((constraint) => constraint.conname)).toEqual(
      expect.arrayContaining([
        "budget_items_actual_amount_check",
        "budget_items_booking_status_paid_check",
        "budget_items_candidate_vendors_check",
        "budget_items_components_check",
        "budget_items_confirmed_vendor_check",
        "budget_items_estimated_range_check",
        "budget_items_external_id_check",
        "budget_items_name_check",
        "budget_items_notes_check",
        "budget_items_kind_category_check",
        "budget_items_group_neutral_fields_check",
        "budget_items_related_taxonomy_item_key_check",
        "budget_items_parent_id_workspace_id_fkey",
        "budget_items_parent_not_self_check",
        "budget_items_paid_at_check",
        "budget_items_planned_amount_check",
        "budget_items_source_hash_check",
        "budget_items_source_identity_check",
        "budget_items_source_order_check",
        "budget_items_root_taxonomy_stage_check",
        "budget_items_source_hierarchy_path_check",
        "budget_items_suggestion_key_shape_check",
        "budget_items_system_taxonomy_group_check",
        "budget_items_system_taxonomy_hierarchy_check",
        "budget_items_system_taxonomy_name_check",
        "budget_items_vendor_contact_check",
        "budget_items_version_check",
        "budget_items_workspace_id_fkey",
      ]),
    );
    expect(
      await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'budget_items_ws_paid_due_category_created_id_idx'
        ) AS exists
      `,
    ).toEqual([{ exists: true }]);
    expect(
      await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'budget_items_workspace_suggestion_key_key'
        ) AS exists
      `,
    ).toEqual([{ exists: true }]);
    expect(
      await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'budget_items_ws_kind_category_created_id_idx'
        ) AS exists
      `,
    ).toEqual([{ exists: true }]);

    await expect(
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "合法項目",
          category: "VENUE_CATERING",
          plannedAmount: 0,
          actualAmount: 2_147_483_647,
          dueDate: new Date("2028-02-29T00:00:00.000Z"),
        },
      }),
    ).resolves.toMatchObject({ plannedAmount: 0, actualAmount: 2_147_483_647 });

    await expect(
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "合法拍攝禮服延伸",
          category: "ATTIRE_STYLING",
          relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
          plannedAmount: 12_000,
        },
      }),
    ).resolves.toMatchObject({
      relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
    });

    await expect(
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "合法群組",
          kind: "GROUP",
          category: null,
          plannedAmount: 0,
        },
      }),
    ).resolves.toMatchObject({ kind: "GROUP", category: null });

    for (const data of [
      {
        name: "群組不可有分類",
        kind: "GROUP" as const,
        category: "OTHER_PENDING" as const,
        plannedAmount: 0,
      },
      {
        name: "群組不可有直接費用",
        kind: "GROUP" as const,
        category: null,
        plannedAmount: 1,
      },
      {
        name: "群組不可隱藏花費備註",
        kind: "GROUP" as const,
        category: null,
        plannedAmount: 0,
        notes: "這是花費項目資訊",
      },
      {
        name: "群組不可有用途關聯",
        kind: "GROUP" as const,
        category: null,
        relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        plannedAmount: 0,
      },
      {
        name: "花費必須有分類",
        kind: "EXPENSE" as const,
        category: null,
        plannedAmount: 0,
      },
    ]) {
      await expect(
        createBudgetItem({
          data: { workspaceId: workspace.id, ...data },
        }),
      ).rejects.toBeDefined();
    }

    const invalidRows: Array<
      Omit<Prisma.BudgetItemUncheckedCreateInput, "workspaceId">
    > = [
      {
        name: "用途不可為籌備階段",
        category: "ATTIRE_STYLING",
        relatedTaxonomyItemKey: "STAGE_PREPARATION_1_2_MONTHS",
        plannedAmount: 1,
      },
      {
        name: "用途不可為內部保留品項",
        category: "ATTIRE_STYLING",
        relatedTaxonomyItemKey: "INTERNAL_UNCLASSIFIED_ITEM",
        plannedAmount: 1,
      },
      {
        name: "用途不可為未知品項",
        category: "ATTIRE_STYLING",
        relatedTaxonomyItemKey: "ITEM_UNKNOWN",
        plannedAmount: 1,
      },
      { name: " 前後空白 ", category: "VENUE_CATERING", plannedAmount: 1 },
      { name: "\t", category: "VENUE_CATERING", plannedAmount: 1 },
      {
        name: "項".repeat(121),
        category: "VENUE_CATERING",
        plannedAmount: 1,
      },
      { name: "項目", category: "VENUE_CATERING", plannedAmount: -1 },
      {
        name: "項目",
        category: "VENUE_CATERING",
        plannedAmount: 1,
        actualAmount: -1,
      },
      {
        name: "項目",
        category: "VENUE_CATERING",
        plannedAmount: 1,
        notes: "備".repeat(1001),
      },
      {
        name: "項目",
        category: "VENUE_CATERING",
        plannedAmount: 1,
        version: -1,
      },
      {
        name: "項目",
        category: "VENUE_CATERING",
        plannedAmount: 1,
        paid: true,
      },
      {
        name: "項目",
        category: "VENUE_CATERING",
        plannedAmount: 1,
        paid: false,
        paidAt: new Date(),
      },
    ];
    for (const data of invalidRows) {
      await expect(
        createBudgetItem({ data: { workspaceId: workspace.id, ...data } }),
      ).rejects.toBeDefined();
    }

    await prisma.weddingWorkspace.delete({ where: { id: workspace.id } });
    expect(await prisma.budgetItem.count()).toBe(0);
  });

  it("enforces source identity, same-workspace hierarchy, all v7 checks, NO ACTION, and cascade", async () => {
    const owner = await createOwnerWorkspace("階層工作區");
    const secondWorkspace = await createWorkspaceForUser(
      owner.user.id,
      "另一階層工作區",
    );
    const root = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        source: "NOTION",
        externalId: "a0000000-0000-4000-8000-000000000001",
        sourceHash: "a".repeat(64),
        sourceOrder: 0,
        sourceHierarchyPath: ["婚紗拍攝", "其他", "合成姓名的小白鞋"],
        name: "合成姓名的小白鞋",
        category: "OTHER_PENDING",
        plannedAmount: 100,
        depositAmount: 100,
      },
    });
    const child = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: root.id,
        source: "NOTION",
        externalId: "a0000000-0000-4000-8000-000000000002",
        sourceHash: "b".repeat(64),
        sourceOrder: 1,
        name: "合成子項目",
        category: "OTHER_PENDING",
        plannedAmount: 50,
        balanceAmount: 50,
      },
    });
    const importedPaid = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        source: "NOTION",
        externalId: "a0000000-0000-4000-8000-000000000003",
        sourceHash: "c".repeat(64),
        sourceOrder: 2,
        name: "合成已付清項目",
        category: "OTHER_PENDING",
        plannedAmount: 75,
        actualAmount: 75,
        bookingStatus: "PAID",
        paid: true,
        paidAt: null,
      },
    });

    await expect(
      deleteBudgetItemAction(
        owner.workspace.id,
        root.id,
        idleState,
        versionForm(root.version),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "此花費項目包含子項，請先處理子項後再移除。",
    });
    await expect(
      prisma.budgetItem.update({
        where: { id: root.id },
        data: { parentId: root.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      createBudgetItem({
        data: {
          workspaceId: secondWorkspace.id,
          parentId: root.id,
          source: "NOTION",
          externalId: "a0000000-0000-4000-8000-000000000004",
          sourceHash: "d".repeat(64),
          sourceOrder: 0,
          name: "跨工作區子項",
          category: "OTHER_PENDING",
          plannedAmount: 1,
        },
      }),
    ).rejects.toBeDefined();

    const invalidV7Rows = [
      {
        source: "MANUAL" as const,
        externalId: "a0000000-0000-4000-8000-000000000005",
      },
      {
        source: "NOTION" as const,
        externalId: "A0000000-0000-4000-8000-000000000005",
        sourceHash: "e".repeat(64),
        sourceOrder: 3,
      },
      {
        source: "NOTION" as const,
        externalId: "a0000000-0000-4000-8000-000000000006",
        sourceHash: "E".repeat(64),
        sourceOrder: 3,
      },
      {
        source: "NOTION" as const,
        externalId: "a0000000-0000-4000-8000-000000000007",
        sourceHash: "f".repeat(64),
        sourceOrder: -1,
      },
      { depositAmount: -1 },
      { estimatedRange: " 前後空白 " },
      { candidateVendors: "候".repeat(1001) },
      { confirmedVendor: "廠".repeat(301) },
      { vendorContact: "聯".repeat(501) },
      { bookingStatus: "PAID" as const, paid: false },
      { bookingStatus: "PLANNING" as const, paidAt: new Date() },
      {
        source: "MANUAL" as const,
        sourceHierarchyPath: ["婚紗拍攝"],
      },
      {
        source: "NOTION" as const,
        externalId: "a0000000-0000-4000-8000-000000000008",
        sourceHash: "0".repeat(64),
        sourceOrder: 4,
        sourceHierarchyPath: ["一", "二", "三", "四", "五"],
      },
      {
        source: "NOTION" as const,
        externalId: "a0000000-0000-4000-8000-000000000009",
        sourceHash: "1".repeat(64),
        sourceOrder: 5,
        sourceHierarchyPath: ["婚紗拍攝", "", "合成姓名的小白鞋"],
      },
    ];
    for (const [index, data] of invalidV7Rows.entries()) {
      await expect(
        createBudgetItem({
          data: {
            workspaceId: owner.workspace.id,
            name: `v7 無效項目 ${index}`,
            category: "OTHER_PENDING",
            plannedAmount: 1,
            ...data,
          },
        }),
      ).rejects.toBeDefined();
    }

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'budget_items'
    `;
    expect(indexes.map((index) => index.indexname)).toEqual(
      expect.arrayContaining([
        "budget_items_workspace_source_external_id_key",
        "budget_items_ws_source_idx",
        "budget_items_ws_parent_source_order_tree_idx",
        "budget_items_ws_paid_due_category_created_id_idx",
      ]),
    );
    expect(root.sourceHierarchyPath).toEqual([
      "婚紗拍攝",
      "其他",
      "合成姓名的小白鞋",
    ]);

    await expect(
      changeBudgetItemBookingStatusAction(
        owner.workspace.id,
        importedPaid.id,
        idleState,
        bookingStatusForm("PAID", importedPaid.version),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({
        where: { id: importedPaid.id },
      }),
    ).toMatchObject({ paid: true, paidAt: null, version: 1 });

    await prisma.weddingWorkspace.delete({ where: { id: owner.workspace.id } });
    expect(
      await prisma.budgetItem.count({
        where: { id: { in: [root.id, child.id, importedPaid.id] } },
      }),
    ).toBe(0);
  });

  it("makes parallel one-shot imports converge to one create and one unchanged projection", async () => {
    const { workspace } = await createOwnerWorkspace("平行匯入工作區");
    const records = syntheticNotionBudgetRecords();

    const results = await Promise.all([
      importNotionBudgetRecords({
        client: prisma,
        workspaceId: workspace.id,
        records,
        apply: true,
      }),
      importNotionBudgetRecords({
        client: prisma,
        workspaceId: workspace.id,
        records,
        apply: true,
      }),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ create: 37, unchanged: 0, conflict: 0 }),
        expect.objectContaining({ create: 0, unchanged: 37, conflict: 0 }),
      ]),
    );
    expect(
      await prisma.budgetItem.count({
        where: { workspaceId: workspace.id, source: "NOTION" },
      }),
    ).toBe(37);
    await expect(
      importNotionBudgetRecords({
        client: prisma,
        workspaceId: workspace.id,
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({
      create: 0,
      unchanged: 37,
      conflict: 0,
    });

    const edited = await prisma.budgetItem.findFirstOrThrow({
      where: { workspaceId: workspace.id, source: "NOTION" },
      orderBy: { sourceOrder: "asc" },
    });
    await prisma.budgetItem.update({
      where: { id: edited.id },
      data: { notes: "VowBook 合成手動修改" },
    });
    await expect(
      importNotionBudgetRecords({
        client: prisma,
        workspaceId: workspace.id,
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({
      applied: false,
      create: 0,
      unchanged: 0,
      conflict: 1,
    });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: edited.id } }),
    ).toMatchObject({ notes: "VowBook 合成手動修改" });
  });

  it("atomically clears ordinary hierarchy and attachments while preserving Drive taxonomy for a clean reimport", async () => {
    const { user, workspace } = await createOwnerWorkspace("重建整合工作區");
    const records = syntheticNotionBudgetRecords();
    await expect(
      importNotionBudgetRecords({
        client: prisma,
        workspaceId: workspace.id,
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 37, conflict: 0, applied: true });

    const venueItem = await prisma.budgetItem.findUniqueOrThrow({
      where: {
        workspaceId_systemTaxonomyKey: {
          workspaceId: workspace.id,
          systemTaxonomyKey: "ITEM_WEDDING_VENUE",
        },
      },
      select: { id: true },
    });
    const manualGroup = await prisma.budgetItem.create({
      data: {
        workspaceId: workspace.id,
        parentId: venueItem.id,
        source: "MANUAL",
        name: "重建前手動群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const manualExpense = await prisma.budgetItem.create({
      data: {
        workspaceId: workspace.id,
        parentId: manualGroup.id,
        source: "MANUAL",
        name: "重建前手動花費",
        kind: "EXPENSE",
        category: "VENUE_CATERING",
        plannedAmount: 500,
      },
    });
    const resetAttachmentBytes = Buffer.from("%PDF-1.7\n", "utf8");
    await prisma.budgetAttachment.create({
      data: {
        workspaceId: workspace.id,
        budgetItemId: manualExpense.id,
        originalName: "reset-contract.pdf",
        mediaType: "application/pdf",
        byteSize: resetAttachmentBytes.length,
        sha256: createHash("sha256")
          .update(resetAttachmentBytes)
          .digest("hex"),
        data: resetAttachmentBytes,
        uploadedByUserId: user.id,
      },
    });

    const beforeReset = await getBudgetPageData(workspace.id);
    expect(beforeReset).toMatchObject({
      canResetBudget: true,
      resetSnapshot: {
        itemCount: 39,
        notionItemCount: 37,
        manualItemCount: 2,
        attachmentCount: 1,
      },
    });
    if (beforeReset.resetSnapshot === null) {
      throw new Error("OWNER reset snapshot was unavailable.");
    }
    const formData = new FormData();
    formData.set("preparedSnapshot", "READY");
    formData.set("confirmationName", workspace.name);
    formData.set(
      "expectedResetSnapshotToken",
      beforeReset.resetSnapshot.token,
    );

    await expect(
      resetBudgetDataAction(workspace.id, idleState, formData),
    ).resolves.toEqual({
      status: "success",
      message: "已清除 39 筆花費與 1 個附件，Drive 固定分類已保留。",
    });
    expect(
      await prisma.budgetItem.count({
        where: { workspaceId: workspace.id, systemTaxonomyKey: null },
      }),
    ).toBe(0);
    expect(
      await prisma.budgetItem.count({
        where: { workspaceId: workspace.id, systemTaxonomyKey: { not: null } },
      }),
    ).toBe(BUDGET_SYSTEM_NODES.length);
    expect(
      await prisma.budgetAttachment.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(0);
    await expect(
      importNotionBudgetRecords({
        client: prisma,
        workspaceId: workspace.id,
        records,
        apply: false,
      }),
    ).resolves.toMatchObject({
      input: 37,
      create: 37,
      unchanged: 0,
      conflict: 0,
      applied: false,
    });
  });

  it("creates, nests, renames, CAS-protects, scopes, and deletes neutral GROUPs", async () => {
    const owner = await createOwnerWorkspace("群組 CRUD 工作區");
    const venueItem = await prisma.budgetItem.findUniqueOrThrow({
      where: {
        workspaceId_systemTaxonomyKey: {
          workspaceId: owner.workspace.id,
          systemTaxonomyKey: "ITEM_WEDDING_VENUE",
        },
      },
      select: { id: true },
    });
    const secondWorkspace = await createWorkspaceForUser(
      owner.user.id,
      "其他群組工作區",
    );
    const foreignParent = await createBudgetItem({
      data: {
        workspaceId: secondWorkspace.id,
        name: "其他工作區父項",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });

    await expect(
      createBudgetGroupAction(
        owner.workspace.id,
        null,
        idleState,
        groupForm("  婚紗   方案  "),
      ),
    ).resolves.toEqual({ status: "success", message: "已建立群組。" });
    const root = await prisma.budgetItem.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, name: "婚紗 方案" },
    });
    expect(root).toMatchObject({
      parentId: venueItem.id,
      kind: "GROUP",
      source: "MANUAL",
      externalId: null,
      sourceHash: null,
      sourceOrder: null,
      category: null,
      legacyCategory: null,
      plannedAmount: 0,
      actualAmount: null,
      dueDate: null,
      notes: null,
      paid: false,
      paidAt: null,
      bookingStatus: "PLANNING",
      depositAmount: null,
      balanceAmount: null,
      additionalAmount: null,
      estimatedRange: null,
      candidateVendors: null,
      confirmedVendor: null,
      vendorContact: null,
      primaryContact: null,
      version: 0,
    });

    await expect(
      createBudgetGroupAction(
        owner.workspace.id,
        root.id,
        idleState,
        groupForm("儀式"),
      ),
    ).resolves.toMatchObject({ status: "success" });
    const child = await prisma.budgetItem.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, parentId: root.id },
    });
    expect(child).toMatchObject({ name: "儀式", kind: "GROUP", category: null });

    await expect(
      createBudgetGroupAction(
        owner.workspace.id,
        foreignParent.id,
        idleState,
        groupForm("跨工作區偽造群組"),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "指定的上層項目不存在或無法使用。",
    });
    expect(
      await prisma.budgetItem.count({
        where: {
          workspaceId: owner.workspace.id,
          name: "跨工作區偽造群組",
        },
      }),
    ).toBe(0);

    await expect(
      updateBudgetGroupAction(
        owner.workspace.id,
        root.id,
        idleState,
        groupForm("  婚紗   完整方案  ", 0),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新群組。" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: root.id } }),
    ).toMatchObject({ name: "婚紗 完整方案", version: 1, kind: "GROUP" });

    await expect(
      updateBudgetGroupAction(
        owner.workspace.id,
        root.id,
        idleState,
        groupForm("過期覆寫", 0),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: root.id } }),
    ).toMatchObject({ name: "婚紗 完整方案", version: 1 });

    await expect(
      deleteBudgetItemAction(
        owner.workspace.id,
        root.id,
        idleState,
        versionForm(1),
      ),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "此花費項目包含子項，請先處理子項後再移除。",
    });
    await expect(
      deleteBudgetItemAction(
        owner.workspace.id,
        child.id,
        idleState,
        versionForm(0),
      ),
    ).resolves.toMatchObject({ status: "success" });
    await expect(
      deleteBudgetItemAction(
        owner.workspace.id,
        root.id,
        idleState,
        versionForm(1),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.count({
        where: {
          workspaceId: owner.workspace.id,
          systemTaxonomyKey: null,
        },
      }),
    ).toBe(0);
  });


  it("atomically deletes one nonempty custom GROUP subtree, cascades attachments, preserves siblings, and rejects stale snapshots", async () => {
    const owner = await createOwnerWorkspace("永久刪除群組子樹");
    const root = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        name: "宴客",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const nestedGroup = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: root.id,
        name: "紅包",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const expense = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: nestedGroup.id,
        name: "婚禮工作人員紅包",
        kind: "EXPENSE",
        category: "OTHER_PENDING",
        plannedAmount: 8000,
      },
    });
    const sibling = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        name: "不在刪除子樹內",
        kind: "EXPENSE",
        category: "OTHER_PENDING",
        plannedAmount: 1,
      },
    });
    const attachmentBytes = Buffer.from("%PDF-1.7\n", "utf8");
    const attachment = await prisma.budgetAttachment.create({
      data: {
        workspaceId: owner.workspace.id,
        budgetItemId: expense.id,
        originalName: "紅包收據.pdf",
        mediaType: "application/pdf",
        byteSize: attachmentBytes.byteLength,
        sha256: createHash("sha256").update(attachmentBytes).digest("hex"),
        data: attachmentBytes,
        uploadedByUserId: owner.user.id,
      },
    });

    const page = await getBudgetPageData(owner.workspace.id);
    const rootSnapshot = page.items.find(
      (item) => item.id === root.id,
    )?.subtreeDeleteSnapshot;
    if (!rootSnapshot) throw new Error("Missing root subtree snapshot.");
    expect(rootSnapshot).toMatchObject({ itemCount: 3, attachmentCount: 1 });

    await expect(
      deleteBudgetGroupSubtreeAction(
        owner.workspace.id,
        root.id,
        idleState,
        subtreeDeleteForm(root.version, rootSnapshot.token, "  宴客  "),
      ),
    ).resolves.toEqual({
      status: "success",
      message:
        "已永久刪除群組「宴客」與 2 筆下層項目，以及 1 個附件。",
    });
    expect(
      await prisma.budgetItem.count({
        where: { id: { in: [root.id, nestedGroup.id, expense.id] } },
      }),
    ).toBe(0);
    expect(
      await prisma.budgetAttachment.findUnique({ where: { id: attachment.id } }),
    ).toBeNull();
    await expect(
      prisma.budgetItem.findUniqueOrThrow({ where: { id: sibling.id } }),
    ).resolves.toMatchObject({ name: "不在刪除子樹內", plannedAmount: 1 });
    expect(
      await prisma.budgetItem.count({
        where: {
          workspaceId: owner.workspace.id,
          systemTaxonomyKey: { not: null },
        },
      }),
    ).toBe(BUDGET_SYSTEM_NODES.length);

    const staleRoot = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        name: "過期群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const staleChild = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: staleRoot.id,
        name: "稍後更新的下層",
        kind: "EXPENSE",
        category: "OTHER_PENDING",
        plannedAmount: 100,
      },
    });
    const stalePage = await getBudgetPageData(owner.workspace.id);
    const staleSnapshot = stalePage.items.find(
      (item) => item.id === staleRoot.id,
    )?.subtreeDeleteSnapshot;
    if (!staleSnapshot) throw new Error("Missing stale subtree snapshot.");
    await prisma.budgetItem.update({
      where: { id: staleChild.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      deleteBudgetGroupSubtreeAction(
        owner.workspace.id,
        staleRoot.id,
        idleState,
        subtreeDeleteForm(
          staleRoot.version,
          staleSnapshot.token,
          staleRoot.name,
        ),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(
      await prisma.budgetItem.count({
        where: { id: { in: [staleRoot.id, staleChild.id] } },
      }),
    ).toBe(2);
  });
  it("dissolves root and nested GROUPs while preserving every expense and attachment field exact-once", async () => {
    const owner = await createOwnerWorkspace("移除群組保留項目");
    const pendingItemId = await internalTaxonomyItemId(owner.workspace.id);
    const foreignWorkspace = await createWorkspaceForUser(
      owner.user.id,
      "其他移除群組工作區",
    );
    const root = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        name: "方案根群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const directExpense = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: root.id,
        source: "NOTION",
        externalId: "10000000-0000-4000-8000-000000000001",
        sourceHash: "a".repeat(64),
        sourceOrder: 17,
        name: "完整資料費用",
        kind: "EXPENSE",
        category: "OTHER_PENDING",
        legacyCategory: "影像舊分類",
        plannedAmount: 90000,
        actualAmount: 25000,
        dueDate: new Date("2028-08-09T00:00:00.000Z"),
        notes: "保留多行資料\n第二行",
        paid: false,
        paidAt: null,
        bookingStatus: "BOOKED_BALANCE_DUE",
        depositAmount: 25000,
        balanceAmount: 65000,
        additionalAmount: 5000,
        estimatedRange: "NT$80,000–95,000",
        candidateVendors: "廠商甲\n廠商乙",
        confirmedVendor: "廠商甲",
        vendorContact: "窗口 測試聯絡方式",
        primaryContact: "PARTNER_A",
      },
    });
    const nestedGroup = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: root.id,
        name: "直接下層群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const grandchildExpense = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: nestedGroup.id,
        name: "孫層完整費用",
        kind: "EXPENSE",
        category: "OTHER_PENDING",
        plannedAmount: 36000,
        actualAmount: 36000,
        dueDate: new Date("2028-07-01T00:00:00.000Z"),
        notes: "孫層資料保持不動",
        paid: true,
        paidAt: new Date("2028-06-30T03:04:05.000Z"),
        bookingStatus: "PAID",
        depositAmount: 12000,
        balanceAmount: 24000,
        additionalAmount: 0,
        estimatedRange: "固定價 36,000",
        candidateVendors: "服裝工作室",
        confirmedVendor: "服裝工作室",
        vendorContact: "服裝窗口",
        primaryContact: "PARTNER_B",
      },
    });
    const attachmentBytes = Buffer.from("%PDF-1.7\n", "utf8");
    const attachment = await prisma.budgetAttachment.create({
      data: {
        workspaceId: owner.workspace.id,
        budgetItemId: directExpense.id,
        originalName: "保留證明.pdf",
        mediaType: "application/pdf",
        byteSize: attachmentBytes.byteLength,
        sha256: createHash("sha256").update(attachmentBytes).digest("hex"),
        data: attachmentBytes,
        uploadedByUserId: owner.user.id,
      },
    });

    const beforeDirectExpense = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: directExpense.id },
    });
    const beforeGrandchildExpense = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: grandchildExpense.id },
    });
    const beforeAttachment = await prisma.budgetAttachment.findUniqueOrThrow({
      where: { id: attachment.id },
    });
    const beforeSummary = (await getBudgetPageData(owner.workspace.id)).summary;

    await expect(
      dissolveBudgetGroupAction(
        owner.workspace.id,
        root.id,
        idleState,
        dissolveForm(root.version, [directExpense.id, nestedGroup.id]),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已移除群組並保留其中項目。",
    });

    expect(
      await prisma.budgetItem.findUnique({ where: { id: root.id } }),
    ).toBeNull();
    const afterDirectExpense = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: directExpense.id },
    });
    const afterNestedGroup = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: nestedGroup.id },
    });
    const afterGrandchildExpense = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: grandchildExpense.id },
    });
    expect(afterDirectExpense).toMatchObject({
      parentId: pendingItemId,
      version: 1,
    });
    expect(afterNestedGroup).toMatchObject({
      parentId: pendingItemId,
      version: 1,
    });
    expect(afterGrandchildExpense).toMatchObject({
      parentId: nestedGroup.id,
      version: 0,
    });

    const preservedExpenseFields = (row: typeof afterDirectExpense) => {
      const { parentId, version, updatedAt, ...preserved } = row;
      void parentId;
      void version;
      void updatedAt;
      return preserved;
    };
    expect(preservedExpenseFields(afterDirectExpense)).toEqual(
      preservedExpenseFields(beforeDirectExpense),
    );
    expect(preservedExpenseFields(afterGrandchildExpense)).toEqual(
      preservedExpenseFields(beforeGrandchildExpense),
    );

    const afterAttachment = await prisma.budgetAttachment.findUniqueOrThrow({
      where: { id: attachment.id },
    });
    expect({
      ...afterAttachment,
      data: Buffer.from(afterAttachment.data),
    }).toEqual({
      ...beforeAttachment,
      data: Buffer.from(beforeAttachment.data),
    });
    expect((await getBudgetPageData(owner.workspace.id)).summary).toEqual(
      beforeSummary,
    );

    const originalParent = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        name: "原上層方案",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const secondNestedGroup = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: originalParent.id,
        name: "待移除內層群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const secondNestedExpense = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: secondNestedGroup.id,
        name: "移回原上層的費用",
        category: "OTHER_PENDING",
        plannedAmount: 1234,
      },
    });
    await expect(
      dissolveBudgetGroupAction(
        owner.workspace.id,
        secondNestedGroup.id,
        idleState,
        dissolveForm(0, [secondNestedExpense.id]),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUnique({ where: { id: secondNestedGroup.id } }),
    ).toBeNull();
    expect(
      await prisma.budgetItem.findUniqueOrThrow({
        where: { id: secondNestedExpense.id },
      }),
    ).toMatchObject({ parentId: originalParent.id, version: 1 });

    const guardedGroup = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        name: "權限與 CAS 保護群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const guardedChild = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        parentId: guardedGroup.id,
        name: "不得被移動",
        category: "OTHER_PENDING",
        plannedAmount: 99,
      },
    });
    const foreignGroup = await createBudgetItem({
      data: {
        workspaceId: foreignWorkspace.id,
        name: "其他工作區群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const viewer = await createUser("dissolve-viewer");
    await prisma.membership.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    });
    authState.userId = viewer.id;
    await expect(
      dissolveBudgetGroupAction(
        owner.workspace.id,
        guardedGroup.id,
        idleState,
        new FormData(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    authState.userId = owner.user.id;
    await expect(
      dissolveBudgetGroupAction(
        owner.workspace.id,
        foreignGroup.id,
        idleState,
        dissolveForm(0, []),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    await expect(
      dissolveBudgetGroupAction(
        owner.workspace.id,
        guardedGroup.id,
        idleState,
        dissolveForm(99, [guardedChild.id]),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({
        where: { id: guardedGroup.id },
      }),
    ).toMatchObject({ parentId: pendingItemId, version: 0 });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({
        where: { id: guardedChild.id },
      }),
    ).toMatchObject({ parentId: guardedGroup.id, version: 0 });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({
        where: { id: foreignGroup.id },
      }),
    ).toMatchObject({ workspaceId: foreignWorkspace.id, version: 0 });
  });

  it.each(["move-first", "dissolve-first"] as const)(
    "forces %s to win a real public move/dissolve race through an exact blocking chain",
    async (winnerOrder) => {
      const { workspace } = await createOwnerWorkspace(
        `固定競態勝方-${winnerOrder}`,
      );
      const pendingItemId = await internalTaxonomyItemId(workspace.id);
      const [group, target] = await Promise.all([
        createBudgetItem({
          data: {
            workspaceId: workspace.id,
            name: "固定順序待移除群組",
            kind: "GROUP",
            category: null,
            plannedAmount: 0,
          },
        }),
        createBudgetItem({
          data: {
            workspaceId: workspace.id,
            name: "固定順序目標群組",
            kind: "GROUP",
            category: null,
            plannedAmount: 0,
          },
        }),
      ]);
      const child = await createBudgetItem({
        data: {
          workspaceId: workspace.id,
          parentId: group.id,
          name: "固定順序直接子項",
          category: "OTHER_PENDING",
          plannedAmount: 789,
        },
      });
      const staleDissolveForm = dissolveForm(group.version, [child.id]);
      const staleMoveForm = moveForm(child.version, target.id);
      const deadlocksBefore = await databaseDeadlockCount();

      // The external row barrier makes the chosen winner acquire the hierarchy
      // advisory lock and then wait on a known PID. Only after that edge is
      // observed do we start the loser and prove that it waits on the winner's
      // advisory lock. Both public actions are therefore in flight before the
      // barrier can be released: barrier -> winner -> loser.
      const barrier = await holdBudgetItemRowLock(
        winnerOrder === "move-first" ? child.id : group.id,
      );
      type ActionPromise = ReturnType<typeof moveBudgetItemAction>;
      const actions: ActionPromise[] = [];
      let results:
        | [
            Awaited<ReturnType<typeof moveBudgetItemAction>>,
            Awaited<ReturnType<typeof moveBudgetItemAction>>,
          ]
        | undefined;
      try {
        const winner =
          winnerOrder === "move-first"
            ? moveBudgetItemAction(
                workspace.id,
                child.id,
                idleState,
                staleMoveForm,
              )
            : dissolveBudgetGroupAction(
                workspace.id,
                group.id,
                idleState,
                staleDissolveForm,
              );
        actions.push(winner);
        const winnerPid = await waitForBlockingChain(barrier.pid, "row");

        const loser =
          winnerOrder === "move-first"
            ? dissolveBudgetGroupAction(
                workspace.id,
                group.id,
                idleState,
                staleDissolveForm,
              )
            : moveBudgetItemAction(
                workspace.id,
                child.id,
                idleState,
                staleMoveForm,
              );
        actions.push(loser);
        const loserPid = await waitForBlockingChain(winnerPid, "advisory");
        expect(new Set([barrier.pid, winnerPid, loserPid]).size).toBe(3);

        barrier.release();
        await barrier.completion;
        results = await Promise.all([winner, loser]);
      } finally {
        barrier.release();
        await Promise.allSettled([barrier.completion, ...actions]);
      }
      if (!results) throw new Error("The forced hierarchy race did not settle.");
      const [winnerResult, loserResult] = results;

      expect(winnerResult).toMatchObject({ status: "success" });
      expect(loserResult).toMatchObject({ status: "error", code: "STALE" });
      expect(await databaseDeadlockCount()).toBe(deadlocksBefore);

      const afterGroup = await prisma.budgetItem.findUnique({
        where: { id: group.id },
      });
      const afterChild = await prisma.budgetItem.findUniqueOrThrow({
        where: { id: child.id },
      });
      if (winnerOrder === "move-first") {
        expect(afterGroup).toMatchObject({
          id: group.id,
          parentId: pendingItemId,
          version: group.version,
        });
        expect(afterChild).toMatchObject({
          parentId: target.id,
          version: child.version + 1,
        });
      } else {
        expect(afterGroup).toBeNull();
        expect(afterChild).toMatchObject({
          parentId: pendingItemId,
          version: child.version + 1,
        });
      }

      const finalRows = await prisma.budgetItem.findMany({
        where: { workspaceId: workspace.id },
        select: { id: true, parentId: true },
      });
      const finalIds = new Set(finalRows.map((row) => row.id));
      expect(
        finalRows.every(
          (row) => row.parentId === null || finalIds.has(row.parentId),
        ),
      ).toBe(true);
    },
  );

  it("does not accept an unrelated row waiter as hierarchy concurrency evidence", async () => {
    const { workspace } = await createOwnerWorkspace("指定 blocker 證據");
    const [waitedItem, unrelatedItem] = await Promise.all([
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "真的等待項目",
          category: "OTHER_PENDING",
          plannedAmount: 1,
        },
      }),
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "無關 blocker 項目",
          category: "OTHER_PENDING",
          plannedAmount: 2,
        },
      }),
    ]);
    const actualBarrier = await holdBudgetItemRowLock(waitedItem.id);
    const unrelatedBarrier = await holdBudgetItemRowLock(unrelatedItem.id);
    const waiter = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`
          SELECT "id"
          FROM "budget_items"
          WHERE "id" = ${waitedItem.id}
          FOR UPDATE
        `,
      );
    });

    try {
      await waitForBlockingChain(actualBarrier.pid, "row");
      await expect(
        waitForBlockingChain(unrelatedBarrier.pid, "row"),
      ).rejects.toThrow(
        `Timed out waiting for PID ${unrelatedBarrier.pid} to block one row waiter.`,
      );
    } finally {
      actualBarrier.release();
      unrelatedBarrier.release();
      await Promise.allSettled([
        actualBarrier.completion,
        unrelatedBarrier.completion,
        waiter,
      ]);
    }
  });

  it.each(["added", "moved", "deleted"] as const)(
    "rejects a stale dissolve after a direct child is %s and leaves the stable child unmoved",
    async (change) => {
      const { workspace } = await createOwnerWorkspace(
        `直接子項確認過期-${change}`,
      );
      const pendingItemId = await internalTaxonomyItemId(workspace.id);
      const group = await createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "待確認群組",
          kind: "GROUP",
          category: null,
          plannedAmount: 0,
        },
      });
      const stableChild = await createBudgetItem({
        data: {
          workspaceId: workspace.id,
          parentId: group.id,
          name: "必須留在群組內",
          category: "OTHER_PENDING",
          plannedAmount: 100,
        },
      });
      const changedChild = await createBudgetItem({
        data: {
          workspaceId: workspace.id,
          parentId: group.id,
          name: "直接子項變更目標",
          category: "OTHER_PENDING",
          plannedAmount: 200,
        },
      });
      const staleConfirmation = dissolveForm(group.version, [
        stableChild.id,
        changedChild.id,
      ]);

      let addedChildId: string | null = null;
      if (change === "added") {
        const addedChild = await createBudgetItem({
          data: {
            workspaceId: workspace.id,
            parentId: group.id,
            name: "後來新增的直接子項",
            category: "OTHER_PENDING",
            plannedAmount: 300,
          },
        });
        addedChildId = addedChild.id;
      } else if (change === "moved") {
        await prisma.budgetItem.update({
          where: { id: changedChild.id },
          data: { parentId: pendingItemId, version: { increment: 1 } },
        });
      } else {
        await prisma.budgetItem.delete({ where: { id: changedChild.id } });
      }

      await expect(
        dissolveBudgetGroupAction(
          workspace.id,
          group.id,
          idleState,
          staleConfirmation,
        ),
      ).resolves.toMatchObject({ status: "error", code: "STALE" });

      expect(
        await prisma.budgetItem.findUniqueOrThrow({ where: { id: group.id } }),
      ).toMatchObject({ parentId: pendingItemId, version: group.version });
      expect(
        await prisma.budgetItem.findUniqueOrThrow({
          where: { id: stableChild.id },
        }),
      ).toMatchObject({ parentId: group.id, version: stableChild.version });
      if (addedChildId !== null) {
        expect(
          await prisma.budgetItem.findUniqueOrThrow({
            where: { id: addedChildId },
          }),
        ).toMatchObject({ parentId: group.id, version: 0 });
      }
    },
  );

  it("proves the only FK-admissible nested race: dissolve locks its destination before direct parent delete waits and fails", async () => {
    const { workspace } = await createOwnerWorkspace("巢狀移除鎖定順序");
    const pendingItemId = await internalTaxonomyItemId(workspace.id);
    const parent = await createBudgetItem({
      data: {
        workspaceId: workspace.id,
        name: "目的上層",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const group = await createBudgetItem({
      data: {
        workspaceId: workspace.id,
        parentId: parent.id,
        name: "待移除巢狀群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    const child = await createBudgetItem({
      data: {
        workspaceId: workspace.id,
        parentId: group.id,
        name: "不可成為孤兒的費用",
        category: "OTHER_PENDING",
        plannedAmount: 456,
      },
    });
    expect(group.parentId).toBe(parent.id);
    const deadlocksBefore = await databaseDeadlockCount();

    // A delete-first success cannot exist: the nested GROUP already references
    // parent through the NO ACTION hierarchy FK. This intentionally stays a
    // database-level delete to prove the only admissible live ordering. The
    // external GROUP barrier exposes: barrier -> dissolve (GROUP row), then
    // dissolve -> parent delete (destination row held FOR KEY SHARE).
    const barrier = await holdBudgetItemRowLock(group.id);
    const actions: Promise<unknown>[] = [];
    let dissolveResult:
      | Awaited<ReturnType<typeof dissolveBudgetGroupAction>>
      | undefined;
    let parentDeleteResult:
      | { deleted: true; code: null }
      | { deleted: false; code: unknown }
      | undefined;
    try {
      const dissolve = dissolveBudgetGroupAction(
        workspace.id,
        group.id,
        idleState,
        dissolveForm(group.version, [child.id]),
      );
      actions.push(dissolve);
      const dissolvePid = await waitForBlockingChain(barrier.pid, "row");

      const parentDelete = prisma.budgetItem
        .delete({ where: { id: parent.id } })
        .then(
          () => ({ deleted: true as const, code: null }),
          (error: unknown) => ({
            deleted: false as const,
            code:
              typeof error === "object" && error !== null && "code" in error
                ? error.code
                : null,
          }),
        );
      actions.push(parentDelete);
      const parentDeletePid = await waitForBlockingChain(dissolvePid, "row");
      expect(new Set([barrier.pid, dissolvePid, parentDeletePid]).size).toBe(3);

      barrier.release();
      await barrier.completion;
      [dissolveResult, parentDeleteResult] = await Promise.all([
        dissolve,
        parentDelete,
      ]);
    } finally {
      barrier.release();
      await Promise.allSettled([barrier.completion, ...actions]);
    }
    if (!dissolveResult || !parentDeleteResult) {
      throw new Error("The nested dissolve/delete race did not settle.");
    }

    expect(dissolveResult).toMatchObject({ status: "success" });
    expect(parentDeleteResult).toEqual({
      deleted: false,
      code: "P2003",
    });
    expect(await databaseDeadlockCount()).toBe(deadlocksBefore);

    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: parent.id } }),
    ).toMatchObject({ parentId: pendingItemId });
    expect(
      await prisma.budgetItem.findUnique({ where: { id: group.id } }),
    ).toBeNull();
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: child.id } }),
    ).toMatchObject({ parentId: parent.id, version: 1 });
    const finalRows = await prisma.budgetItem.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, parentId: true },
    });
    const finalIds = new Set(finalRows.map((row) => row.id));
    expect(
      finalRows.every(
        (row) => row.parentId === null || finalIds.has(row.parentId),
      ),
    ).toBe(true);
  });

  it("isolates tenant reads and forged writes while allowing the same name across workspaces", async () => {
    const owner = await createOwnerWorkspace("第一工作區");
    const secondWorkspace = await createWorkspaceForUser(
      owner.user.id,
      "第二工作區",
    );
    const firstItem = await createBudgetItem({
      data: {
        workspaceId: owner.workspace.id,
        name: "同名項目",
        category: "OTHER_PENDING",
        plannedAmount: 100,
      },
    });
    const secondItem = await createBudgetItem({
      data: {
        workspaceId: secondWorkspace.id,
        name: "同名項目",
        category: "OTHER_PENDING",
        plannedAmount: 200,
      },
    });

    const firstPage = await getBudgetPageData(owner.workspace.id);
    expect(
      firstPage.items
        .filter((item) => item.systemTaxonomyKey === null)
        .map((item) => item.id),
    ).toEqual([firstItem.id]);
    expect(firstPage.summary).toMatchObject({ itemCount: 1, plannedTotal: "100" });

    await expect(
      updateBudgetItemAction(
        owner.workspace.id,
        secondItem.id,
        idleState,
        detailsForm({ name: "偽造更新", expectedVersion: 0 }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: secondItem.id } }),
    ).toMatchObject({ name: "同名項目", workspaceId: secondWorkspace.id });

    const outsider = await createUser("outsider");
    authState.userId = outsider.id;
    await expect(getBudgetPageData(owner.workspace.id)).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
  });

  it("does not create a GROUP after an accepted editor membership is concurrently revoked", async () => {
    const owner = await createOwnerWorkspace();
    const editor = await createUser("revoked-editor");
    await prisma.membership.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: editor.id,
        role: "PLANNER",
      },
    });
    authState.userId = editor.id;

    let markRevocationStarted!: (pid: number) => void;
    const revocationStarted = new Promise<number>((resolve) => {
      markRevocationStarted = resolve;
    });
    let releaseRevocation!: () => void;
    const holdRevocation = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    const revocation = prisma.$transaction(async (transaction) => {
      await transaction.membership.delete({
        where: {
          workspaceId_userId: {
            workspaceId: owner.workspace.id,
            userId: editor.id,
          },
        },
      });
      const [backend] = await transaction.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid()::int AS "pid"
      `;
      markRevocationStarted(backend.pid);
      await holdRevocation;
    });

    const revocationPid = await revocationStarted;
    const createResult = createBudgetGroupAction(
      owner.workspace.id,
      null,
      idleState,
      groupForm("撤權競態群組"),
    );
    try {
      await waitForBlockingChain(revocationPid, "row");
    } finally {
      releaseRevocation();
      await Promise.allSettled([revocation, createResult]);
    }

    await expect(createResult).resolves.toMatchObject({
      status: "error",
      code: "FORBIDDEN",
    });
    expect(
      await prisma.budgetItem.count({
        where: {
          workspaceId: owner.workspace.id,
          systemTaxonomyKey: null,
        },
      }),
    ).toBe(0);
  });

  it("denies VIEWER and outsider mutations before validation on real PostgreSQL memberships", async () => {
    const owner = await createOwnerWorkspace();
    const viewer = await createUser("viewer");
    await prisma.membership.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    });

    authState.userId = viewer.id;
    await expect(
      createBudgetGroupAction(
        owner.workspace.id,
        null,
        idleState,
        groupForm("VIEWER 群組"),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    await expect(
      updateBudgetGroupAction(
        owner.workspace.id,
        "forged_group",
        idleState,
        groupForm("VIEWER 更新", 0),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    await expect(
      createBudgetItemAction(owner.workspace.id, idleState, new FormData()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    const outsider = await createUser("mutation-outsider");
    authState.userId = outsider.id;
    await expect(
      createBudgetItemAction(owner.workspace.id, idleState, new FormData()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    expect(
      await prisma.budgetItem.count({
        where: {
          workspaceId: owner.workspace.id,
          systemTaxonomyKey: null,
        },
      }),
    ).toBe(0);
  });

  it("allows exactly one concurrent write for a shared optimistic version", async () => {
    const { workspace } = await createOwnerWorkspace();
    const item = await createBudgetItem({
      data: {
        workspaceId: workspace.id,
        name: "競速項目",
        category: "OTHER_PENDING",
        plannedAmount: 100,
      },
    });

    const results = await Promise.all([
      updateBudgetItemAction(
        workspace.id,
        item.id,
        idleState,
        detailsForm({ name: "編輯勝出", expectedVersion: 0 }),
      ),
      changeBudgetItemBookingStatusAction(
        workspace.id,
        item.id,
        idleState,
        bookingStatusForm("PAID", 0),
      ),
    ]);

    expect(results.filter((result) => result.status === "success")).toHaveLength(1);
    expect(results.find((result) => result.code === "STALE")).toBeDefined();
    const stored = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored.version).toBe(1);
    expect(stored.paid).toBe(stored.paidAt !== null);
    expect(stored.actualAmount).toBe(
      stored.bookingStatus === "PLANNING"
        ? null
        : stored.bookingStatus === "BOOKED_BALANCE_DUE"
          ? stored.depositAmount
          : stored.plannedAmount,
    );

    await expect(
      deleteBudgetItemAction(workspace.id, item.id, idleState, versionForm(0)),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
  });

  it("allows one winner across the remaining CAS race matrix", async () => {
    const { workspace } = await createOwnerWorkspace();
    const scenarios = [
      {
        name: "edit-edit",
        startsPaid: false,
        mutations: (itemId: string) => [
          updateBudgetItemAction(
            workspace.id,
            itemId,
            idleState,
            detailsForm({ name: "編輯甲", expectedVersion: 0 }),
          ),
          updateBudgetItemAction(
            workspace.id,
            itemId,
            idleState,
            detailsForm({ name: "編輯乙", expectedVersion: 0 }),
          ),
        ],
      },
      {
        name: "edit-delete",
        startsPaid: false,
        mutations: (itemId: string) => [
          updateBudgetItemAction(
            workspace.id,
            itemId,
            idleState,
            detailsForm({ name: "編輯後刪除競速", expectedVersion: 0 }),
          ),
          deleteBudgetItemAction(
            workspace.id,
            itemId,
            idleState,
            versionForm(0),
          ),
        ],
      },
      {
        name: "paid-delete",
        startsPaid: false,
        mutations: (itemId: string) => [
          changeBudgetItemBookingStatusAction(
            workspace.id,
            itemId,
            idleState,
            bookingStatusForm("PAID", 0),
          ),
          deleteBudgetItemAction(
            workspace.id,
            itemId,
            idleState,
            versionForm(0),
          ),
        ],
      },
      {
        name: "paid-paid",
        startsPaid: true,
        mutations: (itemId: string) => [
          changeBudgetItemBookingStatusAction(
            workspace.id,
            itemId,
            idleState,
            bookingStatusForm("PAID", 0),
          ),
          changeBudgetItemBookingStatusAction(
            workspace.id,
            itemId,
            idleState,
            bookingStatusForm("PAID", 0),
          ),
        ],
      },
      {
        name: "paid-unpaid",
        startsPaid: true,
        mutations: (itemId: string) => [
          changeBudgetItemBookingStatusAction(
            workspace.id,
            itemId,
            idleState,
            bookingStatusForm("PAID", 0),
          ),
          changeBudgetItemBookingStatusAction(
            workspace.id,
            itemId,
            idleState,
            bookingStatusForm("BOOKED_BALANCE_DUE", 0),
          ),
        ],
      },
    ];

    for (const scenario of scenarios) {
      const originalPaidAt = scenario.startsPaid
        ? new Date("2027-03-01T08:09:10.000Z")
        : null;
      const item = await createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: `競速 ${scenario.name}`,
          category: "OTHER_PENDING",
          plannedAmount: 100,
          paid: scenario.startsPaid,
          paidAt: originalPaidAt,
          bookingStatus: scenario.startsPaid ? "PAID" : "PLANNING",
        },
      });

      const results = await Promise.all(scenario.mutations(item.id));
      expect(
        results.filter((result) => result.status === "success"),
        scenario.name,
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.code === "STALE"),
        scenario.name,
      ).toHaveLength(1);

      const stored = await prisma.budgetItem.findUnique({
        where: { id: item.id },
      });
      if (stored) {
        expect(stored.version, scenario.name).toBe(1);
        expect(stored.paid, scenario.name).toBe(
          stored.bookingStatus === "PAID",
        );
        expect(stored.actualAmount, scenario.name).toBe(
          stored.bookingStatus === "PLANNING"
            ? null
            : stored.bookingStatus === "BOOKED_BALANCE_DUE"
              ? stored.depositAmount
              : stored.plannedAmount,
        );
        if (scenario.name === "paid-paid") {
          expect(stored.paidAt, scenario.name).toEqual(originalPaidAt);
        }
      }
    }
  });

  it("keeps actual amount and pending balance consistent across the full action lifecycle", async () => {
    const { workspace } = await createOwnerWorkspace(
      "付款與實付一致性 integration",
    );

    await expect(
      createBudgetItemAction(
        workspace.id,
        idleState,
        detailsForm({
          name: "付款一致性項目",
          plannedAmount: "999999",
          actualAmount: "777777",
          depositAmount: "12000",
          balanceAmount: "34000",
          additionalAmount: "500",
          bookingStatus: "PAID",
        }),
      ),
    ).resolves.toMatchObject({ status: "success" });

    const created = await prisma.budgetItem.findFirstOrThrow({
      where: { workspaceId: workspace.id, name: "付款一致性項目" },
    });
    expect(created).toMatchObject({
      bookingStatus: "PLANNING",
      paid: false,
      paidAt: null,
      plannedAmount: 46500,
      actualAmount: null,
      depositAmount: 12000,
      balanceAmount: 34000,
      additionalAmount: 500,
      version: 0,
    });

    await expect(
      changeBudgetItemBookingStatusAction(
        workspace.id,
        created.id,
        idleState,
        bookingStatusForm("BOOKED_BALANCE_DUE", 0),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      bookingStatus: "BOOKED_BALANCE_DUE",
      paid: false,
      paidAt: null,
      actualAmount: 12000,
      version: 1,
    });

    const bookedPage = await getBudgetPageData(workspace.id);
    expect(bookedPage.summary).toMatchObject({
      actualTotal: "12000",
      balanceDueTotal: "34000",
      balanceDueCount: 1,
    });

    await expect(
      updateBudgetItemAction(
        workspace.id,
        created.id,
        idleState,
        detailsForm({
          name: "付款一致性項目",
          plannedAmount: "888888",
          actualAmount: "999999",
          depositAmount: "15000",
          balanceAmount: "36000",
          additionalAmount: "750",
          bookingStatus: "PAID",
          expectedVersion: 1,
        }),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      bookingStatus: "BOOKED_BALANCE_DUE",
      plannedAmount: 51750,
      actualAmount: 15000,
      depositAmount: 15000,
      balanceAmount: 36000,
      additionalAmount: 750,
      version: 2,
    });

    const editedBookedPage = await getBudgetPageData(workspace.id);
    expect(editedBookedPage.summary).toMatchObject({
      actualTotal: "15000",
      balanceDueTotal: "36000",
      balanceDueCount: 1,
    });

    await expect(
      changeBudgetItemBookingStatusAction(
        workspace.id,
        created.id,
        idleState,
        bookingStatusForm("PAID", 2),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      bookingStatus: "PAID",
      paid: true,
      plannedAmount: 51750,
      actualAmount: 51750,
      version: 3,
    });

    const paidPage = await getBudgetPageData(workspace.id);
    expect(paidPage.summary).toMatchObject({
      actualTotal: "51750",
      balanceDueTotal: "0",
      balanceDueCount: 0,
    });

    await expect(
      updateBudgetItemAction(
        workspace.id,
        created.id,
        idleState,
        detailsForm({
          name: "付款一致性項目",
          plannedAmount: "1",
          actualAmount: "2",
          depositAmount: "20000",
          balanceAmount: "40000",
          additionalAmount: "1000",
          bookingStatus: "PLANNING",
          expectedVersion: 3,
        }),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      bookingStatus: "PAID",
      paid: true,
      plannedAmount: 61000,
      actualAmount: 61000,
      depositAmount: 20000,
      balanceAmount: 40000,
      additionalAmount: 1000,
      version: 4,
    });

    await expect(
      changeBudgetItemBookingStatusAction(
        workspace.id,
        created.id,
        idleState,
        bookingStatusForm("PLANNING", 4),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      bookingStatus: "PLANNING",
      paid: false,
      paidAt: null,
      plannedAmount: 61000,
      actualAmount: null,
      version: 5,
    });
  });

  it("transitions paid and paidAt atomically, including same-target status", async () => {
    const { workspace } = await createOwnerWorkspace();
    const item = await createBudgetItem({
      data: {
        workspaceId: workspace.id,
        name: "付款狀態",
        category: "OTHER_PENDING",
        plannedAmount: 100,
      },
    });

    await expect(
      changeBudgetItemBookingStatusAction(
        workspace.id,
        item.id,
        idleState,
        bookingStatusForm("PAID", 0),
      ),
    ).resolves.toMatchObject({ status: "success" });
    const paid = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(paid).toMatchObject({
      bookingStatus: "PAID",
      paid: true,
      version: 1,
    });
    expect(paid.paidAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(
      changeBudgetItemBookingStatusAction(
        workspace.id,
        item.id,
        idleState,
        bookingStatusForm("PAID", 1),
      ),
    ).resolves.toMatchObject({ status: "success" });
    const paidAgain = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(paidAgain).toMatchObject({ paid: true, version: 2 });
    expect(paidAgain.paidAt).toEqual(paid.paidAt);

    await expect(
      changeBudgetItemBookingStatusAction(
        workspace.id,
        item.id,
        idleState,
        bookingStatusForm("BOOKED_BALANCE_DUE", 2),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({
      bookingStatus: "BOOKED_BALANCE_DUE",
      paid: false,
      paidAt: null,
      version: 3,
    });
  });

  it("moves hierarchy only with same-workspace non-descendant targets and fresh CAS", async () => {
    const { user, workspace } = await createOwnerWorkspace("移動階層");
    const pendingItemId = await internalTaxonomyItemId(workspace.id);
    const otherWorkspace = await createWorkspaceForUser(user.id, "其他工作區");
    const [rootA, rootB, foreignRoot] = await Promise.all([
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "方案甲",
          category: "OTHER_PENDING",
          plannedAmount: 0,
        },
      }),
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "方案乙",
          category: "OTHER_PENDING",
          plannedAmount: 0,
        },
      }),
      createBudgetItem({
        data: {
          workspaceId: otherWorkspace.id,
          name: "外部根層",
          category: "OTHER_PENDING",
          plannedAmount: 0,
        },
      }),
    ]);
    const child = await createBudgetItem({
      data: {
        workspaceId: workspace.id,
        parentId: rootA.id,
        name: "攝影",
        category: "PHOTOGRAPHY_VIDEO",
        plannedAmount: 0,
      },
    });
    const grandchild = await createBudgetItem({
      data: {
        workspaceId: workspace.id,
        parentId: child.id,
        name: "婚攝",
        category: "PHOTOGRAPHY_VIDEO",
        plannedAmount: 0,
      },
    });

    for (const [itemId, targetParentId, expectedVersion] of [
      [rootA.id, grandchild.id, 0],
      [child.id, child.id, 0],
      [child.id, foreignRoot.id, 0],
      [child.id, rootB.id, 99],
    ] as const) {
      await expect(
        moveBudgetItemAction(
          workspace.id,
          itemId,
          idleState,
          moveForm(expectedVersion, targetParentId),
        ),
      ).resolves.toMatchObject({ status: "error", code: "STALE" });
    }

    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: rootA.id } }),
    ).toMatchObject({ parentId: pendingItemId, version: 0 });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: child.id } }),
    ).toMatchObject({ parentId: rootA.id, version: 0 });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: grandchild.id } }),
    ).toMatchObject({ parentId: child.id, version: 0 });

    await expect(
      moveBudgetItemAction(
        workspace.id,
        child.id,
        idleState,
        moveForm(0, rootB.id),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: child.id } }),
    ).toMatchObject({ parentId: rootB.id, version: 1 });

    await expect(
      moveBudgetItemAction(
        workspace.id,
        grandchild.id,
        idleState,
        moveForm(0, pendingItemId),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findUniqueOrThrow({ where: { id: grandchild.id } }),
    ).toMatchObject({ parentId: pendingItemId, version: 1 });
  });

  it("serializes reciprocal hierarchy moves so concurrent requests cannot create a cycle", async () => {
    const { workspace } = await createOwnerWorkspace("移動競態");
    const pendingItemId = await internalTaxonomyItemId(workspace.id);
    const [left, right] = await Promise.all([
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "方案甲",
          category: "OTHER_PENDING",
          plannedAmount: 0,
        },
      }),
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "方案乙",
          category: "OTHER_PENDING",
          plannedAmount: 0,
        },
      }),
    ]);

    const barrier = await holdBudgetItemRowLock(left.id);
    const actions: ReturnType<typeof moveBudgetItemAction>[] = [];
    let outcomes:
      | [
          Awaited<ReturnType<typeof moveBudgetItemAction>>,
          Awaited<ReturnType<typeof moveBudgetItemAction>>,
        ]
      | undefined;
    try {
      const leftMove = moveBudgetItemAction(
        workspace.id,
        left.id,
        idleState,
        moveForm(0, right.id),
      );
      actions.push(leftMove);
      const leftMovePid = await waitForBlockingChain(barrier.pid, "row");

      const rightMove = moveBudgetItemAction(
        workspace.id,
        right.id,
        idleState,
        moveForm(0, left.id),
      );
      actions.push(rightMove);
      await waitForBlockingChain(leftMovePid, "advisory");

      barrier.release();
      await barrier.completion;
      outcomes = await Promise.all([leftMove, rightMove]);
    } finally {
      barrier.release();
      await Promise.allSettled([barrier.completion, ...actions]);
    }
    if (!outcomes) throw new Error("The reciprocal move race did not settle.");
    expect(outcomes[0]).toMatchObject({ status: "success" });
    expect(outcomes[1]).toMatchObject({ status: "error", code: "STALE" });

    const [afterLeft, afterRight] = await Promise.all([
      prisma.budgetItem.findUniqueOrThrow({ where: { id: left.id } }),
      prisma.budgetItem.findUniqueOrThrow({ where: { id: right.id } }),
    ]);
    expect(afterLeft.parentId).toBe(right.id);
    expect(afterRight.parentId).toBe(pendingItemId);
    expect(afterLeft.version + afterRight.version).toBe(1);
  });

  it("serializes the offline operator against an interactive reciprocal move", async () => {
    const { user, workspace } = await createOwnerWorkspace("跨路徑移動競態");
    const pendingItemId = await internalTaxonomyItemId(workspace.id);
    const pendingPath = taxonomyPlanPath(BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY);
    const pendingRef = taxonomyPlanReference(
      BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
    );
    const [left, right] = await Promise.all([
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "A",
          category: "OTHER_PENDING",
          plannedAmount: 0,
        },
      }),
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "B",
          category: "OTHER_PENDING",
          plannedAmount: 0,
        },
      }),
    ]);
    const beforeRows = await prisma.budgetItem.findMany({
      where: { workspaceId: workspace.id },
    });
    const finalRows = beforeRows.map((row) =>
      row.id === left.id ? { ...row, parentId: right.id } : row,
    );
    const plan = parseBudgetHierarchyPlanJson(
      JSON.stringify({
        version: 1,
        expected: {
          before: computeBudgetHierarchyProjection(beforeRows),
          final: computeBudgetHierarchyProjection(finalRows),
        },
        groups: [],
        items: [
          ...fixedTaxonomyPlanItems(),
          {
            ref: "left",
            beforePath: [...pendingPath, "A"],
            finalPath: [...pendingPath, "B", "A"],
            finalKind: "EXPENSE",
            finalCategory: "OTHER_PENDING",
            finalName: "A",
            parentRef: "right",
          },
          {
            ref: "right",
            beforePath: [...pendingPath, "B"],
            finalPath: [...pendingPath, "B"],
            finalKind: "EXPENSE",
            finalCategory: "OTHER_PENDING",
            finalName: "B",
            parentRef: pendingRef,
          },
        ],
      }),
    );

    const barrier = await holdBudgetItemRowLock(left.id);
    const firstRaceActions: Promise<unknown>[] = [];
    let operatorResult:
      | Awaited<ReturnType<typeof reorganizeBudgetHierarchy>>
      | undefined;
    let interactiveResult:
      | Awaited<ReturnType<typeof moveBudgetItemAction>>
      | undefined;
    try {
      const operator = reorganizeBudgetHierarchy({
        client: prisma,
        workspaceId: workspace.id,
        actorUserId: user.id,
        plan,
        apply: true,
      });
      firstRaceActions.push(operator);
      const operatorPid = await waitForBlockingChain(barrier.pid, "row");

      const interactive = moveBudgetItemAction(
        workspace.id,
        right.id,
        idleState,
        moveForm(0, left.id),
      );
      firstRaceActions.push(interactive);
      await waitForBlockingChain(operatorPid, "advisory");

      barrier.release();
      await barrier.completion;
      [operatorResult, interactiveResult] = await Promise.all([
        operator,
        interactive,
      ]);
    } finally {
      barrier.release();
      await Promise.allSettled([barrier.completion, ...firstRaceActions]);
    }
    if (!operatorResult || !interactiveResult) {
      throw new Error("The operator-first hierarchy race did not settle.");
    }
    expect(operatorResult).toMatchObject({
      mode: "apply",
      applied: true,
      update: 1,
    });
    expect(interactiveResult).toMatchObject({ status: "error", code: "STALE" });

    const [afterLeft, afterRight] = await Promise.all([
      prisma.budgetItem.findUniqueOrThrow({ where: { id: left.id } }),
      prisma.budgetItem.findUniqueOrThrow({ where: { id: right.id } }),
    ]);
    expect(afterLeft.parentId).toBe(right.id);
    expect(afterRight.parentId).toBe(pendingItemId);
    expect(afterLeft.version + afterRight.version).toBe(1);

    await prisma.$transaction([
      prisma.budgetItem.update({
        where: { id: left.id },
        data: { parentId: pendingItemId, version: 0 },
      }),
      prisma.budgetItem.update({
        where: { id: right.id },
        data: { parentId: pendingItemId, version: 0 },
      }),
    ]);

    const reverseBarrier = await holdBudgetItemRowLock(right.id);
    const reverseRaceActions: Promise<unknown>[] = [];
    let interactiveFirst: ReturnType<typeof moveBudgetItemAction> | undefined;
    let operatorSecond:
      | ReturnType<typeof reorganizeBudgetHierarchy>
      | undefined;
    try {
      interactiveFirst = moveBudgetItemAction(
        workspace.id,
        right.id,
        idleState,
        moveForm(0, left.id),
      );
      reverseRaceActions.push(interactiveFirst);
      const interactivePid = await waitForBlockingChain(
        reverseBarrier.pid,
        "row",
      );

      operatorSecond = reorganizeBudgetHierarchy({
        client: prisma,
        workspaceId: workspace.id,
        actorUserId: user.id,
        plan,
        apply: true,
      });
      reverseRaceActions.push(operatorSecond);
      await waitForBlockingChain(interactivePid, "advisory");

      reverseBarrier.release();
      await reverseBarrier.completion;
    } finally {
      reverseBarrier.release();
      await Promise.allSettled([
        reverseBarrier.completion,
        ...reverseRaceActions,
      ]);
    }
    if (!interactiveFirst || !operatorSecond) {
      throw new Error("The interactive-first hierarchy race did not start.");
    }

    await expect(interactiveFirst).resolves.toMatchObject({ status: "success" });
    await expect(operatorSecond).rejects.toMatchObject({
      name: "BudgetHierarchyConflictError",
    });

    const [reverseLeft, reverseRight] = await Promise.all([
      prisma.budgetItem.findUniqueOrThrow({ where: { id: left.id } }),
      prisma.budgetItem.findUniqueOrThrow({ where: { id: right.id } }),
    ]);
    expect(reverseLeft.parentId).toBe(pendingItemId);
    expect(reverseRight.parentId).toBe(left.id);
    expect(reverseLeft.version + reverseRight.version).toBe(1);
  });

  it("rejects an invariant-breaking direct SQL insert", async () => {
    const { workspace } = await createOwnerWorkspace();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "budget_items" (
          "id", "workspace_id", "name", "category", "planned_amount",
          "paid", "updated_at"
        ) VALUES (
          ${`budget-direct-${sequence}`}, ${workspace.id}, ${"直接 SQL"},
          ${"測試"}, ${100}, ${true}, CURRENT_TIMESTAMP
        )
      `,
    ).rejects.toBeDefined();
    expect(
      await prisma.budgetItem.count({
        where: {
          workspaceId: workspace.id,
          systemTaxonomyKey: null,
        },
      }),
    ).toBe(0);
  });

  it("creates through the authenticated action with server-owned payment fields", async () => {
    const { workspace } = await createOwnerWorkspace();

    await expect(
      createBudgetItemAction(
        workspace.id,
        idleState,
        detailsForm({
          name: "拍攝禮服加購",
          category: "ATTIRE_STYLING",
          taxonomyItemKey: "ITEM_ATTIRE_RENTAL",
          relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        }),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.findFirstOrThrow({
        where: {
          workspaceId: workspace.id,
          name: "拍攝禮服加購",
          kind: "EXPENSE",
        },
        include: { parent: { select: { systemTaxonomyKey: true } } },
      }),
    ).toMatchObject({
      category: "ATTIRE_STYLING",
      relatedTaxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      parent: { systemTaxonomyKey: "ITEM_ATTIRE_RENTAL" },
      paid: false,
      paidAt: null,
      version: 0,
    });
  });

  it("adds selected engagement suggestions under fixed parents without duplicate rows", async () => {
    const { workspace } = await createOwnerWorkspace();
    const keys = [
      "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
      "ENGAGEMENT_BRIDE_ACCEPTANCE_GIFT",
    ];

    const results = await Promise.all([
      addBudgetEngagementSuggestionsAction(
        workspace.id,
        idleState,
        engagementSuggestionForm(...keys),
      ),
      addBudgetEngagementSuggestionsAction(
        workspace.id,
        idleState,
        engagementSuggestionForm(...keys),
      ),
    ]);
    expect(results.every((state) => state.status === "success")).toBe(true);

    const suggestions = await prisma.budgetItem.findMany({
      where: {
        workspaceId: workspace.id,
        suggestionKey: { not: null },
      },
      orderBy: { suggestionKey: "asc" },
      include: { parent: { select: { systemTaxonomyKey: true } } },
    });
    expect(suggestions).toHaveLength(2);
    expect(suggestions).toMatchObject([
      {
        suggestionKey: "ENGAGEMENT_BRIDE_ACCEPTANCE_GIFT",
        name: "接聘禮",
        parent: { systemTaxonomyKey: "ITEM_ENGAGEMENT_BRIDE" },
      },
      {
        suggestionKey: "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
        name: "大聘",
        parent: { systemTaxonomyKey: "ITEM_ENGAGEMENT_GROOM" },
      },
    ]);
    expect(
      suggestions.every(
        (item) =>
          item.source === "MANUAL" &&
          item.kind === "EXPENSE" &&
          item.category === "DECOR_GIFTS" &&
          item.plannedAmount === 0 &&
          item.actualAmount === null &&
          item.bookingStatus === "PLANNING",
      ),
    ).toBe(true);

    await expect(
      addBudgetEngagementSuggestionsAction(
        workspace.id,
        idleState,
        engagementSuggestionForm(...keys),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.count({
        where: { workspaceId: workspace.id, suggestionKey: { not: null } },
      }),
    ).toBe(2);
  });

  it("adds common wedding suggestions under fixed parents without duplicate rows", async () => {
    const { workspace } = await createOwnerWorkspace();
    const keys = [
      "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_RETOUCHING",
      "PREPARATION_WEDDING_SHOES_BRIDE",
    ];

    const results = await Promise.all([
      addBudgetPreparationSuggestionsAction(
        workspace.id,
        idleState,
        engagementSuggestionForm(...keys),
      ),
      addBudgetPreparationSuggestionsAction(
        workspace.id,
        idleState,
        engagementSuggestionForm(...keys),
      ),
    ]);
    expect(results.every((state) => state.status === "success")).toBe(true);

    const suggestions = await prisma.budgetItem.findMany({
      where: {
        workspaceId: workspace.id,
        suggestionKey: { startsWith: "PREPARATION_" },
      },
      orderBy: { suggestionKey: "asc" },
      include: { parent: { select: { systemTaxonomyKey: true } } },
    });
    expect(suggestions).toHaveLength(2);
    expect(suggestions).toMatchObject([
      {
        suggestionKey:
          "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_RETOUCHING",
        name: "精修",
        category: "PHOTOGRAPHY_VIDEO",
        parent: { systemTaxonomyKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY" },
      },
      {
        suggestionKey: "PREPARATION_WEDDING_SHOES_BRIDE",
        name: "新娘婚鞋",
        category: "ATTIRE_STYLING",
        parent: { systemTaxonomyKey: "ITEM_WEDDING_SHOES" },
      },
    ]);
    expect(
      suggestions.every(
        (item) =>
          item.source === "MANUAL" &&
          item.kind === "EXPENSE" &&
          item.plannedAmount === 0 &&
          item.actualAmount === null &&
          item.bookingStatus === "PLANNING" &&
          item.systemTaxonomyKey === null,
      ),
    ).toBe(true);

    await expect(
      addBudgetPreparationSuggestionsAction(
        workspace.id,
        idleState,
        engagementSuggestionForm(...keys),
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(
      await prisma.budgetItem.count({
        where: {
          workspaceId: workspace.id,
          suggestionKey: { startsWith: "PREPARATION_" },
        },
      }),
    ).toBe(2);
  });

  it("rejects a suggestion identity on a non-expense row", async () => {
    const { workspace } = await createOwnerWorkspace();
    const groomParent = await prisma.budgetItem.findFirstOrThrow({
      where: {
        workspaceId: workspace.id,
        systemTaxonomyKey: "ITEM_ENGAGEMENT_GROOM",
      },
      select: { id: true },
    });

    await expect(
      prisma.budgetItem.create({
        data: {
          workspaceId: workspace.id,
          parentId: groomParent.id,
          source: "MANUAL",
          name: "錯誤文定群組",
          kind: "GROUP",
          category: null,
          plannedAmount: 0,
          suggestionKey: "ENGAGEMENT_GROOM_INVALID_GROUP",
        },
      }),
    ).rejects.toBeDefined();
    expect(
      await prisma.budgetItem.count({
        where: { workspaceId: workspace.id, suggestionKey: { not: null } },
      }),
    ).toBe(0);
  });

  it("reorganizes a hierarchy atomically and reruns without another version bump", async () => {
    const { user, workspace } = await createOwnerWorkspace();
    const pendingItemId = await internalTaxonomyItemId(workspace.id);
    const pendingPath = taxonomyPlanPath(BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY);
    const pendingRef = taxonomyPlanReference(
      BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
    );
    const [candidateGroup, child] = await Promise.all([
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "舊儀式",
          category: "OTHER_PENDING",
          plannedAmount: 0,
        },
      }),
      createBudgetItem({
        data: {
          workspaceId: workspace.id,
          name: "舊攝影",
          category: "OTHER_PENDING",
          plannedAmount: 88_000,
        },
      }),
    ]);
    const beforeRows = await prisma.budgetItem.findMany({
      where: { workspaceId: workspace.id },
    });
    const virtualGroupId = "virtual-group";
    const finalRows = [
      ...beforeRows.filter(
        (row) => row.id !== candidateGroup.id && row.id !== child.id,
      ),
      {
        ...candidateGroup,
        id: virtualGroupId,
        parentId: pendingItemId,
        name: "婚宴工作包",
        kind: "GROUP" as const,
        category: null,
      },
      {
        ...candidateGroup,
        parentId: virtualGroupId,
        name: "儀式",
        kind: "GROUP" as const,
        category: null,
      },
      {
        ...child,
        parentId: candidateGroup.id,
        name: "攝影",
      },
    ];
    const plan = parseBudgetHierarchyPlanJson(
      JSON.stringify({
        version: 1,
        expected: {
          before: computeBudgetHierarchyProjection(beforeRows),
          final: computeBudgetHierarchyProjection(finalRows),
        },
        groups: [
          {
            ref: "group:package",
            name: "婚宴工作包",
            parentRef: pendingRef,
            finalPath: [...pendingPath, "婚宴工作包"],
          },
        ],
        items: [
          ...fixedTaxonomyPlanItems(),
          {
            ref: "item:ceremony",
            beforePath: [...pendingPath, "舊儀式"],
            finalPath: [...pendingPath, "婚宴工作包", "儀式"],
            finalKind: "GROUP",
            finalCategory: null,
            finalName: "儀式",
            parentRef: "group:package",
          },
          {
            ref: "item:camera",
            beforePath: [...pendingPath, "舊攝影"],
            finalPath: [...pendingPath, "婚宴工作包", "儀式", "攝影"],
            finalKind: "EXPENSE",
            finalCategory: "OTHER_PENDING",
            finalName: "攝影",
            parentRef: "item:ceremony",
          },
        ],
      }),
    );

    await expect(
      reorganizeBudgetHierarchy({
        client: prisma,
        workspaceId: workspace.id,
        actorUserId: user.id,
        plan,
        apply: false,
      }),
    ).resolves.toMatchObject({ mode: "dry-run", applied: false, create: 1, update: 2 });
    expect(
      await prisma.budgetItem.count({
        where: { workspaceId: workspace.id, systemTaxonomyKey: null },
      }),
    ).toBe(2);

    await expect(
      reorganizeBudgetHierarchy({
        client: prisma,
        workspaceId: workspace.id,
        actorUserId: user.id,
        plan,
        apply: true,
      }),
    ).resolves.toMatchObject({ mode: "apply", applied: true, create: 1, update: 2 });
    const afterFirstApply = await prisma.budgetItem.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
    });
    expect(computeBudgetHierarchyProjection(afterFirstApply)).toEqual(
      plan.expected.final,
    );
    expect(
      afterFirstApply
        .filter((item) => item.id === candidateGroup.id || item.id === child.id)
        .map((item) => item.version),
    ).toEqual([1, 1]);

    await expect(
      reorganizeBudgetHierarchy({
        client: prisma,
        workspaceId: workspace.id,
        actorUserId: user.id,
        plan,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 0, update: 0, unchanged: 31 });
    const afterRerun = await prisma.budgetItem.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
    });
    expect(afterRerun.map((item) => item.version)).toEqual(
      afterFirstApply.map((item) => item.version),
    );
  });
});
