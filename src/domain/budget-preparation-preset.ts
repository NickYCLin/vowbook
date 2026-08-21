import {
  BUDGET_TAXONOMY_NODE_BY_KEY,
  type BudgetTaxonomyItemKey,
  type BudgetTaxonomyStageKey,
} from "@/domain/budget-item";

export const BUDGET_PREPARATION_SUGGESTION_KEYS = {
  PROPOSAL_FAMILY_MEAL: "PREPARATION_PROPOSAL_FAMILY_MEAL",
  PROPOSAL_COURTESY_GIFT: "PREPARATION_PROPOSAL_COURTESY_GIFT",
  PROPOSAL_BETROTHAL_GIFT: "PREPARATION_PROPOSAL_BETROTHAL_GIFT",
  PROPOSAL_CUSTOMS_SUPPLIES: "PREPARATION_PROPOSAL_CUSTOMS_SUPPLIES",
  PROPOSAL_GOLD_JEWELRY: "PREPARATION_PROPOSAL_GOLD_JEWELRY",
  PROPOSAL_WEDDING_RINGS: "PREPARATION_PROPOSAL_WEDDING_RINGS",
  VENUE_BANQUET_TABLES_SITE: "PREPARATION_VENUE_BANQUET_TABLES_SITE",
  PRE_WEDDING_PHOTOGRAPHY_SERVICE:
    "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_SERVICE",
  PRE_WEDDING_PHOTOGRAPHY_WEDDING_DRESS:
    "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_WEDDING_DRESS",
  PRE_WEDDING_PHOTOGRAPHY_SUIT:
    "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_SUIT",
  PRE_WEDDING_PHOTOGRAPHY_HAIR_MAKEUP:
    "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_HAIR_MAKEUP",
  PRE_WEDDING_PHOTOGRAPHY_RETOUCHING:
    "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_RETOUCHING",
  PRE_WEDDING_PHOTOGRAPHY_MEALS:
    "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_MEALS",
  PRE_WEDDING_PHOTOGRAPHY_TRANSPORTATION:
    "PREPARATION_PRE_WEDDING_PHOTOGRAPHY_TRANSPORTATION",
  WEDDING_CAKES_WESTERN: "PREPARATION_WEDDING_CAKES_WESTERN",
  WEDDING_CAKES_CHINESE: "PREPARATION_WEDDING_CAKES_CHINESE",
  BRIDAL_STYLIST: "PREPARATION_BRIDAL_STYLIST",
  WEDDING_PHOTOGRAPHY: "PREPARATION_WEDDING_PHOTOGRAPHY",
  WEDDING_VIDEOGRAPHY: "PREPARATION_WEDDING_VIDEOGRAPHY",
  WEDDING_HOST: "PREPARATION_WEDDING_HOST",
  WEDDING_BAND: "PREPARATION_WEDDING_BAND",
  WEDDING_INTERACTION_BARTENDING_VENDOR:
    "PREPARATION_WEDDING_INTERACTION_BARTENDING_VENDOR",
  ATTIRE_WEDDING_DRESS: "PREPARATION_ATTIRE_WEDDING_DRESS",
  ATTIRE_SUIT: "PREPARATION_ATTIRE_SUIT",
  ATTIRE_WEDDING_PARTY: "PREPARATION_ATTIRE_WEDDING_PARTY",
  ATTIRE_FLOWER_CHILDREN: "PREPARATION_ATTIRE_FLOWER_CHILDREN",
  ATTIRE_MOTHER_DRESS: "PREPARATION_ATTIRE_MOTHER_DRESS",
  ATTIRE_FATHER_SUIT: "PREPARATION_ATTIRE_FATHER_SUIT",
  WEDDING_SHOES_BRIDE: "PREPARATION_WEDDING_SHOES_BRIDE",
  WEDDING_SHOES_GROOM: "PREPARATION_WEDDING_SHOES_GROOM",
  WEDDING_DECOR: "PREPARATION_WEDDING_DECOR",
  INVITATIONS_PRINTING: "PREPARATION_INVITATIONS_PRINTING",
  INVITATIONS_POSTAGE: "PREPARATION_INVITATIONS_POSTAGE",
  BEAUTY_FACIAL_HYDRATION_TREATMENT:
    "PREPARATION_BEAUTY_FACIAL_HYDRATION_TREATMENT",
  FAVORS_WELCOME: "PREPARATION_FAVORS_WELCOME",
  FAVORS_PLACE_SETTING: "PREPARATION_FAVORS_PLACE_SETTING",
  FAVORS_BRIDAL_ROOM: "PREPARATION_FAVORS_BRIDAL_ROOM",
  FAVORS_SECOND_ENTRANCE: "PREPARATION_FAVORS_SECOND_ENTRANCE",
  FAVORS_GAME: "PREPARATION_FAVORS_GAME",
  FAVORS_BOUQUET: "PREPARATION_FAVORS_BOUQUET",
  FAVORS_SEND_OFF: "PREPARATION_FAVORS_SEND_OFF",
  FAVORS_CLOSE_FRIENDS: "PREPARATION_FAVORS_CLOSE_FRIENDS",
  FAVORS_WEDDING_PARTY: "PREPARATION_FAVORS_WEDDING_PARTY",
  PROCESSION_GROOM_ESCORT_GIFT:
    "PREPARATION_PROCESSION_GROOM_ESCORT_GIFT",
  PROCESSION_GROOM_DOOR_OPENING_GIFT:
    "PREPARATION_PROCESSION_GROOM_DOOR_OPENING_GIFT",
  PROCESSION_GROOM_MATCHMAKER_GIFT:
    "PREPARATION_PROCESSION_GROOM_MATCHMAKER_GIFT",
  PROCESSION_GROOM_CHALLENGE_GIFT:
    "PREPARATION_PROCESSION_GROOM_CHALLENGE_GIFT",
  PROCESSION_GROOM_BED_SETTING_GIFT:
    "PREPARATION_PROCESSION_GROOM_BED_SETTING_GIFT",
  PROCESSION_BRIDE_DOOR_OPENING_GIFT:
    "PREPARATION_PROCESSION_BRIDE_DOOR_OPENING_GIFT",
  PROCESSION_BRIDE_MATERNAL_UNCLE_LIGHTING_GIFT:
    "PREPARATION_PROCESSION_BRIDE_MATERNAL_UNCLE_LIGHTING_GIFT",
  PROCESSION_BRIDE_FAN_TOSSING_GIFT:
    "PREPARATION_PROCESSION_BRIDE_FAN_TOSSING_GIFT",
  PROCESSION_BRIDE_WEDDING_PARTY:
    "PREPARATION_PROCESSION_BRIDE_WEDDING_PARTY",
  PROCESSION_BRIDE_FLOWER_CHILDREN:
    "PREPARATION_PROCESSION_BRIDE_FLOWER_CHILDREN",
  PROCESSION_BRIDE_INTRODUCER:
    "PREPARATION_PROCESSION_BRIDE_INTRODUCER",
  PROCESSION_BRIDE_WITNESS: "PREPARATION_PROCESSION_BRIDE_WITNESS",
  PROCESSION_BRIDE_GIFT_RECEPTION_STAFF:
    "PREPARATION_PROCESSION_BRIDE_GIFT_RECEPTION_STAFF",
  PROCESSION_BRIDE_USHER_STAFF:
    "PREPARATION_PROCESSION_BRIDE_USHER_STAFF",
  PROCESSION_BRIDE_HEAD_USHER: "PREPARATION_PROCESSION_BRIDE_HEAD_USHER",
  PROCESSION_BRIDE_BANQUET_SERVICE_STAFF:
    "PREPARATION_PROCESSION_BRIDE_BANQUET_SERVICE_STAFF",
  PROCESSION_BRIDE_WEDDING_PLANNER:
    "PREPARATION_PROCESSION_BRIDE_WEDDING_PLANNER",
  PROCESSION_BRIDE_BRIDAL_ATTENDANT:
    "PREPARATION_PROCESSION_BRIDE_BRIDAL_ATTENDANT",
} as const;

export type BudgetPreparationSuggestionKey =
  (typeof BUDGET_PREPARATION_SUGGESTION_KEYS)[keyof typeof BUDGET_PREPARATION_SUGGESTION_KEYS];

type BudgetPreparationStageKey = Exclude<
  BudgetTaxonomyStageKey,
  "STAGE_ENGAGEMENT_CEREMONY"
>;

type BudgetPreparationTaxonomyItemKey = Exclude<
  BudgetTaxonomyItemKey,
  "ITEM_ENGAGEMENT_GROOM" | "ITEM_ENGAGEMENT_BRIDE"
>;

export type BudgetPreparationPresetItem = Readonly<{
  key: BudgetPreparationSuggestionKey;
  taxonomyItemKey: BudgetPreparationTaxonomyItemKey;
  name: string;
  notes?: string;
  coverageAliases?: readonly string[];
}>;

export type BudgetPreparationPresetGroup = Readonly<{
  stageKey: BudgetPreparationStageKey;
  label: string;
  items: readonly BudgetPreparationPresetItem[];
}>;

const KEYS = BUDGET_PREPARATION_SUGGESTION_KEYS;

export const BUDGET_PREPARATION_PRESET_GROUPS: readonly BudgetPreparationPresetGroup[] = [
  {
    stageKey: "STAGE_PREPARATION_1_2_MONTHS",
    label: "籌備第1-2月",
    items: [
      {
        key: KEYS.PROPOSAL_FAMILY_MEAL,
        taxonomyItemKey: "ITEM_PROPOSAL",
        name: "兩家人見面餐費",
      },
      {
        key: KEYS.PROPOSAL_COURTESY_GIFT,
        taxonomyItemKey: "ITEM_PROPOSAL",
        name: "伴手禮",
      },
      {
        key: KEYS.PROPOSAL_BETROTHAL_GIFT,
        taxonomyItemKey: "ITEM_PROPOSAL",
        name: "聘禮",
      },
      {
        key: KEYS.PROPOSAL_CUSTOMS_SUPPLIES,
        taxonomyItemKey: "ITEM_PROPOSAL",
        name: "禮俗用品",
      },
      {
        key: KEYS.PROPOSAL_GOLD_JEWELRY,
        taxonomyItemKey: "ITEM_PROPOSAL",
        name: "金飾",
      },
      {
        key: KEYS.PROPOSAL_WEDDING_RINGS,
        taxonomyItemKey: "ITEM_PROPOSAL",
        name: "婚戒（求婚戒與對戒）",
        coverageAliases: ["婚戒", "求婚鑽戒", "求婚戒", "對戒"],
      },
      {
        key: KEYS.VENUE_BANQUET_TABLES_SITE,
        taxonomyItemKey: "ITEM_WEDDING_VENUE",
        name: "婚宴桌席／場地費",
        notes: "桌數與桌價依實際填寫。",
        coverageAliases: ["婚宴場地", "宴客場地", "婚宴桌席", "場地費"],
      },
      {
        key: KEYS.PRE_WEDDING_PHOTOGRAPHY_SERVICE,
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "攝影外拍服務",
        coverageAliases: [
          "攝影外拍服務",
          "婚紗攝影方案",
          "婚紗攝影服務",
          "拍攝廠商",
        ],
      },
      {
        key: KEYS.PRE_WEDDING_PHOTOGRAPHY_WEDDING_DRESS,
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "婚紗",
        coverageAliases: ["租婚紗", "拍攝婚紗"],
      },
      {
        key: KEYS.PRE_WEDDING_PHOTOGRAPHY_SUIT,
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "西裝",
        coverageAliases: ["租西裝", "拍攝西裝"],
      },
      {
        key: KEYS.PRE_WEDDING_PHOTOGRAPHY_HAIR_MAKEUP,
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "妝髮造型服務",
        coverageAliases: ["妝髮造型服務", "妝髮造型", "拍攝造型", "髮型整理"],
      },
      {
        key: KEYS.PRE_WEDDING_PHOTOGRAPHY_RETOUCHING,
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "精修",
      },
      {
        key: KEYS.PRE_WEDDING_PHOTOGRAPHY_MEALS,
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "餐費",
        coverageAliases: ["餐費", "用餐"],
      },
      {
        key: KEYS.PRE_WEDDING_PHOTOGRAPHY_TRANSPORTATION,
        taxonomyItemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
        name: "車費",
        coverageAliases: ["車費", "拍攝車資"],
      },
    ],
  },
  {
    stageKey: "STAGE_PREPARATION_3_MONTH",
    label: "籌備第3個月",
    items: [
      {
        key: KEYS.WEDDING_CAKES_WESTERN,
        taxonomyItemKey: "ITEM_WEDDING_CAKES",
        name: "西式喜餅",
      },
      {
        key: KEYS.WEDDING_CAKES_CHINESE,
        taxonomyItemKey: "ITEM_WEDDING_CAKES",
        name: "中式喜餅",
      },
      {
        key: KEYS.BRIDAL_STYLIST,
        taxonomyItemKey: "ITEM_BRIDAL_STYLIST",
        name: "新娘秘書",
        coverageAliases: ["新娘秘書", "新秘"],
      },
      {
        key: KEYS.WEDDING_PHOTOGRAPHY,
        taxonomyItemKey: "ITEM_WEDDING_PHOTOGRAPHY",
        name: "婚禮攝影",
        coverageAliases: ["婚禮攝影", "婚禮攝影廠商", "平面"],
      },
      {
        key: KEYS.WEDDING_VIDEOGRAPHY,
        taxonomyItemKey: "ITEM_WEDDING_VIDEOGRAPHY",
        name: "婚禮錄影",
        coverageAliases: ["婚禮錄影", "婚禮錄影廠商", "動態"],
      },
      {
        key: KEYS.WEDDING_HOST,
        taxonomyItemKey: "ITEM_WEDDING_HOST",
        name: "婚禮主持",
        coverageAliases: ["婚禮主持", "主持人"],
      },
      {
        key: KEYS.WEDDING_BAND,
        taxonomyItemKey: "ITEM_WEDDING_BAND",
        name: "婚禮樂團",
        coverageAliases: ["婚禮樂團", "Live band", "現場演奏"],
      },
      {
        key: KEYS.WEDDING_INTERACTION_BARTENDING_VENDOR,
        taxonomyItemKey: "ITEM_WEDDING_INTERACTION",
        name: "調酒廠商",
        coverageAliases: ["調酒廠商", "婚禮調酒", "宴會酒吧"],
      },
    ],
  },
  {
    stageKey: "STAGE_PREPARATION_4_MONTH",
    label: "籌備婚禮第4個月",
    items: [
      {
        key: KEYS.ATTIRE_WEDDING_DRESS,
        taxonomyItemKey: "ITEM_ATTIRE_RENTAL",
        name: "婚紗",
        coverageAliases: ["宴客婚紗", "新娘婚紗", "白紗", "晚禮服"],
      },
      {
        key: KEYS.ATTIRE_SUIT,
        taxonomyItemKey: "ITEM_ATTIRE_RENTAL",
        name: "西裝",
        coverageAliases: ["新郎西裝", "宴客西裝"],
      },
      {
        key: KEYS.ATTIRE_WEDDING_PARTY,
        taxonomyItemKey: "ITEM_ATTIRE_RENTAL",
        name: "伴郎／伴娘服",
      },
      {
        key: KEYS.ATTIRE_FLOWER_CHILDREN,
        taxonomyItemKey: "ITEM_ATTIRE_RENTAL",
        name: "花童服",
      },
      {
        key: KEYS.ATTIRE_MOTHER_DRESS,
        taxonomyItemKey: "ITEM_ATTIRE_RENTAL",
        name: "媽媽禮服",
      },
      {
        key: KEYS.ATTIRE_FATHER_SUIT,
        taxonomyItemKey: "ITEM_ATTIRE_RENTAL",
        name: "爸爸西裝",
      },
      {
        key: KEYS.WEDDING_SHOES_BRIDE,
        taxonomyItemKey: "ITEM_WEDDING_SHOES",
        name: "新娘婚鞋",
      },
      {
        key: KEYS.WEDDING_SHOES_GROOM,
        taxonomyItemKey: "ITEM_WEDDING_SHOES",
        name: "新郎皮鞋",
      },
      {
        key: KEYS.WEDDING_DECOR,
        taxonomyItemKey: "ITEM_WEDDING_DECOR",
        name: "婚禮佈置",
      },
    ],
  },
  {
    stageKey: "STAGE_COUNTDOWN_2_MONTHS",
    label: "婚禮前倒數2個月",
    items: [
      {
        key: KEYS.INVITATIONS_PRINTING,
        taxonomyItemKey: "ITEM_INVITATIONS_POSTAGE",
        name: "喜帖印製",
        coverageAliases: ["喜帖印製", "喜帖印刷"],
      },
      {
        key: KEYS.INVITATIONS_POSTAGE,
        taxonomyItemKey: "ITEM_INVITATIONS_POSTAGE",
        name: "喜帖郵費",
        coverageAliases: ["喜帖郵費", "喜帖寄送", "郵費"],
      },
      {
        key: KEYS.BEAUTY_FACIAL_HYDRATION_TREATMENT,
        taxonomyItemKey: "ITEM_BEAUTY_TREATMENTS",
        name: "臉部保濕／保養療程",
        coverageAliases: ["臉部保濕", "保養療程", "婚前保養"],
      },
      {
        key: KEYS.FAVORS_WELCOME,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "迎賓禮",
      },
      {
        key: KEYS.FAVORS_PLACE_SETTING,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "位上禮",
      },
      {
        key: KEYS.FAVORS_BRIDAL_ROOM,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "探房禮",
      },
      {
        key: KEYS.FAVORS_SECOND_ENTRANCE,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "二進禮",
      },
      {
        key: KEYS.FAVORS_GAME,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "遊戲禮",
      },
      {
        key: KEYS.FAVORS_BOUQUET,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "捧花禮",
      },
      {
        key: KEYS.FAVORS_SEND_OFF,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "送客禮",
      },
      {
        key: KEYS.FAVORS_CLOSE_FRIENDS,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "閨密禮",
      },
      {
        key: KEYS.FAVORS_WEDDING_PARTY,
        taxonomyItemKey: "ITEM_WEDDING_FAVORS",
        name: "伴娘伴郎禮",
      },
    ],
  },
  {
    stageKey: "STAGE_WEDDING_PROCESSION",
    label: "迎娶儀式用品、工作人員紅包",
    items: [
      {
        key: KEYS.PROCESSION_GROOM_ESCORT_GIFT,
        taxonomyItemKey: "ITEM_PROCESSION_GROOM",
        name: "陪娶禮",
      },
      {
        key: KEYS.PROCESSION_GROOM_DOOR_OPENING_GIFT,
        taxonomyItemKey: "ITEM_PROCESSION_GROOM",
        name: "開門禮",
      },
      {
        key: KEYS.PROCESSION_GROOM_MATCHMAKER_GIFT,
        taxonomyItemKey: "ITEM_PROCESSION_GROOM",
        name: "媒人禮",
      },
      {
        key: KEYS.PROCESSION_GROOM_CHALLENGE_GIFT,
        taxonomyItemKey: "ITEM_PROCESSION_GROOM",
        name: "討喜禮（闖關使用）",
      },
      {
        key: KEYS.PROCESSION_GROOM_BED_SETTING_GIFT,
        taxonomyItemKey: "ITEM_PROCESSION_GROOM",
        name: "安床禮",
      },
      {
        key: KEYS.PROCESSION_BRIDE_DOOR_OPENING_GIFT,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "開門禮",
      },
      {
        key: KEYS.PROCESSION_BRIDE_MATERNAL_UNCLE_LIGHTING_GIFT,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "母舅點燈禮",
      },
      {
        key: KEYS.PROCESSION_BRIDE_FAN_TOSSING_GIFT,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "擲扇禮",
      },
      {
        key: KEYS.PROCESSION_BRIDE_WEDDING_PARTY,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "伴郎／伴娘",
      },
      {
        key: KEYS.PROCESSION_BRIDE_FLOWER_CHILDREN,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "花童",
      },
      {
        key: KEYS.PROCESSION_BRIDE_INTRODUCER,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "介紹人",
      },
      {
        key: KEYS.PROCESSION_BRIDE_WITNESS,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "證婚人",
      },
      {
        key: KEYS.PROCESSION_BRIDE_GIFT_RECEPTION_STAFF,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "收禮人員",
      },
      {
        key: KEYS.PROCESSION_BRIDE_USHER_STAFF,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "招待人員",
      },
      {
        key: KEYS.PROCESSION_BRIDE_HEAD_USHER,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "總招待",
      },
      {
        key: KEYS.PROCESSION_BRIDE_BANQUET_SERVICE_STAFF,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "外場服務生",
      },
      {
        key: KEYS.PROCESSION_BRIDE_WEDDING_PLANNER,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "婚禮企劃",
      },
      {
        key: KEYS.PROCESSION_BRIDE_BRIDAL_ATTENDANT,
        taxonomyItemKey: "ITEM_PROCESSION_BRIDE",
        name: "新娘小管家",
      },
    ],
  },
];

const preparationPresetItems = BUDGET_PREPARATION_PRESET_GROUPS.flatMap(
  (group) => group.items,
);

export const BUDGET_PREPARATION_PRESET_STAGES =
  BUDGET_PREPARATION_PRESET_GROUPS.map((stage) => {
    const itemsByTaxonomy = new Map<
      BudgetPreparationTaxonomyItemKey,
      BudgetPreparationPresetItem[]
    >();
    for (const item of stage.items) {
      const items = itemsByTaxonomy.get(item.taxonomyItemKey) ?? [];
      items.push(item);
      itemsByTaxonomy.set(item.taxonomyItemKey, items);
    }
    return {
      stageKey: stage.stageKey,
      label: stage.label,
      groups: [...itemsByTaxonomy].map(([taxonomyItemKey, items]) => ({
        taxonomyItemKey,
        label: BUDGET_TAXONOMY_NODE_BY_KEY[taxonomyItemKey].label,
        items,
      })),
    };
  });

export type BudgetPreparationCoverageItem = Readonly<{
  taxonomyItemKey: BudgetTaxonomyItemKey;
  name: string;
}>;

function normalizeCoverageName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s·・．。,.，:：;；、／/\\＋+()（）\-_—–]/gu, "");
}

function conservativelyMatchesAlias(name: string, alias: string): boolean {
  const normalizedName = normalizeCoverageName(name);
  const normalizedAlias = normalizeCoverageName(alias);
  if (normalizedName.length === 0 || normalizedAlias.length === 0) return false;
  return normalizedAlias.length < 2
    ? normalizedName === normalizedAlias
    : normalizedName.includes(normalizedAlias);
}

export function coveredBudgetPreparationSuggestionKeys(
  items: readonly BudgetPreparationCoverageItem[],
): Set<BudgetPreparationSuggestionKey> {
  const namesByTaxonomy = new Map<BudgetTaxonomyItemKey, string[]>();
  for (const item of items) {
    const names = namesByTaxonomy.get(item.taxonomyItemKey) ?? [];
    names.push(item.name);
    namesByTaxonomy.set(item.taxonomyItemKey, names);
  }

  const covered = new Set<BudgetPreparationSuggestionKey>();
  for (const suggestion of preparationPresetItems) {
    const existingNames = namesByTaxonomy.get(suggestion.taxonomyItemKey) ?? [];
    const aliases = suggestion.coverageAliases ?? [suggestion.name];
    if (
      existingNames.some((name) =>
        aliases.some((alias) => conservativelyMatchesAlias(name, alias)),
      )
    ) {
      covered.add(suggestion.key);
    }
  }
  return covered;
}
