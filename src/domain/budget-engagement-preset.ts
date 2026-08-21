import type { BudgetTaxonomyItemKey } from "@/domain/budget-item";

export const BUDGET_ENGAGEMENT_SUGGESTION_KEYS = {
  GROOM_LARGE_BETROTHAL_GIFT: "ENGAGEMENT_GROOM_LARGE_BETROTHAL_GIFT",
  GROOM_SMALL_BETROTHAL_GIFT: "ENGAGEMENT_GROOM_SMALL_BETROTHAL_GIFT",
  GROOM_GIFT_BEARER: "ENGAGEMENT_GROOM_GIFT_BEARER",
  GROOM_WOODEN_GIFT_BOX: "ENGAGEMENT_GROOM_WOODEN_GIFT_BOX",
  GROOM_SIX_OR_TWELVE_GIFTS: "ENGAGEMENT_GROOM_SIX_OR_TWELVE_GIFTS",
  GROOM_ANCESTOR_WORSHIP_SUPPLIES:
    "ENGAGEMENT_GROOM_ANCESTOR_WORSHIP_SUPPLIES",
  GROOM_MATCHMAKER_GIFT: "ENGAGEMENT_GROOM_MATCHMAKER_GIFT",
  GROOM_RECEPTION_GIFT: "ENGAGEMENT_GROOM_RECEPTION_GIFT",
  GROOM_BASIN_GIFT: "ENGAGEMENT_GROOM_BASIN_GIFT",
  GROOM_CANDLE_LIGHTING_GIFT: "ENGAGEMENT_GROOM_CANDLE_LIGHTING_GIFT",
  GROOM_TEA_GIFT: "ENGAGEMENT_GROOM_TEA_GIFT",
  GROOM_CEREMONIAL_CAR: "ENGAGEMENT_GROOM_CEREMONIAL_CAR",
  GROOM_TABLE_GIFT: "ENGAGEMENT_GROOM_TABLE_GIFT",
  BRIDE_ACCEPTANCE_GIFT: "ENGAGEMENT_BRIDE_ACCEPTANCE_GIFT",
  BRIDE_FORTUNE_LADY: "ENGAGEMENT_BRIDE_FORTUNE_LADY",
  BRIDE_STARTING_HOME_GIFT: "ENGAGEMENT_BRIDE_STARTING_HOME_GIFT",
  BRIDE_SIX_OR_TWELVE_GIFTS: "ENGAGEMENT_BRIDE_SIX_OR_TWELVE_GIFTS",
  BRIDE_ANCESTOR_WORSHIP_SUPPLIES:
    "ENGAGEMENT_BRIDE_ANCESTOR_WORSHIP_SUPPLIES",
  BRIDE_OTHER: "ENGAGEMENT_BRIDE_OTHER",
} as const;

export type BudgetEngagementSuggestionKey =
  (typeof BUDGET_ENGAGEMENT_SUGGESTION_KEYS)[keyof typeof BUDGET_ENGAGEMENT_SUGGESTION_KEYS];

export type BudgetEngagementPresetItem = Readonly<{
  key: BudgetEngagementSuggestionKey;
  name: string;
  notes?: string;
}>;

export type BudgetEngagementPresetGroup = Readonly<{
  taxonomyItemKey: Extract<
    BudgetTaxonomyItemKey,
    "ITEM_ENGAGEMENT_GROOM" | "ITEM_ENGAGEMENT_BRIDE"
  >;
  label: string;
  items: readonly BudgetEngagementPresetItem[];
}>;

export const BUDGET_ENGAGEMENT_PRESET_GROUPS: readonly BudgetEngagementPresetGroup[] = [
  {
    taxonomyItemKey: "ITEM_ENGAGEMENT_GROOM",
    label: "男方準備",
    items: [
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_LARGE_BETROTHAL_GIFT,
        name: "大聘",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_SMALL_BETROTHAL_GIFT,
        name: "小聘",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_GIFT_BEARER,
        name: "貢禮官",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_WOODEN_GIFT_BOX,
        name: "木盛盒",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_SIX_OR_TWELVE_GIFTS,
        name: "六禮／十二禮",
        notes:
          "盒餅（小餅）：西式喜餅；日頭餅（大餅）：中式漢餅；四金：贈與新娘耳環、項鍊、手鐲、金戒指；四色：金、香、炮、燭；六甜：冬瓜糖、戒指餅、桔餅、桂圓、冰糖、囍糖；女方頭尾禮（6／12件）；酒、麵線、糯米／砂糖、豬肉／火腿、醃雞／帶路雞、囍花／罐頭。",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS
          .GROOM_ANCESTOR_WORSHIP_SUPPLIES,
        name: "祭祖用品",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_MATCHMAKER_GIFT,
        name: "媒人禮",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_RECEPTION_GIFT,
        name: "接應禮",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_BASIN_GIFT,
        name: "端禮盆禮",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_CANDLE_LIGHTING_GIFT,
        name: "點燭禮",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_TEA_GIFT,
        name: "喝茶禮（壓茶歐）",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_CEREMONIAL_CAR,
        name: "禮車",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_TABLE_GIFT,
        name: "壓桌禮",
        notes: "桌數／桌價依實際填寫。",
      },
    ],
  },
  {
    taxonomyItemKey: "ITEM_ENGAGEMENT_BRIDE",
    label: "女方準備",
    items: [
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.BRIDE_ACCEPTANCE_GIFT,
        name: "接聘禮",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.BRIDE_FORTUNE_LADY,
        name: "好命婆",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.BRIDE_STARTING_HOME_GIFT,
        name: "起家禮",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.BRIDE_SIX_OR_TWELVE_GIFTS,
        name: "六禮／十二禮",
        notes:
          "二金四金：贈與新郎項鍊、金戒指；男方頭尾禮（6／12件）；木炭、麥／穀、黑砂糖、緣錢、肚圍、芋葉。",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS
          .BRIDE_ANCESTOR_WORSHIP_SUPPLIES,
        name: "祭祖用品",
      },
      {
        key: BUDGET_ENGAGEMENT_SUGGESTION_KEYS.BRIDE_OTHER,
        name: "其他",
        notes: "甜茶、茶盤、杯子、甜湯圓、高腳椅、矮凳、雞腿。",
      },
    ],
  },
];
