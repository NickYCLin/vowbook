import { randomUUID } from "node:crypto";

export const BUDGET_TAXONOMY_FIXTURE_NODES = Object.freeze([
  ["STAGE_PREPARATION_1_2_MONTHS", "籌備第1-2月", null, 1],
  ["ITEM_PROPOSAL", "求婚", "STAGE_PREPARATION_1_2_MONTHS", 1],
  ["ITEM_WEDDING_VENUE", "婚宴場地", "STAGE_PREPARATION_1_2_MONTHS", 2],
  ["ITEM_PRE_WEDDING_PHOTOGRAPHY", "婚紗照拍攝", "STAGE_PREPARATION_1_2_MONTHS", 3],
  ["STAGE_PREPARATION_3_MONTH", "籌備第3個月", null, 2],
  ["ITEM_WEDDING_CAKES", "喜餅", "STAGE_PREPARATION_3_MONTH", 1],
  ["ITEM_BRIDAL_STYLIST", "新娘秘書", "STAGE_PREPARATION_3_MONTH", 2],
  ["ITEM_WEDDING_PHOTOGRAPHY", "婚禮攝影", "STAGE_PREPARATION_3_MONTH", 3],
  ["ITEM_WEDDING_VIDEOGRAPHY", "婚禮錄影", "STAGE_PREPARATION_3_MONTH", 4],
  ["ITEM_WEDDING_HOST", "婚禮主持", "STAGE_PREPARATION_3_MONTH", 5],
  ["ITEM_WEDDING_BAND", "婚禮樂團", "STAGE_PREPARATION_3_MONTH", 6],
  ["ITEM_WEDDING_INTERACTION", "婚禮互動", "STAGE_PREPARATION_3_MONTH", 7],
  ["STAGE_PREPARATION_4_MONTH", "籌備婚禮第4個月", null, 3],
  ["ITEM_ATTIRE_RENTAL", "禮服租借", "STAGE_PREPARATION_4_MONTH", 1],
  ["ITEM_WEDDING_SHOES", "婚鞋", "STAGE_PREPARATION_4_MONTH", 2],
  ["ITEM_WEDDING_DECOR", "婚禮佈置", "STAGE_PREPARATION_4_MONTH", 3],
  ["STAGE_COUNTDOWN_2_MONTHS", "婚禮前倒數2個月", null, 4],
  ["ITEM_INVITATIONS_POSTAGE", "印喜帖及寄送", "STAGE_COUNTDOWN_2_MONTHS", 1],
  ["ITEM_BEAUTY_TREATMENTS", "保養療程", "STAGE_COUNTDOWN_2_MONTHS", 2],
  ["ITEM_WEDDING_FAVORS", "婚禮小物", "STAGE_COUNTDOWN_2_MONTHS", 3],
  ["STAGE_ENGAGEMENT_CEREMONY", "文定儀式用品、工作人員紅包", null, 5],
  ["ITEM_ENGAGEMENT_GROOM", "文定儀式（男方準備）", "STAGE_ENGAGEMENT_CEREMONY", 1],
  ["ITEM_ENGAGEMENT_BRIDE", "文定儀式（女方準備）", "STAGE_ENGAGEMENT_CEREMONY", 2],
  ["STAGE_WEDDING_PROCESSION", "迎娶儀式用品、工作人員紅包", null, 6],
  ["ITEM_PROCESSION_GROOM", "迎娶儀式男方準備", "STAGE_WEDDING_PROCESSION", 1],
  ["ITEM_PROCESSION_BRIDE", "迎娶儀式女方準備", "STAGE_WEDDING_PROCESSION", 2],
  ["INTERNAL_UNCLASSIFIED_STAGE", "系統保留", null, 7],
  [
    "INTERNAL_UNCLASSIFIED_ITEM",
    "未分類既有項目",
    "INTERNAL_UNCLASSIFIED_STAGE",
    1,
  ],
]);

export async function createBudgetTaxonomyFixture(client, workspaceId) {
  const ids = new Map(
    BUDGET_TAXONOMY_FIXTURE_NODES.map(([key]) => [key, randomUUID()]),
  );
  const result = await client.budgetItem.createMany({
    data: BUDGET_TAXONOMY_FIXTURE_NODES.map(
      ([key, name, parentKey, sourceOrder]) => ({
        id: ids.get(key),
        workspaceId,
        parentId: parentKey === null ? null : ids.get(parentKey),
        source: "MANUAL",
        sourceOrder,
        name,
        kind: "GROUP",
        category: null,
        systemTaxonomyKey: key,
        plannedAmount: 0,
      }),
    ),
  });
  if (result.count !== BUDGET_TAXONOMY_FIXTURE_NODES.length) {
    throw new Error("Budget taxonomy fixture did not create all fixed nodes.");
  }
  return ids;
}
