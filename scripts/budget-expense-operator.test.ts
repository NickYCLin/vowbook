import { describe, expect, it, vi } from "vitest";
import {
  appendBudgetExpenses,
  BudgetExpenseConflictError,
  BudgetExpenseValidationError,
  formatBudgetExpenseSummary,
  parseBudgetExpenseCliArguments,
  parseBudgetExpensePlanJson,
  runBudgetExpenseCli,
  type BudgetExpensePlan,
} from "./budget-expense-operator.mjs";

const workspaceId = "synthetic_workspace";
const actorUserId = "synthetic_editor";

function planJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    expenses: [
      {
        name: "合成項目",
        category: "DECOR_GIFTS",
        bookingStatus: "BOOKED_BALANCE_DUE",
        depositAmount: 2000,
        balanceAmount: 5100,
        ...overrides,
      },
    ],
  });
}

function fakeClient(options: {
  role?: string | null;
  workspaceExists?: boolean;
  existingNames?: string[];
}) {
  const created: Array<Record<string, unknown>> = [];
  const client = {
    created,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        membership: {
          findUnique: async () =>
            options.role === null || options.role === undefined
              ? null
              : { role: options.role },
        },
        weddingWorkspace: {
          findUnique: async () =>
            options.workspaceExists === false ? null : { id: workspaceId },
        },
        budgetItem: {
          findMany: async () =>
            (options.existingNames ?? []).map((name) => ({ name })),
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return data;
          },
        },
      }),
    $disconnect: async () => undefined,
  };
  return client;
}

describe("budget expense operator", () => {
  it("derives planned and actual amounts the same way the website form does", () => {
    const plan = parseBudgetExpensePlanJson(planJson());
    expect(plan.expenses[0]).toMatchObject({
      plannedAmount: 7100,
      actualAmount: 2000,
      paid: false,
    });
  });

  it("counts additional charges into the planned total and the pending balance", async () => {
    const plan = parseBudgetExpensePlanJson(planJson({ additionalAmount: 900 }));
    expect(plan.expenses[0].plannedAmount).toBe(8000);
    const summary = await appendBudgetExpenses({
      client: fakeClient({ role: "OWNER" }),
      workspaceId,
      actorUserId,
      plan: plan as BudgetExpensePlan,
    });
    expect(summary).toMatchObject({ plannedTotal: 8000, balanceDueTotal: 6000 });
  });

  it("rejects plans without any amount component or with unknown fields", () => {
    expect(() =>
      parseBudgetExpensePlanJson(
        JSON.stringify({
          version: 1,
          expenses: [{ name: "空的", category: "DECOR_GIFTS" }],
        }),
      ),
    ).toThrow(BudgetExpenseValidationError);
    expect(() =>
      parseBudgetExpensePlanJson(planJson({ plannedAmount: 1 })),
    ).toThrow(BudgetExpenseValidationError);
  });

  it("needs both workspace confirmations and both operator confirmations", () => {
    expect(() =>
      parseBudgetExpenseCliArguments([
        "--workspace-id",
        workspaceId,
        "--confirm-workspace-id",
        "other",
        "--actor-user-id",
        actorUserId,
        "--confirm-actor-user-id",
        actorUserId,
        "--plan",
        "/tmp/plan.json",
      ]),
    ).toThrow(BudgetExpenseValidationError);
    const options = parseBudgetExpenseCliArguments([
      "--workspace-id",
      workspaceId,
      "--confirm-workspace-id",
      workspaceId,
      "--actor-user-id",
      actorUserId,
      "--confirm-actor-user-id",
      actorUserId,
      "--plan",
      "/tmp/plan.json",
    ]);
    expect(options.apply).toBe(false);
  });

  it("writes nothing without --apply", async () => {
    const client = fakeClient({ role: "OWNER" });
    const summary = await appendBudgetExpenses({
      client,
      workspaceId,
      actorUserId,
      plan: parseBudgetExpensePlanJson(planJson()) as BudgetExpensePlan,
    });
    expect(summary).toMatchObject({ mode: "dry-run", applied: false, create: 1 });
    expect(client.created).toHaveLength(0);
  });

  it("appends a manual expense row when applied", async () => {
    const client = fakeClient({ role: "PLANNER" });
    const summary = await appendBudgetExpenses({
      client,
      workspaceId,
      actorUserId,
      plan: parseBudgetExpensePlanJson(planJson()) as BudgetExpensePlan,
      apply: true,
    });
    expect(summary).toMatchObject({ mode: "apply", applied: true, create: 1 });
    expect(client.created[0]).toMatchObject({
      workspaceId,
      source: "MANUAL",
      kind: "EXPENSE",
      plannedAmount: 7100,
      actualAmount: 2000,
      paid: false,
    });
  });

  it("stops on a name that already exists instead of creating a duplicate", async () => {
    const client = fakeClient({ role: "OWNER", existingNames: ["合成項目"] });
    const summary = await appendBudgetExpenses({
      client,
      workspaceId,
      actorUserId,
      plan: parseBudgetExpensePlanJson(planJson()) as BudgetExpensePlan,
      apply: true,
    });
    expect(summary).toMatchObject({ applied: false, create: 0, conflict: 1 });
    expect(client.created).toHaveLength(0);
  });

  it("refuses viewers and missing memberships", async () => {
    await expect(
      appendBudgetExpenses({
        client: fakeClient({ role: "VIEWER" }),
        workspaceId,
        actorUserId,
        plan: parseBudgetExpensePlanJson(planJson()) as BudgetExpensePlan,
        apply: true,
      }),
    ).rejects.toBeInstanceOf(BudgetExpenseConflictError);
    await expect(
      appendBudgetExpenses({
        client: fakeClient({ role: null }),
        workspaceId,
        actorUserId,
        plan: parseBudgetExpensePlanJson(planJson()) as BudgetExpensePlan,
        apply: true,
      }),
    ).rejects.toBeInstanceOf(BudgetExpenseConflictError);
  });

  it("refuses a plan that lives inside the repository", async () => {
    const writeError = vi.fn();
    const code = await runBudgetExpenseCli(
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
        "plan.json",
      ],
      {
        databaseUrl: "postgresql://synthetic/synthetic",
        repositoryRoot: "/repo",
        resolveRealPath: async (filePath: string) =>
          filePath === "/repo" ? "/repo" : "/repo/plan.json",
        readCheckedFile: async () => ({ isFile: true, text: planJson() }),
        createClient: () => fakeClient({ role: "OWNER" }),
        writeOutput: () => undefined,
        writeError,
      },
    );
    expect(code).toBe(1);
    expect(writeError).toHaveBeenCalledWith("費用計畫必須位於 repository 外。");
  });

  it("prints only aggregates", () => {
    expect(
      formatBudgetExpenseSummary({
        mode: "apply",
        applied: true,
        create: 1,
        conflict: 0,
        plannedTotal: 7100,
        balanceDueTotal: 5100,
      }),
    ).toBe(
      "mode=apply applied=true create=1 conflict=0 plannedTotal=7100 balanceDueTotal=5100",
    );
  });
});
