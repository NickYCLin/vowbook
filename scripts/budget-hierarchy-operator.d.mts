export type BudgetCostCategory =
  | "RINGS_KEEPSAKES"
  | "PHOTOGRAPHY_VIDEO"
  | "ATTIRE_STYLING"
  | "VENUE_CATERING"
  | "TRANSPORT_LODGING"
  | "DECOR_GIFTS"
  | "PEOPLE_SERVICES"
  | "OTHER_PENDING";

export type BudgetHierarchyProjection = {
  itemCount: number;
  rootCount: number;
  maxDepth: number;
  categoryCounts: Partial<Record<BudgetCostCategory, number>>;
  projectionSha256: string;
};

export type BudgetHierarchyPlan = {
  version: 1;
  expected: {
    before: BudgetHierarchyProjection;
    final: BudgetHierarchyProjection;
  };
  groups: Array<{
    ref: string;
    name: string;
    parentRef: string | null;
    finalPath: string[];
  }>;
  items: Array<{
    ref: string;
    beforePath: string[];
    finalPath: string[];
    finalKind: "GROUP" | "EXPENSE";
    finalCategory: BudgetCostCategory | null;
    finalName: string;
    parentRef: string | null;
  }>;
};

export type BudgetHierarchySummary = {
  mode: "dry-run" | "apply";
  applied: boolean;
  create: number;
  update: number;
  unchanged: number;
  conflict: number;
  roots: number;
  maxDepth: number;
  categoryCounts: Partial<Record<BudgetCostCategory, number>>;
  projectionHashMatches: boolean;
};

export class BudgetHierarchyValidationError extends Error {}
export class BudgetHierarchyConflictError extends Error {}

export const BUDGET_HIERARCHY_REPOSITORY_ROOT: string;

export function computeBudgetHierarchyProjection(
  rows: Array<Record<string, unknown>>,
): BudgetHierarchyProjection;
export function parseBudgetHierarchyPlanJson(json: string): BudgetHierarchyPlan;
export function parseBudgetHierarchyCliArguments(argv: string[]): {
  workspaceId: string;
  confirmWorkspaceId: string;
  actorUserId: string;
  confirmActorUserId: string;
  planPath: string;
  apply: boolean;
};
export function reorganizeBudgetHierarchy(options: {
  client: unknown;
  workspaceId: string;
  actorUserId: string;
  plan: BudgetHierarchyPlan;
  apply?: boolean;
}): Promise<BudgetHierarchySummary>;
export function formatBudgetHierarchySummary(
  summary: BudgetHierarchySummary,
): string;
export function runBudgetHierarchyCli(
  argv: string[],
  dependencies?: Record<string, unknown>,
): Promise<number>;
