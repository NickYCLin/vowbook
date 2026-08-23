const MAX_TWD_AMOUNT = 2_147_483_647;

export const BUDGET_BOOKING_STATUS_LABELS = {
  PLANNING: "規劃中",
  BOOKED_BALANCE_DUE: "已下訂，尾款未清",
  PAID: "已付清",
} as const;

export const BUDGET_PRIMARY_CONTACT_LABELS = {
  PARTNER_A: "新郎",
  PARTNER_B: "新娘",
} as const;

export const BUDGET_COST_CATEGORY_LABELS = {
  RINGS_KEEPSAKES: "戒指與信物",
  PHOTOGRAPHY_VIDEO: "攝影與影像",
  ATTIRE_STYLING: "服裝與造型",
  VENUE_CATERING: "場地與餐飲",
  TRANSPORT_LODGING: "交通與住宿",
  DECOR_GIFTS: "佈置與禮品",
  PEOPLE_SERVICES: "人員與服務",
  OTHER_PENDING: "其他／待整理",
} as const;

export const SELECTABLE_BUDGET_COST_CATEGORIES = [
  "RINGS_KEEPSAKES",
  "PHOTOGRAPHY_VIDEO",
  "ATTIRE_STYLING",
  "VENUE_CATERING",
  "TRANSPORT_LODGING",
  "DECOR_GIFTS",
  "PEOPLE_SERVICES",
] as const;

export const BUDGET_COST_CATEGORIES = Object.keys(
  BUDGET_COST_CATEGORY_LABELS,
) as Array<keyof typeof BUDGET_COST_CATEGORY_LABELS>;

export type BudgetBookingStatus = keyof typeof BUDGET_BOOKING_STATUS_LABELS;
export type BudgetPrimaryContact = keyof typeof BUDGET_PRIMARY_CONTACT_LABELS;
export type BudgetCostCategory = keyof typeof BUDGET_COST_CATEGORY_LABELS;
export type BudgetItemKind = "GROUP" | "EXPENSE";

type BudgetTaxonomyItemDefinition = {
  readonly key: string;
  readonly label: string;
  readonly defaultCategory: BudgetCostCategory;
};

type BudgetTaxonomyStageDefinition = {
  readonly key: string;
  readonly label: string;
  readonly items: readonly BudgetTaxonomyItemDefinition[];
};

export const BUDGET_TAXONOMY_STAGES = [
  {
    key: "STAGE_PREPARATION_1_2_MONTHS",
    label: "籌備第1-2月",
    items: [
      { key: "ITEM_PROPOSAL", label: "求婚", defaultCategory: "RINGS_KEEPSAKES" },
      { key: "ITEM_WEDDING_VENUE", label: "婚宴場地", defaultCategory: "VENUE_CATERING" },
      { key: "ITEM_PRE_WEDDING_PHOTOGRAPHY", label: "婚紗照拍攝", defaultCategory: "PHOTOGRAPHY_VIDEO" },
    ],
  },
  {
    key: "STAGE_PREPARATION_3_MONTH",
    label: "籌備第3個月",
    items: [
      { key: "ITEM_WEDDING_CAKES", label: "喜餅", defaultCategory: "DECOR_GIFTS" },
      { key: "ITEM_BRIDAL_STYLIST", label: "新娘秘書", defaultCategory: "ATTIRE_STYLING" },
      { key: "ITEM_WEDDING_PHOTOGRAPHY", label: "婚禮攝影", defaultCategory: "PHOTOGRAPHY_VIDEO" },
      { key: "ITEM_WEDDING_VIDEOGRAPHY", label: "婚禮錄影", defaultCategory: "PHOTOGRAPHY_VIDEO" },
      { key: "ITEM_WEDDING_HOST", label: "婚禮主持", defaultCategory: "PEOPLE_SERVICES" },
      { key: "ITEM_WEDDING_BAND", label: "婚禮樂團", defaultCategory: "PEOPLE_SERVICES" },
      { key: "ITEM_WEDDING_INTERACTION", label: "婚禮互動", defaultCategory: "PEOPLE_SERVICES" },
    ],
  },
  {
    key: "STAGE_PREPARATION_4_MONTH",
    label: "籌備婚禮第4個月",
    items: [
      { key: "ITEM_ATTIRE_RENTAL", label: "禮服租借", defaultCategory: "ATTIRE_STYLING" },
      { key: "ITEM_WEDDING_SHOES", label: "婚鞋", defaultCategory: "ATTIRE_STYLING" },
      { key: "ITEM_WEDDING_DECOR", label: "婚禮佈置", defaultCategory: "DECOR_GIFTS" },
    ],
  },
  {
    key: "STAGE_COUNTDOWN_2_MONTHS",
    label: "婚禮前倒數2個月",
    items: [
      { key: "ITEM_INVITATIONS_POSTAGE", label: "印喜帖及寄送", defaultCategory: "DECOR_GIFTS" },
      { key: "ITEM_BEAUTY_TREATMENTS", label: "保養療程", defaultCategory: "ATTIRE_STYLING" },
      { key: "ITEM_WEDDING_FAVORS", label: "婚禮小物", defaultCategory: "DECOR_GIFTS" },
    ],
  },
  {
    key: "STAGE_ENGAGEMENT_CEREMONY",
    label: "文定儀式用品、工作人員紅包",
    items: [
      { key: "ITEM_ENGAGEMENT_GROOM", label: "文定儀式（男方準備）", defaultCategory: "DECOR_GIFTS" },
      { key: "ITEM_ENGAGEMENT_BRIDE", label: "文定儀式（女方準備）", defaultCategory: "DECOR_GIFTS" },
    ],
  },
  {
    key: "STAGE_WEDDING_PROCESSION",
    label: "迎娶儀式用品、工作人員紅包",
    items: [
      { key: "ITEM_PROCESSION_GROOM", label: "迎娶儀式男方準備", defaultCategory: "DECOR_GIFTS" },
      { key: "ITEM_PROCESSION_BRIDE", label: "迎娶儀式女方準備", defaultCategory: "DECOR_GIFTS" },
    ],
  },
] as const satisfies readonly BudgetTaxonomyStageDefinition[];

export type BudgetTaxonomyStageKey = (typeof BUDGET_TAXONOMY_STAGES)[number]["key"];
export type BudgetTaxonomyItemKey = (typeof BUDGET_TAXONOMY_STAGES)[number]["items"][number]["key"];
export type BudgetTaxonomyNodeKey = BudgetTaxonomyStageKey | BudgetTaxonomyItemKey;

export const BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY =
  "INTERNAL_UNCLASSIFIED_STAGE" as const;
export const BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY =
  "INTERNAL_UNCLASSIFIED_ITEM" as const;

export type BudgetInternalSystemNodeKey =
  | typeof BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY
  | typeof BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY;
export type BudgetSystemNodeKey =
  | BudgetTaxonomyNodeKey
  | BudgetInternalSystemNodeKey;
export type BudgetSystemStageKey =
  | BudgetTaxonomyStageKey
  | typeof BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY;

export type BudgetTaxonomyNode = Readonly<{
  key: BudgetTaxonomyNodeKey;
  label: string;
  kind: "STAGE" | "ITEM";
  parentKey: BudgetTaxonomyStageKey | null;
  sourceOrder: number;
  defaultCategory: BudgetCostCategory | null;
}>;

export type BudgetSystemNode = Readonly<{
  key: BudgetSystemNodeKey;
  label: string;
  kind: "STAGE" | "ITEM";
  parentKey: BudgetSystemStageKey | null;
  sourceOrder: number;
  defaultCategory: BudgetCostCategory | null;
}>;

export const BUDGET_TAXONOMY_NODES: readonly BudgetTaxonomyNode[] =
  BUDGET_TAXONOMY_STAGES.flatMap((stage, stageIndex) => [
    {
      key: stage.key,
      label: stage.label,
      kind: "STAGE" as const,
      parentKey: null,
      sourceOrder: stageIndex + 1,
      defaultCategory: null,
    },
    ...stage.items.map((item, itemIndex) => ({
      key: item.key,
      label: item.label,
      kind: "ITEM" as const,
      parentKey: stage.key,
      sourceOrder: itemIndex + 1,
      defaultCategory: item.defaultCategory,
    })),
  ]);

export const BUDGET_SYSTEM_NODES: readonly BudgetSystemNode[] = [
  ...BUDGET_TAXONOMY_NODES,
  {
    key: BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
    label: "系統保留",
    kind: "STAGE",
    parentKey: null,
    sourceOrder: BUDGET_TAXONOMY_STAGES.length + 1,
    defaultCategory: null,
  },
  {
    key: BUDGET_INTERNAL_UNCLASSIFIED_ITEM_KEY,
    label: "未分類既有項目",
    kind: "ITEM",
    parentKey: BUDGET_INTERNAL_UNCLASSIFIED_STAGE_KEY,
    sourceOrder: 1,
    defaultCategory: "OTHER_PENDING",
  },
];

export const BUDGET_SYSTEM_NODE_BY_KEY = Object.freeze(
  Object.fromEntries(BUDGET_SYSTEM_NODES.map((node) => [node.key, node])) as Record<
    BudgetSystemNodeKey,
    BudgetSystemNode
  >,
);

export const BUDGET_TAXONOMY_NODE_BY_KEY = Object.freeze(
  Object.fromEntries(BUDGET_TAXONOMY_NODES.map((node) => [node.key, node])) as Record<
    BudgetTaxonomyNodeKey,
    BudgetTaxonomyNode
  >,
);

export const BUDGET_TAXONOMY_ITEM_KEYS = Object.freeze(
  BUDGET_TAXONOMY_STAGES.flatMap((stage) => stage.items.map((item) => item.key)) as BudgetTaxonomyItemKey[],
);

export const BUDGET_TAXONOMY_ITEM_LABELS = Object.freeze(
  Object.fromEntries(
    BUDGET_TAXONOMY_STAGES.flatMap((stage) => stage.items.map((item) => [item.key, item.label])),
  ) as Record<BudgetTaxonomyItemKey, string>,
);

export const BUDGET_TAXONOMY_ITEM_DEFAULT_CATEGORIES = Object.freeze(
  Object.fromEntries(
    BUDGET_TAXONOMY_STAGES.flatMap((stage) =>
      stage.items.map((item) => [item.key, item.defaultCategory]),
    ),
  ) as Record<BudgetTaxonomyItemKey, BudgetCostCategory>,
);

const BUDGET_TAXONOMY_ITEM_KEY_SET: ReadonlySet<string> = new Set(BUDGET_TAXONOMY_ITEM_KEYS);

export type BudgetGroupDetailsInput = {
  name: unknown;
  [field: string]: unknown;
};

export type NormalizedBudgetGroupDetails = {
  name: string;
};

export type BudgetItemDetailsInput = {
  name: unknown;
  category: unknown;
  plannedAmount: unknown;
  actualAmount: unknown;
  dueDate: unknown;
  notes: unknown;
  bookingStatus?: unknown;
  depositAmount?: unknown;
  balanceAmount?: unknown;
  additionalAmount?: unknown;
  estimatedRange?: unknown;
  candidateVendors?: unknown;
  confirmedVendor?: unknown;
  vendorContact?: unknown;
  primaryContact?: unknown;
};

export type NormalizedBudgetItemDetails = {
  name: string;
  category: BudgetCostCategory;
  plannedAmount: number;
  actualAmount: number | null;
  dueDate: Date | null;
  notes: string | null;
  bookingStatus: BudgetBookingStatus;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  estimatedRange: string | null;
  candidateVendors: string | null;
  confirmedVendor: string | null;
  vendorContact: string | null;
  primaryContact: BudgetPrimaryContact | null;
};

export class BudgetItemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetItemValidationError";
  }
}

export function isBudgetTaxonomyItemKey(
  value: unknown,
): value is BudgetTaxonomyItemKey {
  return (
    typeof value === "string" && BUDGET_TAXONOMY_ITEM_KEY_SET.has(value)
  );
}

export function normalizeBudgetTaxonomyItemKey(
  value: unknown,
): BudgetTaxonomyItemKey {
  if (!isBudgetTaxonomyItemKey(value)) {
    throw new BudgetItemValidationError("請選擇有效的婚禮花費分類。");
  }

  return value;
}

export function normalizeOptionalBudgetTaxonomyItemKey(
  value: unknown,
): BudgetTaxonomyItemKey | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (!isBudgetTaxonomyItemKey(value)) {
    throw new BudgetItemValidationError("請選擇有效的用途關聯。");
  }

  return value;
}

export function normalizeRelatedBudgetTaxonomyItemKey(
  value: unknown,
  primaryTaxonomyItemKey: BudgetTaxonomyItemKey,
): BudgetTaxonomyItemKey | null {
  const relatedTaxonomyItemKey =
    normalizeOptionalBudgetTaxonomyItemKey(value);

  if (relatedTaxonomyItemKey === primaryTaxonomyItemKey) {
    throw new BudgetItemValidationError(
      "用途關聯不可與主要分類相同。",
    );
  }

  return relatedTaxonomyItemKey;
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeRequiredText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  const normalized =
    typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";

  if (characterCount(normalized) < 1 || characterCount(normalized) > maximum) {
    throw new BudgetItemValidationError(
      `${label}需為 1 到 ${maximum} 個字元。`,
    );
  }

  return normalized;
}

export function normalizeBudgetGroupDetails(
  input: BudgetGroupDetailsInput,
): NormalizedBudgetGroupDetails {
  return { name: normalizeRequiredText(input.name, "群組名稱", 120) };
}

function normalizeAmount(
  value: unknown,
  label: string,
  optional: boolean,
): number | null {
  if (optional && value === "") {
    return null;
  }

  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(value)
  ) {
    throw new BudgetItemValidationError(
      `${label}請輸入 0 到 ${MAX_TWD_AMOUNT} 的整數。`,
    );
  }

  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount > MAX_TWD_AMOUNT) {
    throw new BudgetItemValidationError(
      `${label}請輸入 0 到 ${MAX_TWD_AMOUNT} 的整數。`,
    );
  }

  return amount;
}

function normalizeOptionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new BudgetItemValidationError(`${label}格式無效。`);
  }

  const normalized = value.trim();
  if (normalized === "") {
    return null;
  }
  if (characterCount(normalized) > maximum) {
    throw new BudgetItemValidationError(`${label}最多 ${maximum} 個字元。`);
  }
  return normalized;
}

export function normalizeBudgetBookingStatus(
  value: unknown,
): BudgetBookingStatus {
  if (value === undefined || value === null || value === "") {
    return "PLANNING";
  }
  if (
    value !== "PLANNING" &&
    value !== "BOOKED_BALANCE_DUE" &&
    value !== "PAID"
  ) {
    throw new BudgetItemValidationError("請選擇有效的下訂與付款狀態。");
  }
  return value;
}

export function normalizeBudgetPrimaryContact(
  value: unknown,
): BudgetPrimaryContact | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value !== "PARTNER_A" && value !== "PARTNER_B") {
    throw new BudgetItemValidationError("請選擇有效的主要負責人。");
  }
  return value;
}

export function normalizeBudgetCostCategory(
  value: unknown,
): BudgetCostCategory {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(BUDGET_COST_CATEGORY_LABELS, value)
  ) {
    throw new BudgetItemValidationError("請選擇有效的費用類別。");
  }
  return value as BudgetCostCategory;
}

function normalizeDueDate(value: unknown): Date | null {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    value.startsWith("0000-")
  ) {
    throw new BudgetItemValidationError("請輸入有效的付款期限。");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BudgetItemValidationError("請輸入有效的付款期限。");
  }

  return date;
}

function normalizeNotes(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (characterCount(normalized) > 1000) {
    throw new BudgetItemValidationError("備註最多 1000 個字元。");
  }

  return normalized === "" ? null : normalized;
}

export function normalizeBudgetItemDetails(
  input: BudgetItemDetailsInput,
): NormalizedBudgetItemDetails {
  const depositAmount = normalizeAmount(
    input.depositAmount ?? "",
    "訂金費用",
    true,
  );
  const balanceAmount = normalizeAmount(
    input.balanceAmount ?? "",
    "尾款費用",
    true,
  );
  const additionalAmount = normalizeAmount(
    input.additionalAmount ?? "",
    "加購費用",
    true,
  );
  const hasComponent =
    depositAmount !== null ||
    balanceAmount !== null ||
    additionalAmount !== null;
  let plannedAmount: number;
  if (hasComponent) {
    const componentTotal =
      BigInt(depositAmount ?? 0) +
      BigInt(balanceAmount ?? 0) +
      BigInt(additionalAmount ?? 0);
    if (componentTotal > BigInt(MAX_TWD_AMOUNT)) {
      throw new BudgetItemValidationError(
        `費用組成合計不可超過 ${MAX_TWD_AMOUNT}。`,
      );
    }
    plannedAmount = Number(componentTotal);
  } else {
    plannedAmount = normalizeAmount(
      input.plannedAmount,
      "預計花費",
      false,
    ) as number;
  }

  return {
    name: normalizeRequiredText(input.name, "項目名稱", 120),
    category: normalizeBudgetCostCategory(input.category),
    plannedAmount,
    actualAmount: normalizeAmount(input.actualAmount, "實付金額", true),
    dueDate: normalizeDueDate(input.dueDate),
    notes: normalizeNotes(input.notes),
    bookingStatus: normalizeBudgetBookingStatus(input.bookingStatus),
    depositAmount,
    balanceAmount,
    additionalAmount,
    estimatedRange: normalizeOptionalText(
      input.estimatedRange,
      "預估費用範圍",
      200,
    ),
    candidateVendors: normalizeOptionalText(
      input.candidateVendors,
      "候選廠商或工作人員",
      1000,
    ),
    confirmedVendor: normalizeOptionalText(
      input.confirmedVendor,
      "確定廠商",
      300,
    ),
    vendorContact: normalizeOptionalText(
      input.vendorContact,
      "廠商聯絡人",
      500,
    ),
    primaryContact: normalizeBudgetPrimaryContact(input.primaryContact),
  };
}

const wholeNumberFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  useGrouping: true,
});

export function formatTwdAmount(amount: number | bigint | string): string {
  let normalized: bigint;
  try {
    if (typeof amount === "string") {
      if (!/^(?:0|[1-9]\d*)$/u.test(amount)) {
        throw new RangeError("invalid TWD amount");
      }
      normalized = BigInt(amount);
    } else if (typeof amount === "bigint") {
      normalized = amount;
    } else {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new RangeError("invalid TWD amount");
      }
      normalized = BigInt(amount);
    }
  } catch {
    throw new RangeError("invalid TWD amount");
  }

  if (normalized < BigInt(0)) {
    throw new RangeError("invalid TWD amount");
  }

  return `NT$${wholeNumberFormatter.format(normalized)}`;
}
