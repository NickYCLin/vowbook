#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const MAX_INT32 = 2_147_483_647;
const MAX_SOURCE_HIERARCHY_PATH_LENGTH = 4;
const MAX_TRANSACTION_ATTEMPTS = 3;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ALLOWED_FIELDS = new Set([
  "source",
  "externalId",
  "parentExternalId",
  "sourceOrder",
  "name",
  "depositAmount",
  "balanceAmount",
  "additionalAmount",
  "totalAmount",
  "rollupAmount",
  "estimatedRange",
  "candidateVendors",
  "confirmedVendor",
  "vendorContact",
  "primaryContact",
  "bookingStatus",
  "notes",
]);
const BOOKING_STATUSES = new Set([
  "PLANNING",
  "BOOKED_BALANCE_DUE",
  "PAID",
]);
const LEGACY_CATEGORY_MAP = new Map([
  ["戒指與信物", "RINGS_KEEPSAKES"],
  ["戒指", "RINGS_KEEPSAKES"],
  ["信物", "RINGS_KEEPSAKES"],
  ["婚戒", "RINGS_KEEPSAKES"],
  ["婚戒(求婚戒與對戒)", "RINGS_KEEPSAKES"],
  ["婚戒（求婚戒與對戒）", "RINGS_KEEPSAKES"],
  ["攝影與影像", "PHOTOGRAPHY_VIDEO"],
  ["攝影", "PHOTOGRAPHY_VIDEO"],
  ["影像", "PHOTOGRAPHY_VIDEO"],
  ["錄影", "PHOTOGRAPHY_VIDEO"],
  ["婚禮攝影", "PHOTOGRAPHY_VIDEO"],
  ["服裝與造型", "ATTIRE_STYLING"],
  ["服裝", "ATTIRE_STYLING"],
  ["造型", "ATTIRE_STYLING"],
  ["場地與餐飲", "VENUE_CATERING"],
  ["場地", "VENUE_CATERING"],
  ["餐飲", "VENUE_CATERING"],
  ["交通與住宿", "TRANSPORT_LODGING"],
  ["交通", "TRANSPORT_LODGING"],
  ["住宿", "TRANSPORT_LODGING"],
  ["佈置與禮品", "DECOR_GIFTS"],
  ["佈置", "DECOR_GIFTS"],
  ["禮品", "DECOR_GIFTS"],
  ["人員與服務", "PEOPLE_SERVICES"],
  ["人員", "PEOPLE_SERVICES"],
  ["服務", "PEOPLE_SERVICES"],
]);
const BUDGET_SYSTEM_ITEM_KEYS = Object.freeze([
  "ITEM_PROPOSAL",
  "ITEM_WEDDING_VENUE",
  "ITEM_PRE_WEDDING_PHOTOGRAPHY",
  "ITEM_WEDDING_CAKES",
  "ITEM_BRIDAL_STYLIST",
  "ITEM_WEDDING_PHOTOGRAPHY",
  "ITEM_WEDDING_VIDEOGRAPHY",
  "ITEM_WEDDING_HOST",
  "ITEM_WEDDING_BAND",
  "ITEM_WEDDING_INTERACTION",
  "ITEM_ATTIRE_RENTAL",
  "ITEM_WEDDING_SHOES",
  "ITEM_WEDDING_DECOR",
  "ITEM_INVITATIONS_POSTAGE",
  "ITEM_BEAUTY_TREATMENTS",
  "ITEM_WEDDING_FAVORS",
  "ITEM_ENGAGEMENT_GROOM",
  "ITEM_ENGAGEMENT_BRIDE",
  "ITEM_PROCESSION_GROOM",
  "ITEM_PROCESSION_BRIDE",
  "INTERNAL_UNCLASSIFIED_ITEM",
]);
const DEFAULT_TAXONOMY_ITEM_BY_CATEGORY = Object.freeze({
  RINGS_KEEPSAKES: "ITEM_PROPOSAL",
  PHOTOGRAPHY_VIDEO: "ITEM_WEDDING_PHOTOGRAPHY",
  ATTIRE_STYLING: "ITEM_ATTIRE_RENTAL",
  VENUE_CATERING: "ITEM_WEDDING_VENUE",
  TRANSPORT_LODGING: "INTERNAL_UNCLASSIFIED_ITEM",
  DECOR_GIFTS: "ITEM_WEDDING_DECOR",
  PEOPLE_SERVICES: "ITEM_WEDDING_HOST",
  OTHER_PENDING: "INTERNAL_UNCLASSIFIED_ITEM",
});
const EXACT_TAXONOMY_ITEM_BY_LABEL = new Map([
  ["提親", { itemKey: "ITEM_PROPOSAL", category: "RINGS_KEEPSAKES" }],
  ["求婚", { itemKey: "ITEM_PROPOSAL", category: "RINGS_KEEPSAKES" }],
  ["婚戒", { itemKey: "ITEM_PROPOSAL", category: "RINGS_KEEPSAKES" }],
  [
    "婚戒(求婚戒與對戒)",
    { itemKey: "ITEM_PROPOSAL", category: "RINGS_KEEPSAKES" },
  ],
  [
    "婚戒（求婚戒與對戒）",
    { itemKey: "ITEM_PROPOSAL", category: "RINGS_KEEPSAKES" },
  ],
  ["婚宴場地", { itemKey: "ITEM_WEDDING_VENUE", category: "VENUE_CATERING" }],
  [
    "婚紗照拍攝",
    {
      itemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      category: "PHOTOGRAPHY_VIDEO",
    },
  ],
  ["喜餅", { itemKey: "ITEM_WEDDING_CAKES", category: "DECOR_GIFTS" }],
  ["新娘秘書", { itemKey: "ITEM_BRIDAL_STYLIST", category: "ATTIRE_STYLING" }],
  [
    "婚禮攝影",
    { itemKey: "ITEM_WEDDING_PHOTOGRAPHY", category: "PHOTOGRAPHY_VIDEO" },
  ],
  [
    "婚禮錄影",
    { itemKey: "ITEM_WEDDING_VIDEOGRAPHY", category: "PHOTOGRAPHY_VIDEO" },
  ],
  ["婚禮主持", { itemKey: "ITEM_WEDDING_HOST", category: "PEOPLE_SERVICES" }],
  ["婚禮樂團", { itemKey: "ITEM_WEDDING_BAND", category: "PEOPLE_SERVICES" }],
  [
    "婚禮互動",
    { itemKey: "ITEM_WEDDING_INTERACTION", category: "PEOPLE_SERVICES" },
  ],
  ["禮服租借", { itemKey: "ITEM_ATTIRE_RENTAL", category: "ATTIRE_STYLING" }],
  ["婚鞋", { itemKey: "ITEM_WEDDING_SHOES", category: "ATTIRE_STYLING" }],
  ["婚禮佈置", { itemKey: "ITEM_WEDDING_DECOR", category: "DECOR_GIFTS" }],
  [
    "印喜帖及寄送",
    { itemKey: "ITEM_INVITATIONS_POSTAGE", category: "DECOR_GIFTS" },
  ],
  [
    "保養療程",
    { itemKey: "ITEM_BEAUTY_TREATMENTS", category: "ATTIRE_STYLING" },
  ],
  ["婚禮小物", { itemKey: "ITEM_WEDDING_FAVORS", category: "DECOR_GIFTS" }],
  [
    "文定儀式（男方準備）",
    { itemKey: "ITEM_ENGAGEMENT_GROOM", category: "DECOR_GIFTS" },
  ],
  [
    "文定儀式（女方準備）",
    { itemKey: "ITEM_ENGAGEMENT_BRIDE", category: "DECOR_GIFTS" },
  ],
  [
    "迎娶儀式男方準備",
    { itemKey: "ITEM_PROCESSION_GROOM", category: "DECOR_GIFTS" },
  ],
  [
    "迎娶儀式女方準備",
    { itemKey: "ITEM_PROCESSION_BRIDE", category: "DECOR_GIFTS" },
  ],
  [
    "迎娶儀式（男方準備）",
    { itemKey: "ITEM_PROCESSION_GROOM", category: "DECOR_GIFTS" },
  ],
  [
    "迎娶儀式（女方準備）",
    { itemKey: "ITEM_PROCESSION_BRIDE", category: "DECOR_GIFTS" },
  ],
]);

const NOTION_PRE_WEDDING_PHOTOGRAPHY_ROUTE = Object.freeze({
  itemKey: "ITEM_PRE_WEDDING_PHOTOGRAPHY",
  category: "PHOTOGRAPHY_VIDEO",
});
const NOTION_RECEPTION_DEFAULT_ROUTE = Object.freeze({
  itemKey: "INTERNAL_UNCLASSIFIED_ITEM",
  category: "OTHER_PENDING",
});
const NOTION_RECEPTION_PHOTOGRAPHY_ROUTE = Object.freeze({
  itemKey: "ITEM_WEDDING_PHOTOGRAPHY",
  category: "PHOTOGRAPHY_VIDEO",
});

const NOTION_RECEPTION_BRANCH_ROUTES = new Map([
  [
    "宴客場地",
    { itemKey: "ITEM_WEDDING_VENUE", category: "VENUE_CATERING" },
  ],
  [
    "宴客婚紗廠商",
    { itemKey: "ITEM_ATTIRE_RENTAL", category: "ATTIRE_STYLING" },
  ],
  [
    "新娘秘書",
    { itemKey: "ITEM_BRIDAL_STYLIST", category: "ATTIRE_STYLING" },
  ],
  [
    "婚禮主持人",
    { itemKey: "ITEM_WEDDING_HOST", category: "PEOPLE_SERVICES" },
  ],
  [
    "婚禮小物",
    { itemKey: "ITEM_WEDDING_FAVORS", category: "DECOR_GIFTS" },
  ],
  [
    "喜餅",
    { itemKey: "ITEM_WEDDING_CAKES", category: "DECOR_GIFTS" },
  ],
  [
    "拍拍印",
    { itemKey: "ITEM_WEDDING_INTERACTION", category: "PEOPLE_SERVICES" },
  ],
  [
    "印卡讚",
    { itemKey: "ITEM_WEDDING_INTERACTION", category: "PEOPLE_SERVICES" },
  ],
]);
const NOTION_RECEPTION_MEDIA_ROUTES = new Map([
  [
    "平面",
    { itemKey: "ITEM_WEDDING_PHOTOGRAPHY", category: "PHOTOGRAPHY_VIDEO" },
  ],
  [
    "動態",
    { itemKey: "ITEM_WEDDING_VIDEOGRAPHY", category: "PHOTOGRAPHY_VIDEO" },
  ],
]);

function notionPreWeddingPhotographyRouteFor(record, byExternalId) {
  let current = record;
  while (current) {
    if (current.name === "婚紗拍攝") {
      return NOTION_PRE_WEDDING_PHOTOGRAPHY_ROUTE;
    }
    current =
      current.parentExternalId === null
        ? null
        : (byExternalId.get(current.parentExternalId) ?? null);
  }
  return null;
}

function notionReceptionRouteFor(record, byExternalId) {
  let current = record;
  let nearestBranchRoute = null;
  let nearestMediaRoute = null;
  while (current) {
    nearestBranchRoute ??=
      NOTION_RECEPTION_BRANCH_ROUTES.get(current.name) ?? null;
    nearestMediaRoute ??=
      NOTION_RECEPTION_MEDIA_ROUTES.get(current.name) ?? null;
    if (
      current.name === "婚禮攝影廠商" &&
      nearestBranchRoute === null
    ) {
      nearestBranchRoute =
        nearestMediaRoute ?? NOTION_RECEPTION_PHOTOGRAPHY_ROUTE;
    }
    if (current.name === "宴客") {
      return nearestBranchRoute ?? NOTION_RECEPTION_DEFAULT_ROUTE;
    }
    current =
      current.parentExternalId === null
        ? null
        : (byExternalId.get(current.parentExternalId) ?? null);
  }
  return null;
}

function budgetTaxonomyRouteForRootName(rootName) {
  const exactRoute = EXACT_TAXONOMY_ITEM_BY_LABEL.get(rootName);
  if (exactRoute) return exactRoute;

  const category = LEGACY_CATEGORY_MAP.get(rootName) ?? "OTHER_PENDING";
  return {
    itemKey: DEFAULT_TAXONOMY_ITEM_BY_CATEGORY[category],
    category,
  };
}
const PRIMARY_CONTACTS = new Set(["PARTNER_A", "PARTNER_B"]);
const MANIFEST_AGGREGATE_KEYS = [
  "recordCount",
  "uniqueExternalIds",
  "rootCount",
  "parentCount",
  "leafCount",
  "maxDepth",
  "paidCount",
  "bookedBalanceDueCount",
  "planningCount",
  "rootRollupTotal",
  "formulaMismatchCount",
];
const MANIFEST_KEYS = new Set([
  "version",
  "source",
  "inputSha256",
  ...MANIFEST_AGGREGATE_KEYS,
]);
const EXPECTED_AGGREGATES = Object.freeze({
  recordCount: 37,
  uniqueExternalIds: 37,
  rootCount: 3,
  parentCount: 10,
  leafCount: 27,
  maxDepth: 3,
  paidCount: 18,
  bookedBalanceDueCount: 7,
  planningCount: 12,
  rootRollupTotal: 853_185,
  formulaMismatchCount: 0,
});

export const NOTION_BUDGET_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class NotionBudgetValidationError extends Error {
  constructor(message = "匯入資料驗證失敗。") {
    super(message);
    this.name = "NotionBudgetValidationError";
  }
}

export class NotionBudgetImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotionBudgetImportError";
  }
}

function validationFailure() {
  throw new NotionBudgetValidationError();
}

function codePointCount(value) {
  return Array.from(value).length;
}

function requiredString(record, field, maximum) {
  const value = record[field];
  if (typeof value !== "string") validationFailure();
  const normalized = value.trim();
  if (normalized === "" || codePointCount(normalized) > maximum) {
    validationFailure();
  }
  return normalized;
}

function optionalString(record, field, maximum) {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== "string") validationFailure();
  const normalized = value.trim();
  if (normalized === "" || codePointCount(normalized) > maximum) {
    validationFailure();
  }
  return normalized;
}

function requiredInteger(record, field) {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_INT32
  ) {
    validationFailure();
  }
  return value;
}

function nullableInteger(record, field) {
  if (record[field] === null) return null;
  return requiredInteger(record, field);
}

function normalizedRecord(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== ALLOWED_FIELDS.size ||
    Object.keys(value).some((key) => !ALLOWED_FIELDS.has(key))
  ) {
    validationFailure();
  }
  if (value.source !== "NOTION") validationFailure();
  const externalId = value.externalId;
  if (
    typeof externalId !== "string" ||
    externalId !== externalId.trim() ||
    !UUID_PATTERN.test(externalId)
  ) {
    validationFailure();
  }
  let parentExternalId = null;
  if (value.parentExternalId !== null) {
    parentExternalId = value.parentExternalId;
    if (
      typeof parentExternalId !== "string" ||
      parentExternalId !== parentExternalId.trim() ||
      !UUID_PATTERN.test(parentExternalId)
    ) {
      validationFailure();
    }
  }
  const bookingStatus = value.bookingStatus;
  if (typeof bookingStatus !== "string" || !BOOKING_STATUSES.has(bookingStatus)) {
    validationFailure();
  }
  const primaryContact = value.primaryContact;
  if (primaryContact !== null && !PRIMARY_CONTACTS.has(primaryContact)) {
    validationFailure();
  }
  const depositAmount = nullableInteger(value, "depositAmount");
  const balanceAmount = nullableInteger(value, "balanceAmount");
  const additionalAmount = nullableInteger(value, "additionalAmount");
  const plannedBigInt =
    BigInt(depositAmount ?? 0) +
    BigInt(balanceAmount ?? 0) +
    BigInt(additionalAmount ?? 0);
  if (plannedBigInt > BigInt(MAX_INT32)) validationFailure();
  const plannedAmount = Number(plannedBigInt);
  const totalAmount = requiredInteger(value, "totalAmount");
  const rollupAmount = requiredInteger(value, "rollupAmount");

  return {
    source: "NOTION",
    externalId,
    parentExternalId,
    sourceOrder: requiredInteger(value, "sourceOrder"),
    name: requiredString(value, "name", 120),
    kind: "EXPENSE",
    category: "OTHER_PENDING",
    legacyCategory: "",
    plannedAmount,
    actualAmount:
      bookingStatus === "PAID"
        ? plannedAmount
        : bookingStatus === "BOOKED_BALANCE_DUE"
          ? depositAmount
          : null,
    dueDate: null,
    notes: optionalString(value, "notes", 1000),
    paid: bookingStatus === "PAID",
    paidAt: null,
    bookingStatus,
    depositAmount,
    balanceAmount,
    additionalAmount,
    estimatedRange: optionalString(value, "estimatedRange", 200),
    candidateVendors: optionalString(value, "candidateVendors", 1000),
    confirmedVendor: optionalString(value, "confirmedVendor", 300),
    vendorContact: optionalString(value, "vendorContact", 500),
    primaryContact,
    totalAmount,
    rollupAmount,
    depth: 0,
    sourceHierarchyPath: [],
    sourceHash: "",
    previousSourceHash: "",
    legacySourceHash: "",
  };
}

function canonicalHashPayload(record, version = 3) {
  const legacy = version === 1;
  return {
    version,
    source: record.source,
    externalId: record.externalId,
    parentExternalId: record.parentExternalId ?? null,
    sourceOrder: record.sourceOrder,
    name: record.name,
    ...(legacy ? {} : { kind: record.kind }),
    category: legacy ? record.legacyCategory : record.category,
    plannedAmount: record.plannedAmount,
    actualAmount: record.actualAmount ?? null,
    dueDate:
      record.dueDate instanceof Date
        ? record.dueDate.toISOString().slice(0, 10)
        : (record.dueDate ?? null),
    notes: record.notes ?? null,
    paid: record.paid,
    paidAt:
      record.paidAt instanceof Date
        ? record.paidAt.toISOString()
        : (record.paidAt ?? null),
    bookingStatus: record.bookingStatus,
    depositAmount: record.depositAmount ?? null,
    balanceAmount: record.balanceAmount ?? null,
    additionalAmount: record.additionalAmount ?? null,
    estimatedRange: record.estimatedRange ?? null,
    candidateVendors: record.candidateVendors ?? null,
    confirmedVendor: record.confirmedVendor ?? null,
    vendorContact: record.vendorContact ?? null,
    primaryContact: record.primaryContact ?? null,
    ...(version >= 3
      ? { sourceHierarchyPath: record.sourceHierarchyPath ?? [] }
      : {}),
  };
}

export function computeNotionBudgetSourceHash(record) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalHashPayload(record)), "utf8")
    .digest("hex");
}

function computeLegacyNotionBudgetSourceHash(record) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalHashPayload(record, 1)), "utf8")
    .digest("hex");
}

function computePreviousNotionBudgetSourceHash(record) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalHashPayload(record, 2)), "utf8")
    .digest("hex");
}

function enrichAndValidateHierarchy(records) {
  const byExternalId = new Map();
  const childrenByParent = new Map();
  for (const record of records) {
    if (byExternalId.has(record.externalId)) validationFailure();
    byExternalId.set(record.externalId, record);
  }
  for (const record of records) {
    if (record.parentExternalId === record.externalId) validationFailure();
    if (record.parentExternalId !== null) {
      if (!byExternalId.has(record.parentExternalId)) validationFailure();
      const children = childrenByParent.get(record.parentExternalId) ?? [];
      children.push(record);
      childrenByParent.set(record.parentExternalId, children);
    }
  }

  const depthMemo = new Map();
  const rootMemo = new Map();
  function resolveAncestry(start) {
    const chain = [];
    const seen = new Set();
    let current = start;
    while (current.parentExternalId !== null) {
      if (seen.has(current.externalId)) validationFailure();
      seen.add(current.externalId);
      chain.push(current);
      current = byExternalId.get(current.parentExternalId);
      if (!current) validationFailure();
    }
    if (seen.has(current.externalId)) validationFailure();
    const root = current;
    const rootDepth = 0;
    depthMemo.set(root.externalId, rootDepth);
    rootMemo.set(root.externalId, root);
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const child = chain[index];
      const parent = byExternalId.get(child.parentExternalId);
      const parentDepth = depthMemo.get(parent.externalId);
      if (parentDepth === undefined) validationFailure();
      depthMemo.set(child.externalId, parentDepth + 1);
      rootMemo.set(child.externalId, root);
    }
  }
  for (const record of records) resolveAncestry(record);

  for (const record of records) {
    const immediateChildTotal = (childrenByParent.get(record.externalId) ?? [])
      .reduce((sum, child) => sum + BigInt(child.totalAmount), BigInt(0));
    if (
      immediateChildTotal > BigInt(MAX_INT32) ||
      Number(immediateChildTotal) !== record.rollupAmount ||
      BigInt(record.plannedAmount) + immediateChildTotal !==
        BigInt(record.totalAmount)
    ) {
      validationFailure();
    }
    const root = rootMemo.get(record.externalId);
    const depth = depthMemo.get(record.externalId);
    if (!root || depth === undefined) validationFailure();
    if (codePointCount(root.name) > 60) validationFailure();
    const children = childrenByParent.get(record.externalId) ?? [];
    const neutralDirectFields =
      record.plannedAmount === 0 &&
      record.actualAmount === null &&
      record.depositAmount === null &&
      record.balanceAmount === null &&
      record.additionalAmount === null &&
      record.paidAt === null &&
      record.dueDate === null &&
      record.bookingStatus === "PLANNING" &&
      record.paid === false &&
      record.estimatedRange === null &&
      record.candidateVendors === null &&
      record.confirmedVendor === null &&
      record.vendorContact === null &&
      record.primaryContact === null &&
      record.notes === null;
    const preWeddingPhotographyRoute =
      notionPreWeddingPhotographyRouteFor(record, byExternalId);
    const receptionRoute =
      notionReceptionRouteFor(record, byExternalId);
    const importRoute = preWeddingPhotographyRoute ?? receptionRoute;
    record.kind =
      children.length > 0 && neutralDirectFields ? "GROUP" : "EXPENSE";
    record.legacyCategory = root.name;
    record.importTaxonomyItemKey =
      importRoute?.itemKey ?? null;
    record.category =
      record.kind === "GROUP"
        ? null
        : (importRoute?.category ??
          LEGACY_CATEGORY_MAP.get(root.name) ??
          "OTHER_PENDING");
    record.relatedTaxonomyItemKey = null;
    record.depth = depth;
    const sourceHierarchyPath = [];
    let sourceAncestor = record;
    while (sourceAncestor) {
      sourceHierarchyPath.unshift(sourceAncestor.name);
      sourceAncestor =
        sourceAncestor.parentExternalId === null
          ? null
          : (byExternalId.get(sourceAncestor.parentExternalId) ?? null);
    }
    if (
      sourceHierarchyPath.length !== depth + 1 ||
      sourceHierarchyPath.length > MAX_SOURCE_HIERARCHY_PATH_LENGTH
    ) {
      validationFailure();
    }
    record.sourceHierarchyPath = sourceHierarchyPath;
    record.legacySourceHash = computeLegacyNotionBudgetSourceHash(record);
    record.previousSourceHash = computePreviousNotionBudgetSourceHash(record);
    record.sourceHash = computeNotionBudgetSourceHash(record);
  }
}

export function computeNotionBudgetManifestAggregates(records) {
  const parentIds = new Set(
    records
      .map((record) => record.parentExternalId)
      .filter((value) => value !== null),
  );
  return {
    recordCount: records.length,
    uniqueExternalIds: new Set(records.map((record) => record.externalId)).size,
    rootCount: records.filter((record) => record.parentExternalId === null).length,
    parentCount: parentIds.size,
    leafCount: records.filter((record) => !parentIds.has(record.externalId)).length,
    maxDepth: records.reduce((maximum, record) => Math.max(maximum, record.depth), 0),
    paidCount: records.filter((record) => record.bookingStatus === "PAID").length,
    bookedBalanceDueCount: records.filter(
      (record) => record.bookingStatus === "BOOKED_BALANCE_DUE",
    ).length,
    planningCount: records.filter(
      (record) => record.bookingStatus === "PLANNING",
    ).length,
    rootRollupTotal: records
      .filter((record) => record.parentExternalId === null)
      .reduce((sum, record) => sum + record.totalAmount, 0),
    formulaMismatchCount: 0,
  };
}

function hasExpectedAggregates(aggregates) {
  return MANIFEST_AGGREGATE_KEYS.every(
    (key) => aggregates[key] === EXPECTED_AGGREGATES[key],
  );
}

export function parseNormalizedNotionBudgetJson(json) {
  try {
    const value = JSON.parse(json);
    if (!Array.isArray(value) || value.length !== EXPECTED_AGGREGATES.recordCount) {
      validationFailure();
    }
    const records = value.map(normalizedRecord);
    enrichAndValidateHierarchy(records);
    if (!hasExpectedAggregates(computeNotionBudgetManifestAggregates(records))) {
      validationFailure();
    }
    return records;
  } catch (error) {
    if (error instanceof NotionBudgetValidationError) throw error;
    throw new NotionBudgetValidationError();
  }
}

export function parseAndValidateNotionBudgetManifestJson(
  manifestJson,
  inputBytes,
  records,
) {
  let manifest;
  try {
    manifest = JSON.parse(manifestJson);
  } catch {
    throw new NotionBudgetImportError("匿名 manifest 格式無效。");
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest) ||
    Object.keys(manifest).length !== MANIFEST_KEYS.size ||
    Object.keys(manifest).some((key) => !MANIFEST_KEYS.has(key)) ||
    manifest.version !== 1 ||
    manifest.source !== "NOTION" ||
    typeof manifest.inputSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(manifest.inputSha256) ||
    MANIFEST_AGGREGATE_KEYS.some(
      (key) =>
        typeof manifest[key] !== "number" ||
        !Number.isSafeInteger(manifest[key]) ||
        manifest[key] < 0,
    )
  ) {
    throw new NotionBudgetImportError("匿名 manifest 格式無效。");
  }
  const actualHash = createHash("sha256").update(inputBytes).digest("hex");
  const aggregates = computeNotionBudgetManifestAggregates(records);
  if (
    manifest.inputSha256 !== actualHash ||
    !hasExpectedAggregates(manifest) ||
    MANIFEST_AGGREGATE_KEYS.some((key) => manifest[key] !== aggregates[key])
  ) {
    throw new NotionBudgetImportError("匿名 manifest 與匯入資料不符。");
  }
  return manifest;
}

function summaryFor(records, apply) {
  const aggregates = computeNotionBudgetManifestAggregates(records);
  return {
    mode: apply ? "apply" : "dry-run",
    applied: false,
    input: records.length,
    create: 0,
    unchanged: 0,
    conflict: 0,
    roots: aggregates.rootCount,
    parents: aggregates.parentCount,
    maximumDepth: aggregates.maxDepth,
    plannedTotal: String(aggregates.rootRollupTotal),
  };
}

function persistentFields(record) {
  return {
    source: record.source,
    externalId: record.externalId,
    sourceHash: record.sourceHash,
    sourceOrder: record.sourceOrder,
    sourceHierarchyPath: record.sourceHierarchyPath,
    name: record.name,
    kind: record.kind,
    category: record.category,
    relatedTaxonomyItemKey: record.relatedTaxonomyItemKey,
    plannedAmount: record.plannedAmount,
    actualAmount: record.actualAmount,
    dueDate: null,
    notes: record.notes,
    paid: record.paid,
    paidAt: null,
    bookingStatus: record.bookingStatus,
    depositAmount: record.depositAmount,
    balanceAmount: record.balanceAmount,
    additionalAmount: record.additionalAmount,
    estimatedRange: record.estimatedRange,
    candidateVendors: record.candidateVendors,
    confirmedVendor: record.confirmedVendor,
    vendorContact: record.vendorContact,
    primaryContact: record.primaryContact,
  };
}

function projectionHash(row, parentExternalId) {
  return computeNotionBudgetSourceHash({
    ...row,
    parentExternalId,
  });
}

function importHierarchy(records) {
  const byExternalId = new Map(
    records.map((record) => [record.externalId, record]),
  );
  const rootExternalId = (record) => {
    let current = record;
    const visited = new Set();
    while (current.parentExternalId !== null) {
      if (visited.has(current.externalId)) {
        throw new NotionBudgetImportError("匯入階層包含循環。");
      }
      visited.add(current.externalId);
      const parent = byExternalId.get(current.parentExternalId);
      if (!parent) {
        throw new NotionBudgetImportError("匯入階層引用不存在的上層項目。");
      }
      current = parent;
    }
    return current.externalId;
  };
  const rootTaxonomyItemKeyByExternalId = new Map(
    records
      .filter((record) => record.parentExternalId === null)
      .map((record) => {
        const route = budgetTaxonomyRouteForRootName(record.name);
        const subtreeMatchesCandidate = records.every(
          (candidate) =>
            rootExternalId(candidate) !== record.externalId ||
            candidate.kind !== "EXPENSE" ||
            candidate.category === route.category,
        );
        return [
          record.externalId,
          route.itemKey === "INTERNAL_UNCLASSIFIED_ITEM" || subtreeMatchesCandidate
            ? route.itemKey
            : "INTERNAL_UNCLASSIFIED_ITEM",
        ];
      }),
  );

  const taxonomyItemKeyByExternalId = new Map(
    records.map((record) => [
      record.externalId,
      record.importTaxonomyItemKey ??
        rootTaxonomyItemKeyByExternalId.get(rootExternalId(record)),
    ]),
  );
  const importParentByExternalId = new Map(
    records.map((record) => {
      const taxonomyItemKey = taxonomyItemKeyByExternalId.get(
        record.externalId,
      );
      const sourceParentTaxonomyItemKey =
        record.parentExternalId === null
          ? null
          : taxonomyItemKeyByExternalId.get(record.parentExternalId);
      const preserveSourceParent =
        record.parentExternalId !== null &&
        sourceParentTaxonomyItemKey === taxonomyItemKey;
      return [
        record.externalId,
        {
          fixedTaxonomyItemKey: preserveSourceParent ? null : taxonomyItemKey,
          parentExternalId: preserveSourceParent
            ? record.parentExternalId
            : null,
        },
      ];
    }),
  );
  const depth = (record) => {
    let value = 0;
    let current = record;
    while (current.parentExternalId !== null) {
      current = byExternalId.get(current.parentExternalId);
      value += 1;
    }
    return value;
  };
  return {
    orderedRecords: [...records].sort((left, right) => depth(left) - depth(right)),
    importParentByExternalId,
  };
}

async function planAndApply(transaction, workspaceId, records, apply) {
  const workspace = await transaction.weddingWorkspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    throw new NotionBudgetImportError("指定的婚宴工作區不存在。");
  }

  const existing = await transaction.budgetItem.findMany({
    where: { workspaceId, source: "NOTION" },
    select: {
      id: true,
      parentId: true,
      source: true,
      externalId: true,
      sourceHash: true,
      sourceOrder: true,
      sourceHierarchyPath: true,
      name: true,
      kind: true,
      category: true,
      relatedTaxonomyItemKey: true,
      plannedAmount: true,
      actualAmount: true,
      dueDate: true,
      notes: true,
      paid: true,
      paidAt: true,
      bookingStatus: true,
      depositAmount: true,
      balanceAmount: true,
      additionalAmount: true,
      estimatedRange: true,
      candidateVendors: true,
      confirmedVendor: true,
      vendorContact: true,
      primaryContact: true,
      parent: { select: { externalId: true, systemTaxonomyKey: true } },
    },
  });
  const summary = summaryFor(records, apply);
  const { orderedRecords, importParentByExternalId } =
    importHierarchy(records);
  if (existing.length === 0) {
    summary.create = records.length;
    if (!apply) return summary;

    const fixedItems = await transaction.budgetItem.findMany({
      where: {
        workspaceId,
        kind: "GROUP",
        systemTaxonomyKey: { in: BUDGET_SYSTEM_ITEM_KEYS },
      },
      select: { id: true, systemTaxonomyKey: true },
    });
    const fixedIdByTaxonomyItem = new Map(
      fixedItems.map((item) => [item.systemTaxonomyKey, item.id]),
    );
    if (fixedIdByTaxonomyItem.size !== BUDGET_SYSTEM_ITEM_KEYS.length) {
      throw new NotionBudgetImportError("婚禮品項分類尚未準備完成。");
    }
    const nativeIdByExternalId = new Map();
    for (const record of orderedRecords) {
      const importParent = importParentByExternalId.get(record.externalId);
      const parentId = importParent?.fixedTaxonomyItemKey
        ? fixedIdByTaxonomyItem.get(importParent.fixedTaxonomyItemKey)
        : importParent?.parentExternalId
          ? nativeIdByExternalId.get(importParent.parentExternalId)
          : null;
      if (!parentId) {
        throw new NotionBudgetImportError(
          "匯入交易失敗，沒有寫入任何資料。",
        );
      }
      const created = await transaction.budgetItem.create({
        data: {
          workspaceId,
          parentId,
          systemTaxonomyKey: null,
          ...persistentFields(record),
        },
        select: { id: true },
      });
      nativeIdByExternalId.set(record.externalId, created.id);
    }
    summary.applied = true;
    return summary;
  }

  const inputByExternalId = new Map(
    records.map((record) => [record.externalId, record]),
  );
  const existingByExternalId = new Map(
    existing.map((row) => [row.externalId, row]),
  );
  if (existing.length !== records.length) {
    summary.conflict = Math.max(1, Math.abs(existing.length - records.length));
    return summary;
  }
  for (const record of records) {
    const row = existingByExternalId.get(record.externalId);
    const importParent = importParentByExternalId.get(record.externalId);
    const parentMatches = importParent?.fixedTaxonomyItemKey
      ? row?.parent?.systemTaxonomyKey === importParent.fixedTaxonomyItemKey
      : row?.parent?.externalId === importParent?.parentExternalId;
    const sourceHierarchyPathMatches =
      Array.isArray(row?.sourceHierarchyPath) &&
      row.sourceHierarchyPath.length === record.sourceHierarchyPath.length &&
      row.sourceHierarchyPath.every(
        (segment, index) => segment === record.sourceHierarchyPath[index],
      );
    if (
      !row ||
      (row.sourceHash !== record.sourceHash &&
        row.sourceHash !== record.previousSourceHash &&
        row.sourceHash !== record.legacySourceHash) ||
      projectionHash(row, record.parentExternalId) !== record.sourceHash ||
      !sourceHierarchyPathMatches ||
      row.relatedTaxonomyItemKey !== record.relatedTaxonomyItemKey ||
      !parentMatches
    ) {
      summary.conflict += 1;
    } else {
      summary.unchanged += 1;
    }
  }
  for (const row of existing) {
    if (!inputByExternalId.has(row.externalId)) summary.conflict += 1;
  }
  if (summary.conflict > 0) {
    summary.unchanged = 0;
    return summary;
  }
  summary.applied = apply;
  return summary;
}

function retryableTransactionError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

export async function importNotionBudgetRecords({
  client,
  workspaceId,
  records,
  apply = false,
}) {
  if (
    typeof workspaceId !== "string" ||
    workspaceId.trim() === "" ||
    !Array.isArray(records) ||
    records.length !== EXPECTED_AGGREGATES.recordCount
  ) {
    throw new NotionBudgetImportError("匯入參數無效。");
  }
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(
        (transaction) =>
          planAndApply(transaction, workspaceId.trim(), records, apply),
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof NotionBudgetImportError) throw error;
      if (retryableTransactionError(error) && attempt < MAX_TRANSACTION_ATTEMPTS) {
        continue;
      }
      if (retryableTransactionError(error)) {
        throw new NotionBudgetImportError(
          "同時有其他匯入作業，請確認後重新執行。",
        );
      }
      throw new NotionBudgetImportError(
        "匯入交易失敗，沒有寫入任何資料。",
      );
    }
  }
  throw new NotionBudgetImportError("匯入交易失敗，沒有寫入任何資料。");
}

export function formatNotionBudgetImportSummary(summary) {
  return [
    `mode=${summary.mode}`,
    `applied=${summary.applied}`,
    `input=${summary.input}`,
    `create=${summary.create}`,
    `unchanged=${summary.unchanged}`,
    `conflict=${summary.conflict}`,
    `roots=${summary.roots}`,
    `parents=${summary.parents}`,
    `max_depth=${summary.maximumDepth}`,
    `planned_total=${summary.plannedTotal}`,
  ].join(" ");
}

export function parseNotionBudgetCliArguments(argv) {
  let workspaceId;
  let confirmWorkspaceId;
  let inputPath;
  let manifestPath;
  let apply = false;
  let applySeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (applySeen) throw new NotionBudgetImportError("CLI 參數不可重複。");
      applySeen = true;
      apply = true;
      continue;
    }
    if (
      argument === "--workspace-id" ||
      argument === "--confirm-workspace-id" ||
      argument === "--input" ||
      argument === "--manifest"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new NotionBudgetImportError("CLI 必要參數不完整。");
      }
      const normalized = value.trim();
      if (argument === "--workspace-id") {
        if (workspaceId !== undefined) throw new NotionBudgetImportError("CLI 參數不可重複。");
        workspaceId = normalized;
      } else if (argument === "--confirm-workspace-id") {
        if (confirmWorkspaceId !== undefined) throw new NotionBudgetImportError("CLI 參數不可重複。");
        confirmWorkspaceId = normalized;
      } else if (argument === "--input") {
        if (inputPath !== undefined) throw new NotionBudgetImportError("CLI 參數不可重複。");
        inputPath = value;
      } else {
        if (manifestPath !== undefined) throw new NotionBudgetImportError("CLI 參數不可重複。");
        manifestPath = value;
      }
      index += 1;
      continue;
    }
    throw new NotionBudgetImportError("CLI 含有不支援的參數。");
  }
  if (!workspaceId || !confirmWorkspaceId || !inputPath || !manifestPath) {
    throw new NotionBudgetImportError(
      "必須提供兩次 workspace 確認、匯入檔與匿名 manifest；預設只執行 dry-run。",
    );
  }
  if (workspaceId !== confirmWorkspaceId) {
    throw new NotionBudgetImportError("兩次指定的婚宴工作區不一致。");
  }
  if (
    path.basename(inputPath).startsWith(".env") ||
    path.basename(manifestPath).startsWith(".env")
  ) {
    throw new NotionBudgetImportError("匯入檔不可使用環境設定檔。");
  }
  return { workspaceId, confirmWorkspaceId, inputPath, manifestPath, apply };
}

function pathIsInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function decodeUtf8(bytes, errorMessage) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new NotionBudgetImportError(errorMessage);
  }
}

async function readRegularFileBytes(filePath) {
  const handle = await open(
    filePath,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
  );
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) return { isFile: false, bytes: null };
    return { isFile: true, bytes: await handle.readFile() };
  } finally {
    await handle.close();
  }
}

export async function runNotionBudgetCli(
  argv,
  {
    databaseUrl = process.env.DATABASE_URL,
    repositoryRoot = NOTION_BUDGET_REPOSITORY_ROOT,
    resolveRealPath = (filePath) => realpath(filePath),
    readCheckedFile = (filePath) => readRegularFileBytes(filePath),
    createClient = (url) =>
      new PrismaClient({ datasources: { db: { url } } }),
    writeOutput = (line) => console.log(line),
    writeError = (line) => console.error(line),
  } = {},
) {
  let client;
  try {
    const options = parseNotionBudgetCliArguments(argv);
    if (!databaseUrl) {
      throw new NotionBudgetImportError(
        "此 privileged offline operator command 需要 DATABASE_URL。",
      );
    }
    let resolvedRepositoryRoot;
    let resolvedInputPath;
    let resolvedManifestPath;
    try {
      [resolvedRepositoryRoot, resolvedInputPath, resolvedManifestPath] =
        await Promise.all([
          resolveRealPath(repositoryRoot),
          resolveRealPath(options.inputPath),
          resolveRealPath(options.manifestPath),
        ]);
    } catch {
      throw new NotionBudgetImportError("無法解析匯入檔或匿名 manifest。");
    }
    if (
      pathIsInside(resolvedRepositoryRoot, resolvedInputPath) ||
      pathIsInside(resolvedRepositoryRoot, resolvedManifestPath)
    ) {
      throw new NotionBudgetImportError(
        "匯入檔與匿名 manifest 必須位於 repository 外。",
      );
    }
    let inputFile;
    let manifestFile;
    try {
      [inputFile, manifestFile] = await Promise.all([
        readCheckedFile(resolvedInputPath),
        readCheckedFile(resolvedManifestPath),
      ]);
    } catch {
      throw new NotionBudgetImportError("無法讀取匯入檔或匿名 manifest。");
    }
    if (!inputFile.isFile || !manifestFile.isFile) {
      throw new NotionBudgetImportError(
        "匯入檔與匿名 manifest 必須是一般檔案。",
      );
    }
    const inputBytes = inputFile.bytes;
    const manifestBytes = manifestFile.bytes;
    const inputJson = decodeUtf8(inputBytes, "匯入檔不是有效的 UTF-8 JSON。");
    const manifestJson = decodeUtf8(
      manifestBytes,
      "匿名 manifest 不是有效的 UTF-8 JSON。",
    );
    const records = parseNormalizedNotionBudgetJson(inputJson);
    parseAndValidateNotionBudgetManifestJson(manifestJson, inputBytes, records);
    client = createClient(databaseUrl);
    const summary = await importNotionBudgetRecords({
      client,
      workspaceId: options.workspaceId,
      records,
      apply: options.apply,
    });
    writeOutput(formatNotionBudgetImportSummary(summary));
    return summary.conflict > 0 ? 2 : 0;
  } catch (error) {
    if (
      error instanceof NotionBudgetValidationError ||
      error instanceof NotionBudgetImportError
    ) {
      writeError(error.message);
    } else {
      writeError("匯入失敗，沒有寫入任何資料。");
    }
    return 1;
  } finally {
    if (client) await client.$disconnect().catch(() => undefined);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await runNotionBudgetCli(process.argv.slice(2));
}
