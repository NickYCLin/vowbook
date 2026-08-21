import { describe, expect, it } from "vitest";

import {
  BUDGET_PREPARATION_PRESET_GROUPS,
  BUDGET_PREPARATION_PRESET_STAGES,
  BUDGET_PREPARATION_SUGGESTION_KEYS,
  coveredBudgetPreparationSuggestionKeys,
} from "@/domain/budget-preparation-preset";

const KEYS = BUDGET_PREPARATION_SUGGESTION_KEYS;
const allSuggestions = BUDGET_PREPARATION_PRESET_GROUPS.flatMap(
  (stage) => stage.items,
);

describe("budget preparation preset", () => {
  it("keeps the Drive-derived non-engagement catalog complete and stable", () => {
    expect(BUDGET_PREPARATION_PRESET_GROUPS).toHaveLength(5);
    expect(
      BUDGET_PREPARATION_PRESET_GROUPS.map((stage) => stage.items.length),
    ).toEqual([14, 8, 9, 12, 18]);
    expect(allSuggestions).toHaveLength(61);
    expect(
      new Set(allSuggestions.map((item) => item.taxonomyItemKey)).size,
    ).toBe(18);

    const keys = allSuggestions.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(Object.values(BUDGET_PREPARATION_SUGGESTION_KEYS));
    for (const key of keys) {
      expect(key).toMatch(/^PREPARATION_[A-Z0-9_]+$/u);
      expect(key.length).toBeLessThanOrEqual(100);
    }

    const serializedCatalog = JSON.stringify(BUDGET_PREPARATION_PRESET_GROUPS);
    expect(serializedCatalog).not.toContain("提親");
    expect(serializedCatalog).not.toContain("STAGE_ENGAGEMENT_CEREMONY");
    expect(serializedCatalog).not.toContain("ITEM_ENGAGEMENT_GROOM");
    expect(serializedCatalog).not.toContain("ITEM_ENGAGEMENT_BRIDE");
  });

  it("keeps proposal under 求婚 with exactly the six Drive source items", () => {
    const proposalItems = allSuggestions.filter(
      (item) => item.taxonomyItemKey === "ITEM_PROPOSAL",
    );

    expect(proposalItems.map(({ key, name }) => ({ key, name }))).toEqual([
      {
        key: KEYS.PROPOSAL_FAMILY_MEAL,
        name: "兩家人見面餐費",
      },
      { key: KEYS.PROPOSAL_COURTESY_GIFT, name: "伴手禮" },
      { key: KEYS.PROPOSAL_BETROTHAL_GIFT, name: "聘禮" },
      { key: KEYS.PROPOSAL_CUSTOMS_SUPPLIES, name: "禮俗用品" },
      { key: KEYS.PROPOSAL_GOLD_JEWELRY, name: "金飾" },
      {
        key: KEYS.PROPOSAL_WEDDING_RINGS,
        name: "婚戒（求婚戒與對戒）",
      },
    ]);

    const proposalGroup = BUDGET_PREPARATION_PRESET_STAGES.flatMap(
      (stage) => stage.groups,
    ).find((group) => group.taxonomyItemKey === "ITEM_PROPOSAL");
    expect(proposalGroup?.label).toBe("求婚");
    expect(proposalGroup?.items).toEqual(proposalItems);
  });

  it("adapts each stage into Drive taxonomy groups without losing order", () => {
    expect(
      BUDGET_PREPARATION_PRESET_STAGES.map((stage) =>
        stage.groups.flatMap((group) => group.items).map((item) => item.key),
      ),
    ).toEqual(
      BUDGET_PREPARATION_PRESET_GROUPS.map((stage) =>
        stage.items.map((item) => item.key),
      ),
    );
    expect(
      BUDGET_PREPARATION_PRESET_STAGES.flatMap((stage) => stage.groups),
    ).toHaveLength(18);
  });

  it("keeps legitimate duplicate names independently coverable by taxonomy", () => {
    const covered = coveredBudgetPreparationSuggestionKeys([
      {
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "拍攝婚紗",
      },
      { taxonomyItemKey: "ITEM_ATTIRE_RENTAL", name: "宴客婚紗" },
      {
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "拍攝西裝",
      },
      { taxonomyItemKey: "ITEM_ATTIRE_RENTAL", name: "宴客西裝" },
      { taxonomyItemKey: "ITEM_PROCESSION_GROOM", name: "開門禮" },
      { taxonomyItemKey: "ITEM_PROCESSION_BRIDE", name: "開門禮" },
    ]);

    expect(covered).toEqual(
      new Set([
        KEYS.PRE_WEDDING_PHOTOGRAPHY_WEDDING_DRESS,
        KEYS.PRE_WEDDING_PHOTOGRAPHY_SUIT,
        KEYS.ATTIRE_WEDDING_DRESS,
        KEYS.ATTIRE_SUIT,
        KEYS.PROCESSION_GROOM_DOOR_OPENING_GIFT,
        KEYS.PROCESSION_BRIDE_DOOR_OPENING_GIFT,
      ]),
    );
  });

  it("marks exactly 13 suggestions covered by the formal 32-name snapshot", () => {
    const formalSnapshot = [
      { taxonomyItemKey: "ITEM_PROPOSAL", name: "婚戒(求婚戒與對戒)" },
      { taxonomyItemKey: "ITEM_WEDDING_VENUE", name: "宴客場地" },
      {
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "拍攝廠商",
      },
      { taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY", name: "租婚紗" },
      { taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY", name: "拍攝西裝" },
      {
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "合成姓名髮型整理",
      },
      {
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "工作人員用餐",
      },
      { taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY", name: "拍攝車資" },
      { taxonomyItemKey: "ITEM_BRIDAL_STYLIST", name: "新娘秘書" },
      { taxonomyItemKey: "ITEM_WEDDING_PHOTOGRAPHY", name: "平面" },
      { taxonomyItemKey: "ITEM_WEDDING_VIDEOGRAPHY", name: "動態" },
      { taxonomyItemKey: "ITEM_WEDDING_HOST", name: "婚禮主持人" },
      { taxonomyItemKey: "ITEM_ATTIRE_RENTAL", name: "宴客婚紗廠商" },
      { taxonomyItemKey: "ITEM_WEDDING_INTERACTION", name: "拍拍印" },
      { taxonomyItemKey: "ITEM_WEDDING_FAVORS", name: "婚禮小物" },
      {
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "婚禮工作人員紅包",
      },
      {
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "新人的小白鞋",
      },
      {
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "拍攝用小白鞋",
      },
      { taxonomyItemKey: "ITEM_WEDDING_SHOES", name: "新人的小白鞋" },
      { taxonomyItemKey: "ITEM_PROPOSAL", name: "求婚企劃" },
      { taxonomyItemKey: "ITEM_WEDDING_VENUE", name: "宴客" },
      { taxonomyItemKey: "ITEM_WEDDING_CAKES", name: "喜餅" },
      { taxonomyItemKey: "ITEM_WEDDING_INTERACTION", name: "印卡讚" },
      { taxonomyItemKey: "ITEM_BRIDAL_STYLIST", name: "造型師" },
      { taxonomyItemKey: "ITEM_WEDDING_PHOTOGRAPHY", name: "相片輸出" },
      { taxonomyItemKey: "ITEM_WEDDING_VIDEOGRAPHY", name: "快剪快播" },
      { taxonomyItemKey: "ITEM_WEDDING_BAND", name: "樂團" },
      { taxonomyItemKey: "ITEM_WEDDING_DECOR", name: "場地佈置" },
      { taxonomyItemKey: "ITEM_INVITATIONS_POSTAGE", name: "喜帖" },
      { taxonomyItemKey: "ITEM_BEAUTY_TREATMENTS", name: "保養" },
      { taxonomyItemKey: "ITEM_WEDDING_FAVORS", name: "伴郎伴娘" },
      { taxonomyItemKey: "ITEM_PROCESSION_GROOM", name: "開門紅包" },
    ] as const;
    expect(formalSnapshot).toHaveLength(32);

    const covered = coveredBudgetPreparationSuggestionKeys(formalSnapshot);
    expect(covered).toEqual(
      new Set([
        KEYS.PROPOSAL_WEDDING_RINGS,
        KEYS.VENUE_BANQUET_TABLES_SITE,
        KEYS.PRE_WEDDING_PHOTOGRAPHY_SERVICE,
        KEYS.PRE_WEDDING_PHOTOGRAPHY_WEDDING_DRESS,
        KEYS.PRE_WEDDING_PHOTOGRAPHY_SUIT,
        KEYS.PRE_WEDDING_PHOTOGRAPHY_HAIR_MAKEUP,
        KEYS.PRE_WEDDING_PHOTOGRAPHY_MEALS,
        KEYS.PRE_WEDDING_PHOTOGRAPHY_TRANSPORTATION,
        KEYS.BRIDAL_STYLIST,
        KEYS.WEDDING_PHOTOGRAPHY,
        KEYS.WEDDING_VIDEOGRAPHY,
        KEYS.WEDDING_HOST,
        KEYS.ATTIRE_WEDDING_DRESS,
      ]),
    );

    expect(covered).not.toContain(KEYS.WEDDING_INTERACTION_BARTENDING_VENDOR);
    expect(
      [...covered].filter((key) => key.startsWith("PREPARATION_FAVORS_")),
    ).toEqual([]);
    expect(
      [...covered].filter((key) => key.startsWith("PREPARATION_PROCESSION_")),
    ).toEqual([]);
    expect(covered).not.toContain(KEYS.WEDDING_SHOES_BRIDE);
    expect(covered).not.toContain(KEYS.WEDDING_SHOES_GROOM);
  });
});
