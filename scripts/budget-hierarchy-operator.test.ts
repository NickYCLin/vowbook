import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BUDGET_SYSTEM_NODES,
  type BudgetSystemNodeKey,
} from "../src/domain/budget-item";
import {
  BudgetHierarchyConflictError,
  BudgetHierarchyValidationError,
  computeBudgetHierarchyProjection,
  formatBudgetHierarchySummary,
  parseBudgetHierarchyCliArguments,
  parseBudgetHierarchyPlanJson,
  reorganizeBudgetHierarchy,
  runBudgetHierarchyCli,
  type BudgetHierarchyPlan,
} from "./budget-hierarchy-operator.mjs";

type StoredRow = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  systemTaxonomyKey: string | null;
  sourceOrder: number | null;
  name: string;
  kind: "GROUP" | "EXPENSE";
  category:
    | "RINGS_KEEPSAKES"
    | "PHOTOGRAPHY_VIDEO"
    | "ATTIRE_STYLING"
    | "VENUE_CATERING"
    | "TRANSPORT_LODGING"
    | "DECOR_GIFTS"
    | "PEOPLE_SERVICES"
    | "OTHER_PENDING"
    | null;
  plannedAmount: number;
  actualAmount: number | null;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  paidAt: Date | null;
  dueDate: Date | null;
  bookingStatus: "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID";
  paid: boolean;
  estimatedRange: string | null;
  candidateVendors: string | null;
  confirmedVendor: string | null;
  vendorContact: string | null;
  primaryContact: "PARTNER_A" | "PARTNER_B" | null;
  notes: string | null;
  version: number;
};

const workspaceId = "synthetic_workspace";
const actorUserId = "synthetic_editor";

function taxonomyRowId(key: BudgetSystemNodeKey): string {
  return `taxonomy_${key}`;
}

function taxonomyReference(key: BudgetSystemNodeKey): string {
  return `taxonomy:${key}`;
}

function taxonomyPath(key: BudgetSystemNodeKey): string[] {
  const node = BUDGET_SYSTEM_NODES.find((candidate) => candidate.key === key);
  if (!node) throw new Error(`Unknown taxonomy key ${key}.`);
  return node.parentKey === null
    ? [node.label]
    : [...taxonomyPath(node.parentKey), node.label];
}

function fixedTaxonomyRows(): StoredRow[] {
  return BUDGET_SYSTEM_NODES.map((node) => ({
    id: taxonomyRowId(node.key),
    workspaceId,
    parentId:
      node.parentKey === null ? null : taxonomyRowId(node.parentKey),
    systemTaxonomyKey: node.key,
    sourceOrder: node.sourceOrder,
    name: node.label,
    kind: "GROUP",
    category: null,
    plannedAmount: 0,
    actualAmount: null,
    depositAmount: null,
    balanceAmount: null,
    additionalAmount: null,
    paidAt: null,
    dueDate: null,
    bookingStatus: "PLANNING",
    paid: false,
    estimatedRange: null,
    candidateVendors: null,
    confirmedVendor: null,
    vendorContact: null,
    primaryContact: null,
    notes: null,
    version: 0,
  }));
}

function fixedTaxonomyPlanItems() {
  return BUDGET_SYSTEM_NODES.map((node) => ({
    ref: taxonomyReference(node.key),
    beforePath: taxonomyPath(node.key),
    finalPath: taxonomyPath(node.key),
    finalKind: "GROUP",
    finalCategory: null,
    finalName: node.label,
    parentRef:
      node.parentKey === null ? null : taxonomyReference(node.parentKey),
  }));
}

function expense(
  id: string,
  name: string,
  category: NonNullable<StoredRow["category"]>,
  overrides: Partial<StoredRow> = {},
): StoredRow {
  return {
    id,
    workspaceId,
    parentId: taxonomyRowId("INTERNAL_UNCLASSIFIED_ITEM"),
    systemTaxonomyKey: null,
    sourceOrder: null,
    name,
    kind: "EXPENSE",
    category,
    plannedAmount: 0,
    actualAmount: null,
    depositAmount: null,
    balanceAmount: null,
    additionalAmount: null,
    paidAt: null,
    dueDate: null,
    bookingStatus: "PLANNING",
    paid: false,
    estimatedRange: null,
    candidateVendors: null,
    confirmedVendor: null,
    vendorContact: null,
    primaryContact: null,
    notes: null,
    version: 4,
    ...overrides,
  };
}

function initialRows(): StoredRow[] {
  return [
    ...fixedTaxonomyRows(),
    expense("row_a", "舊儀式", "OTHER_PENDING"),
    expense("row_b", "舊攝影", "OTHER_PENDING", {
      plannedAmount: 88_000,
    }),
  ];
}

function finalRows(): StoredRow[] {
  return [
    ...fixedTaxonomyRows(),
    {
      ...expense("group_new", "婚宴工作包", "OTHER_PENDING"),
      kind: "GROUP",
      category: null,
    },
    {
      ...expense("row_a", "儀式", "OTHER_PENDING"),
      parentId: "group_new",
      kind: "GROUP",
      category: null,
    },
    expense("row_b", "攝影", "OTHER_PENDING", {
      parentId: "row_a",
      plannedAmount: 88_000,
    }),
  ];
}

function validPlan(): BudgetHierarchyPlan {
  return parseBudgetHierarchyPlanJson(
    JSON.stringify({
      version: 1,
      expected: {
        before: computeBudgetHierarchyProjection(initialRows()),
        final: computeBudgetHierarchyProjection(finalRows()),
      },
      groups: [
        {
          ref: "group:package",
          name: "婚宴工作包",
          parentRef: taxonomyReference("INTERNAL_UNCLASSIFIED_ITEM"),
          finalPath: [...taxonomyPath("INTERNAL_UNCLASSIFIED_ITEM"), "婚宴工作包"],
        },
      ],
      items: [
        ...fixedTaxonomyPlanItems(),
        {
          ref: "item:ceremony",
          beforePath: [...taxonomyPath("INTERNAL_UNCLASSIFIED_ITEM"), "舊儀式"],
          finalPath: [
            ...taxonomyPath("INTERNAL_UNCLASSIFIED_ITEM"),
            "婚宴工作包",
            "儀式",
          ],
          finalKind: "GROUP",
          finalCategory: null,
          finalName: "儀式",
          parentRef: "group:package",
        },
        {
          ref: "item:camera",
          beforePath: [...taxonomyPath("INTERNAL_UNCLASSIFIED_ITEM"), "舊攝影"],
          finalPath: [
            ...taxonomyPath("INTERNAL_UNCLASSIFIED_ITEM"),
            "婚宴工作包",
            "儀式",
            "攝影",
          ],
          finalKind: "EXPENSE",
          finalCategory: "OTHER_PENDING",
          finalName: "攝影",
          parentRef: "item:ceremony",
        },
      ],
    }),
  );
}

function cloneRows(rows: StoredRow[]): StoredRow[] {
  return rows.map((row) => ({ ...row }));
}

function fakeClient(
  sourceRows = initialRows(),
  {
    workspaceExists = true,
    failUpdate = false,
    membershipRole = "OWNER",
  }: {
    workspaceExists?: boolean;
    failUpdate?: boolean;
    membershipRole?: "OWNER" | "PARTNER" | "PLANNER" | "VIEWER" | null;
  } = {},
) {
  const store = { rows: cloneRows(sourceRows) };
  const executeRaw = vi.fn<(query: unknown) => Promise<number>>();
  executeRaw.mockResolvedValue(1);
  let groupSequence = 0;
  let updateCalls = 0;

  function transactionFor(pending: StoredRow[]) {
    return {
      $executeRaw: executeRaw,
      membership: {
        findUnique: vi.fn(async ({ where }) =>
          membershipRole &&
          where.workspaceId_userId?.workspaceId === workspaceId &&
          where.workspaceId_userId?.userId === actorUserId
            ? { role: membershipRole }
            : null,
        ),
      },
      weddingWorkspace: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            workspaceExists && where.id === workspaceId
              ? { id: workspaceId }
              : null,
        ),
      },
      budgetItem: {
        findMany: vi.fn(
          async ({ where }: { where: { workspaceId: string } }) =>
            pending.filter((row) => row.workspaceId === where.workspaceId),
        ),
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => {
            const row: StoredRow = {
              id: `created_group_${++groupSequence}`,
              workspaceId: String(data.workspaceId),
              parentId: (data.parentId as string | null) ?? null,
              systemTaxonomyKey: null,
              sourceOrder: null,
              name: String(data.name),
              kind: "GROUP",
              category: null,
              plannedAmount: 0,
              actualAmount: null,
              depositAmount: null,
              balanceAmount: null,
              additionalAmount: null,
              paidAt: null,
              dueDate: null,
              bookingStatus: "PLANNING",
              paid: false,
              estimatedRange: null,
              candidateVendors: null,
              confirmedVendor: null,
              vendorContact: null,
              primaryContact: null,
              notes: null,
              version: 0,
            };
            pending.push(row);
            return row;
          },
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; workspaceId: string; version: number };
            data: {
              name: string;
              parentId: string | null;
              kind: StoredRow["kind"];
              category: StoredRow["category"];
              version: { increment: number };
            };
          }) => {
            updateCalls += 1;
            if (failUpdate && updateCalls === 2) {
              throw new Error("synthetic database detail");
            }
            const row = pending.find(
              (candidate) =>
                candidate.id === where.id &&
                candidate.workspaceId === where.workspaceId &&
                candidate.version === where.version,
            );
            if (!row) return { count: 0 };
            Object.assign(row, {
              name: data.name,
              parentId: data.parentId,
              kind: data.kind,
              category: data.category,
              version: row.version + data.version.increment,
            });
            return { count: 1 };
          },
        ),
      },
    };
  }

  const client = {
    $transaction: vi.fn(
      async (
        callback: (transaction: ReturnType<typeof transactionFor>) => Promise<unknown>,
      ) => {
        const pending = cloneRows(store.rows);
        const result = await callback(transactionFor(pending));
        store.rows = pending;
        return result;
      },
    ),
    $disconnect: vi.fn(async () => undefined),
  };
  return { client, executeRaw, store };
}

describe("budget hierarchy generic operator", () => {
  it("defaults to dry-run and makes zero writes", async () => {
    const { client, store } = fakeClient();
    const before = cloneRows(store.rows);

    const summary = await reorganizeBudgetHierarchy({
      client,
      workspaceId,
      actorUserId,
      plan: validPlan(),
      apply: false,
    });

    expect(summary).toMatchObject({
      mode: "dry-run",
      applied: false,
      create: 1,
      update: 2,
      unchanged: 28,
      conflict: 0,
      roots: 7,
      maxDepth: 5,
      projectionHashMatches: true,
    });
    expect(store.rows).toEqual(before);
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("takes the shared workspace hierarchy lock inside the serializable transaction", async () => {
    const { client, executeRaw } = fakeClient();

    await reorganizeBudgetHierarchy({
      client,
      workspaceId,
      actorUserId,
      plan: validPlan(),
      apply: false,
    });

    expect(executeRaw).toHaveBeenCalledOnce();
    const lock = executeRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(lock.strings.join(" ")).toContain(
      "pg_advisory_xact_lock(hashtextextended(",
    );
    expect(lock.values).toEqual([workspaceId]);
  });

  it("applies creates and changed fields atomically with one version bump", async () => {
    const { client, store } = fakeClient();

    const summary = await reorganizeBudgetHierarchy({
      client,
      workspaceId,
      actorUserId,
      plan: validPlan(),
      apply: true,
    });

    expect(summary).toMatchObject({ mode: "apply", applied: true, create: 1, update: 2 });
    expect(computeBudgetHierarchyProjection(store.rows)).toEqual(
      validPlan().expected.final,
    );
    expect(store.rows.find((row) => row.id === "row_a")?.version).toBe(5);
    expect(store.rows.find((row) => row.id === "row_b")?.version).toBe(5);
  });

  it("is idempotent when the complete final state already exists", async () => {
    const { client, store } = fakeClient();
    const plan = validPlan();
    await reorganizeBudgetHierarchy({ client, workspaceId, actorUserId, plan, apply: true });
    const afterFirstRun = cloneRows(store.rows);

    const rerun = await reorganizeBudgetHierarchy({
      client,
      workspaceId,
      actorUserId,
      plan,
      apply: true,
    });

    expect(rerun).toMatchObject({ create: 0, update: 0, unchanged: 31 });
    expect(store.rows).toEqual(afterFirstRun);
  });

  it("requires matching dual workspace and actor confirmation and rejects repo-local plans", async () => {
    expect(() =>
      parseBudgetHierarchyCliArguments([
        "--workspace-id",
        "workspace_a",
        "--confirm-workspace-id",
        "workspace_b",
        "--actor-user-id",
        actorUserId,
        "--confirm-actor-user-id",
        actorUserId,
        "--plan",
        "/tmp/synthetic-plan.json",
      ]),
    ).toThrow("兩次指定的婚宴工作區不一致");

    expect(() =>
      parseBudgetHierarchyCliArguments([
        "--workspace-id",
        workspaceId,
        "--confirm-workspace-id",
        workspaceId,
        "--actor-user-id",
        "editor_a",
        "--confirm-actor-user-id",
        "editor_b",
        "--plan",
        "/tmp/synthetic-plan.json",
      ]),
    ).toThrow("兩次指定的操作者不一致");

    const writeError = vi.fn();
    const exitCode = await runBudgetHierarchyCli(
      [
        "--workspace-id",
        workspaceId,
        "--confirm-workspace-id",
        workspaceId,
        "--actor-user-id",
        actorUserId,
        "--confirm-actor-user-id",
        actorUserId,
        "--plan",
        path.join(process.cwd(), "synthetic-plan.json"),
      ],
      {
        databaseUrl: "postgresql://localhost/synthetic",
        repositoryRoot: process.cwd(),
        resolveRealPath: async (value: string) => path.resolve(value),
        readCheckedFile: vi.fn(),
        createClient: vi.fn(),
        writeOutput: vi.fn(),
        writeError,
      },
    );

    expect(exitCode).toBe(1);
    expect(writeError).toHaveBeenCalledWith(
      "重整計畫必須位於 repository 外。",
    );
  });

  it.each([null, "VIEWER" as const])(
    "rejects a missing or read-only membership (%s) with zero writes",
    async (membershipRole) => {
      const { client, store } = fakeClient(initialRows(), { membershipRole });
      const before = cloneRows(store.rows);

      await expect(
        reorganizeBudgetHierarchy({
          client,
          workspaceId,
          actorUserId,
          plan: validPlan(),
          apply: true,
        }),
      ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);
      expect(store.rows).toEqual(before);
    },
  );

  it("rejects converting preserved metadata into a group", async () => {
    const rows = initialRows();
    const ceremony = rows.find((row) => row.id === "row_a");
    if (!ceremony) throw new Error("Missing synthetic ceremony row.");
    ceremony.notes = "合成備註不可被群組UI隱藏";
    const { client, store } = fakeClient(rows);
    const before = cloneRows(store.rows);

    await expect(
      reorganizeBudgetHierarchy({
        client,
        workspaceId,
        actorUserId,
        plan: validPlan(),
        apply: true,
      }),
    ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);
    expect(store.rows).toEqual(before);
  });

  it("rejects any fixed taxonomy mutation and leaves every row unchanged", async () => {
    const plan = structuredClone(validPlan());
    const pending = plan.items.find(
      (item) =>
        item.ref === taxonomyReference("INTERNAL_UNCLASSIFIED_ITEM"),
    );
    if (!pending) throw new Error("Missing internal item plan entry.");
    pending.finalName = "竄改的待分類";
    const { client, store } = fakeClient();
    const before = cloneRows(store.rows);

    await expect(
      reorganizeBudgetHierarchy({
        client,
        workspaceId,
        actorUserId,
        plan,
        apply: true,
      }),
    ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);
    expect(store.rows).toEqual(before);
  });

  it.each(["name", "topology", "source-order"] as const)(
    "fails closed when stored fixed taxonomy %s is invalid",
    async (tamper) => {
      const rows = initialRows();
      const pending = rows.find(
        (row) => row.systemTaxonomyKey === "INTERNAL_UNCLASSIFIED_ITEM",
      );
      if (!pending) throw new Error("Missing internal item row.");
      if (tamper === "name") pending.name = "被竄改的名稱";
      if (tamper === "topology") {
        pending.parentId = taxonomyRowId("STAGE_PREPARATION_1_2_MONTHS");
      }
      if (tamper === "source-order") pending.sourceOrder = 99;
      const { client, store } = fakeClient(rows);
      const before = cloneRows(store.rows);

      await expect(
        reorganizeBudgetHierarchy({
          client,
          workspaceId,
          actorUserId,
          plan: validPlan(),
          apply: true,
        }),
      ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);
      expect(store.rows).toEqual(before);
    },
  );

  it("rejects ordinary final nodes without exactly one ITEM taxonomy ancestor", async () => {
    const plan = structuredClone(validPlan());
    const ceremony = plan.items.find((item) => item.ref === "item:ceremony");
    if (!ceremony) throw new Error("Missing ceremony plan entry.");
    ceremony.parentRef = taxonomyReference("INTERNAL_UNCLASSIFIED_STAGE");
    ceremony.finalPath = [
      ...taxonomyPath("INTERNAL_UNCLASSIFIED_STAGE"),
      "儀式",
    ];
    const { client, store } = fakeClient();
    const before = cloneRows(store.rows);

    await expect(
      reorganizeBudgetHierarchy({
        client,
        workspaceId,
        actorUserId,
        plan,
        apply: true,
      }),
    ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);
    expect(store.rows).toEqual(before);
  });

  it("preserves a legal legacy category under the internal item", async () => {
    const plan = structuredClone(validPlan());
    const camera = plan.items.find((item) => item.ref === "item:camera");
    if (!camera) throw new Error("Missing camera plan entry.");
    camera.finalCategory = "PHOTOGRAPHY_VIDEO";
    const desiredRows = finalRows();
    const desiredCamera = desiredRows.find((row) => row.id === "row_b");
    if (!desiredCamera) throw new Error("Missing desired camera row.");
    desiredCamera.category = "PHOTOGRAPHY_VIDEO";
    plan.expected.final = computeBudgetHierarchyProjection(desiredRows);
    const { client, store } = fakeClient();

    await expect(
      reorganizeBudgetHierarchy({
        client,
        workspaceId,
        actorUserId,
        plan,
        apply: true,
      }),
    ).resolves.toMatchObject({ applied: true, create: 1, update: 2 });
    expect(store.rows.find((row) => row.id === "row_b")?.category).toBe(
      "PHOTOGRAPHY_VIDEO",
    );
  });

  it("rejects an expense category that disagrees with a non-pending ITEM taxonomy", async () => {
    const plan = structuredClone(validPlan());
    const group = plan.groups.find((entry) => entry.ref === "group:package");
    const ceremony = plan.items.find((item) => item.ref === "item:ceremony");
    const camera = plan.items.find((item) => item.ref === "item:camera");
    if (!group || !ceremony || !camera) {
      throw new Error("Missing synthetic hierarchy plan entries.");
    }
    const venuePath = taxonomyPath("ITEM_WEDDING_VENUE");
    group.parentRef = taxonomyReference("ITEM_WEDDING_VENUE");
    group.finalPath = [...venuePath, "婚宴工作包"];
    ceremony.finalPath = [...venuePath, "婚宴工作包", "儀式"];
    camera.finalPath = [...venuePath, "婚宴工作包", "儀式", "攝影"];
    camera.finalCategory = "PHOTOGRAPHY_VIDEO";
    const { client, store } = fakeClient();
    const before = cloneRows(store.rows);

    await expect(
      reorganizeBudgetHierarchy({
        client,
        workspaceId,
        actorUserId,
        plan,
        apply: true,
      }),
    ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);
    expect(store.rows).toEqual(before);
  });

  it("rejects a new ordinary root group during plan parsing", () => {
    const raw = JSON.parse(JSON.stringify(validPlan())) as {
      groups: Array<Record<string, unknown>>;
    };
    raw.groups[0].parentRef = null;
    raw.groups[0].finalPath = ["婚宴工作包"];

    expect(() => parseBudgetHierarchyPlanJson(JSON.stringify(raw))).toThrow(
      BudgetHierarchyValidationError,
    );
  });

  it.each([
    ["baseline mismatch", (plan: BudgetHierarchyPlan) => {
      plan.expected.before.projectionSha256 = "0".repeat(64);
    }],
    ["partial state", (_plan: BudgetHierarchyPlan, rows: StoredRow[]) => {
      const ceremony = rows.find((row) => row.id === "row_a");
      if (!ceremony) throw new Error("Missing synthetic ceremony row.");
      ceremony.name = "只改了一半";
    }],
  ])("rejects %s with zero writes", async (_name, mutate) => {
    const plan = structuredClone(validPlan());
    const rows = initialRows();
    mutate(plan, rows);
    const { client, store } = fakeClient(rows);
    const before = cloneRows(store.rows);

    await expect(
      reorganizeBudgetHierarchy({ client, workspaceId, actorUserId, plan, apply: true }),
    ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);
    expect(store.rows).toEqual(before);
  });

  it("rejects ambiguous current paths and cross-workspace parents", async () => {
    const ambiguousRows = [
      ...fixedTaxonomyRows(),
      expense("ambiguous_a", "重複", "OTHER_PENDING"),
      expense("ambiguous_b", "重複", "OTHER_PENDING"),
    ];
    const ambiguous = fakeClient(ambiguousRows);
    await expect(
      reorganizeBudgetHierarchy({
        client: ambiguous.client,
        workspaceId,
        actorUserId,
        plan: validPlan(),
        apply: true,
      }),
    ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);

    const crossWorkspace = fakeClient([
      ...fixedTaxonomyRows(),
      expense("row_a", "舊儀式", "OTHER_PENDING", {
        parentId: "foreign_parent",
      }),
      expense("row_b", "舊攝影", "OTHER_PENDING", {
        plannedAmount: 88_000,
      }),
      expense("foreign_parent", "外部父項", "OTHER_PENDING", {
        workspaceId: "other_workspace",
      }),
    ]);
    await expect(
      reorganizeBudgetHierarchy({
        client: crossWorkspace.client,
        workspaceId,
        actorUserId,
        plan: validPlan(),
        apply: true,
      }),
    ).rejects.toBeInstanceOf(BudgetHierarchyConflictError);
  });

  it("rejects a final cycle before opening a transaction", () => {
    const raw = JSON.parse(JSON.stringify(validPlan())) as Record<string, unknown>;
    const items = raw.items as Array<Record<string, unknown>>;
    const ceremony = items.find((item) => item.ref === "item:ceremony");
    const camera = items.find((item) => item.ref === "item:camera");
    if (!ceremony || !camera) throw new Error("Missing synthetic plan items.");
    ceremony.parentRef = "item:camera";
    ceremony.finalPath = [
      ...taxonomyPath("INTERNAL_UNCLASSIFIED_ITEM"),
      "攝影",
      "儀式",
    ];
    camera.parentRef = "item:ceremony";
    camera.finalPath = [
      ...taxonomyPath("INTERNAL_UNCLASSIFIED_ITEM"),
      "儀式",
      "攝影",
    ];

    expect(() => parseBudgetHierarchyPlanJson(JSON.stringify(raw))).toThrow(
      BudgetHierarchyValidationError,
    );
  });

  it("rolls back all writes if any mutation fails", async () => {
    const { client, store } = fakeClient(initialRows(), { failUpdate: true });
    const before = cloneRows(store.rows);

    await expect(
      reorganizeBudgetHierarchy({
        client,
        workspaceId,
        actorUserId,
        plan: validPlan(),
        apply: true,
      }),
    ).rejects.toThrow();
    expect(store.rows).toEqual(before);
  });

  it("formats aggregate-only summaries without identifiers, names, or paths", () => {
    const output = formatBudgetHierarchySummary({
      mode: "dry-run",
      applied: false,
      create: 1,
      update: 2,
      unchanged: 0,
      conflict: 0,
      roots: 1,
      maxDepth: 3,
      categoryCounts: { PHOTOGRAPHY_VIDEO: 1 },
      projectionHashMatches: true,
    });

    expect(JSON.parse(output)).toEqual({
      mode: "dry-run",
      applied: false,
      create: 1,
      update: 2,
      unchanged: 0,
      conflict: 0,
      roots: 1,
      maxDepth: 3,
      categoryCounts: { PHOTOGRAPHY_VIDEO: 1 },
      projectionHashMatches: true,
    });
    expect(output).not.toContain(workspaceId);
    expect(output).not.toContain("row_a");
    expect(output).not.toContain("婚宴工作包");
    expect(output).not.toContain("/");
  });
});
