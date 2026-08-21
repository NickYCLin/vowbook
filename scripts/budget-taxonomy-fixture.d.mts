export type BudgetTaxonomyFixtureNode = readonly [
  key: string,
  label: string,
  parentKey: string | null,
  sourceOrder: number,
];

export const BUDGET_TAXONOMY_FIXTURE_NODES: readonly BudgetTaxonomyFixtureNode[];

type BudgetTaxonomyFixtureClient = {
  budgetItem: {
    createMany(args: {
      data: Array<{
        id: string;
        workspaceId: string;
        parentId: string | null;
        source: "MANUAL";
        sourceOrder: number;
        name: string;
        kind: "GROUP";
        category: null;
        systemTaxonomyKey: string;
        plannedAmount: 0;
      }>;
    }): Promise<{ count: number }>;
  };
};

export function createBudgetTaxonomyFixture(
  client: BudgetTaxonomyFixtureClient,
  workspaceId: string,
): Promise<Map<string, string>>;
