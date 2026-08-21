import { describe, expect, it, vi } from "vitest";
import {
  BUDGET_SYSTEM_NODES,
  BUDGET_TAXONOMY_STAGES,
} from "@/domain/budget-item";
import {
  BUDGET_TAXONOMY_FIXTURE_NODES,
  createBudgetTaxonomyFixture,
} from "../../scripts/budget-taxonomy-fixture.mjs";

describe("budget taxonomy browser fixture", () => {
  it("seeds all 28 system nodes while public Drive choices stay at six stages and twenty items", () => {
    expect(BUDGET_TAXONOMY_FIXTURE_NODES).toEqual(
      BUDGET_SYSTEM_NODES.map((node) => [
        node.key,
        node.label,
        node.parentKey,
        node.sourceOrder,
      ]),
    );
    expect(BUDGET_TAXONOMY_FIXTURE_NODES).toHaveLength(28);
    expect(BUDGET_TAXONOMY_STAGES).toHaveLength(6);
    expect(
      BUDGET_TAXONOMY_STAGES.reduce(
        (itemCount, stage) => itemCount + stage.items.length,
        0,
      ),
    ).toBe(20);
  });

  it("creates every fixed node for one explicit workspace with resolved parents", async () => {
    const createMany = vi.fn(async ({ data }) => ({ count: data.length }));
    const ids = await createBudgetTaxonomyFixture(
      { budgetItem: { createMany } },
      "workspace_1",
    );

    expect(ids).toHaveLength(28);
    expect(createMany).toHaveBeenCalledOnce();
    const rows = createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(28);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: "workspace_1",
          parentId: null,
          systemTaxonomyKey: "STAGE_PREPARATION_1_2_MONTHS",
        }),
        expect.objectContaining({
          workspaceId: "workspace_1",
          parentId: ids.get("STAGE_PREPARATION_1_2_MONTHS"),
          systemTaxonomyKey: "ITEM_WEDDING_VENUE",
        }),
      ]),
    );
  });
});
