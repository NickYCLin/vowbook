#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_TREE_DEPTH = 32;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const BUDGET_CATEGORIES = [
  "RINGS_KEEPSAKES",
  "PHOTOGRAPHY_VIDEO",
  "ATTIRE_STYLING",
  "VENUE_CATERING",
  "TRANSPORT_LODGING",
  "DECOR_GIFTS",
  "PEOPLE_SERVICES",
  "OTHER_PENDING",
];
const CATEGORY_SET = new Set(BUDGET_CATEGORIES);
const AUTHORIZED_EDITOR_ROLES = new Set(["OWNER", "PARTNER", "PLANNER"]);
const FIXED_TAXONOMY_STAGES = [
  {
    key: "STAGE_PREPARATION_1_2_MONTHS",
    label: "籌備第1-2月",
    items: [
      ["ITEM_PROPOSAL", "求婚", "RINGS_KEEPSAKES"],
      ["ITEM_WEDDING_VENUE", "婚宴場地", "VENUE_CATERING"],
      ["ITEM_PRE_WEDDING_PHOTOGRAPHY", "婚紗照拍攝", "PHOTOGRAPHY_VIDEO"],
    ],
  },
  {
    key: "STAGE_PREPARATION_3_MONTH",
    label: "籌備第3個月",
    items: [
      ["ITEM_WEDDING_CAKES", "喜餅", "DECOR_GIFTS"],
      ["ITEM_BRIDAL_STYLIST", "新娘秘書", "ATTIRE_STYLING"],
      ["ITEM_WEDDING_PHOTOGRAPHY", "婚禮攝影", "PHOTOGRAPHY_VIDEO"],
      ["ITEM_WEDDING_VIDEOGRAPHY", "婚禮錄影", "PHOTOGRAPHY_VIDEO"],
      ["ITEM_WEDDING_HOST", "婚禮主持", "PEOPLE_SERVICES"],
      ["ITEM_WEDDING_BAND", "婚禮樂團", "PEOPLE_SERVICES"],
      ["ITEM_WEDDING_INTERACTION", "婚禮互動", "PEOPLE_SERVICES"],
    ],
  },
  {
    key: "STAGE_PREPARATION_4_MONTH",
    label: "籌備婚禮第4個月",
    items: [
      ["ITEM_ATTIRE_RENTAL", "禮服租借", "ATTIRE_STYLING"],
      ["ITEM_WEDDING_SHOES", "婚鞋", "ATTIRE_STYLING"],
      ["ITEM_WEDDING_DECOR", "婚禮佈置", "DECOR_GIFTS"],
    ],
  },
  {
    key: "STAGE_COUNTDOWN_2_MONTHS",
    label: "婚禮前倒數2個月",
    items: [
      ["ITEM_INVITATIONS_POSTAGE", "印喜帖及寄送", "DECOR_GIFTS"],
      ["ITEM_BEAUTY_TREATMENTS", "保養療程", "ATTIRE_STYLING"],
      ["ITEM_WEDDING_FAVORS", "婚禮小物", "DECOR_GIFTS"],
    ],
  },
  {
    key: "STAGE_ENGAGEMENT_CEREMONY",
    label: "文定儀式用品、工作人員紅包",
    items: [
      ["ITEM_ENGAGEMENT_GROOM", "文定儀式（男方準備）", "DECOR_GIFTS"],
      ["ITEM_ENGAGEMENT_BRIDE", "文定儀式（女方準備）", "DECOR_GIFTS"],
    ],
  },
  {
    key: "STAGE_WEDDING_PROCESSION",
    label: "迎娶儀式用品、工作人員紅包",
    items: [
      ["ITEM_PROCESSION_GROOM", "迎娶儀式男方準備", "DECOR_GIFTS"],
      ["ITEM_PROCESSION_BRIDE", "迎娶儀式女方準備", "DECOR_GIFTS"],
    ],
  },
  {
    key: "INTERNAL_UNCLASSIFIED_STAGE",
    label: "系統保留",
    items: [
      [
        "INTERNAL_UNCLASSIFIED_ITEM",
        "未分類既有項目",
        "OTHER_PENDING",
      ],
    ],
  },
];
const FIXED_TAXONOMY_NODES = FIXED_TAXONOMY_STAGES.flatMap(
  (stage, stageIndex) => [
    {
      key: stage.key,
      label: stage.label,
      parentKey: null,
      sourceOrder: stageIndex + 1,
      defaultCategory: null,
    },
    ...stage.items.map(([key, label, defaultCategory], itemIndex) => ({
      key,
      label,
      parentKey: stage.key,
      sourceOrder: itemIndex + 1,
      defaultCategory,
    })),
  ],
);
const FIXED_TAXONOMY_NODE_BY_KEY = new Map(
  FIXED_TAXONOMY_NODES.map((node) => [node.key, node]),
);
const PLAN_KEYS = new Set(["version", "expected", "groups", "items"]);
const EXPECTED_KEYS = new Set(["before", "final"]);
const PROJECTION_KEYS = new Set([
  "itemCount",
  "rootCount",
  "maxDepth",
  "categoryCounts",
  "projectionSha256",
]);
const GROUP_KEYS = new Set(["ref", "name", "parentRef", "finalPath"]);
const ITEM_KEYS = new Set([
  "ref",
  "beforePath",
  "finalPath",
  "finalKind",
  "finalCategory",
  "finalName",
  "parentRef",
]);

export const BUDGET_HIERARCHY_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class BudgetHierarchyValidationError extends Error {
  constructor(message = "重整計畫驗證失敗。") {
    super(message);
    this.name = "BudgetHierarchyValidationError";
  }
}

export class BudgetHierarchyConflictError extends Error {
  constructor(message = "目前資料與完整重整計畫不一致；未寫入任何資料。") {
    super(message);
    this.name = "BudgetHierarchyConflictError";
  }
}

function validationFailure() {
  throw new BudgetHierarchyValidationError();
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function normalizedName(value) {
  if (typeof value !== "string" || value !== value.trim()) validationFailure();
  const length = Array.from(value).length;
  if (length < 1 || length > 120) validationFailure();
  return value;
}

function normalizedReference(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !REFERENCE_PATTERN.test(value)) {
    validationFailure();
  }
  return value;
}

function normalizedPath(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_TREE_DEPTH
  ) {
    validationFailure();
  }
  return value.map(normalizedName);
}

function pathKey(value) {
  return JSON.stringify(value);
}

function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}

function fixedTaxonomyPath(key) {
  const node = FIXED_TAXONOMY_NODE_BY_KEY.get(key);
  if (!node) throw new BudgetHierarchyConflictError();
  return node.parentKey === null
    ? [node.label]
    : [...fixedTaxonomyPath(node.parentKey), node.label];
}

function validateStoredFixedTaxonomy(rows) {
  const rowByTaxonomyKey = new Map();
  for (const row of rows) {
    if (row.systemTaxonomyKey === null) continue;
    const definition = FIXED_TAXONOMY_NODE_BY_KEY.get(row.systemTaxonomyKey);
    if (!definition || rowByTaxonomyKey.has(definition.key)) {
      throw new BudgetHierarchyConflictError();
    }
    if (
      row.name !== definition.label ||
      row.kind !== "GROUP" ||
      row.category !== null ||
      row.sourceOrder !== definition.sourceOrder
    ) {
      throw new BudgetHierarchyConflictError();
    }
    rowByTaxonomyKey.set(definition.key, row);
  }
  if (rowByTaxonomyKey.size !== FIXED_TAXONOMY_NODES.length) {
    throw new BudgetHierarchyConflictError();
  }
  for (const definition of FIXED_TAXONOMY_NODES) {
    const row = rowByTaxonomyKey.get(definition.key);
    const expectedParentId =
      definition.parentKey === null
        ? null
        : rowByTaxonomyKey.get(definition.parentKey)?.id;
    if (expectedParentId === undefined || row.parentId !== expectedParentId) {
      throw new BudgetHierarchyConflictError();
    }
  }
}

function validateTaxonomyAwarePlan(plan, references) {
  const entries = [...plan.groups, ...plan.items];
  const entryByReference = new Map(entries.map((entry) => [entry.ref, entry]));
  const itemEntryByReference = new Map(
    plan.items.map((entry) => [entry.ref, entry]),
  );
  const fixedReferenceByKey = new Map();
  for (const [reference, row] of references) {
    if (row.systemTaxonomyKey !== null) {
      if (fixedReferenceByKey.has(row.systemTaxonomyKey)) {
        throw new BudgetHierarchyConflictError();
      }
      fixedReferenceByKey.set(row.systemTaxonomyKey, reference);
    }
  }
  if (fixedReferenceByKey.size !== FIXED_TAXONOMY_NODES.length) {
    throw new BudgetHierarchyConflictError();
  }

  for (const definition of FIXED_TAXONOMY_NODES) {
    const reference = fixedReferenceByKey.get(definition.key);
    const entry = itemEntryByReference.get(reference);
    const expectedParentReference =
      definition.parentKey === null
        ? null
        : fixedReferenceByKey.get(definition.parentKey);
    const expectedPath = fixedTaxonomyPath(definition.key);
    if (
      !entry ||
      expectedParentReference === undefined ||
      !samePath(entry.beforePath, expectedPath) ||
      !samePath(entry.finalPath, expectedPath) ||
      entry.finalName !== definition.label ||
      entry.finalKind !== "GROUP" ||
      entry.finalCategory !== null ||
      entry.parentRef !== expectedParentReference
    ) {
      throw new BudgetHierarchyConflictError();
    }
  }

  for (const entry of entries) {
    const storedRow = references.get(entry.ref);
    if (storedRow && storedRow.systemTaxonomyKey !== null) continue;
    let current = entry;
    let itemTaxonomyAncestors = 0;
    let itemTaxonomyKey = null;
    const visited = new Set();
    while (current.parentRef !== null) {
      if (visited.has(current.ref)) throw new BudgetHierarchyConflictError();
      visited.add(current.ref);
      const parent = entryByReference.get(current.parentRef);
      if (!parent) throw new BudgetHierarchyConflictError();
      const parentTaxonomyKey = references.get(parent.ref)?.systemTaxonomyKey;
      if (
        parentTaxonomyKey?.startsWith("ITEM_") ||
        parentTaxonomyKey === "INTERNAL_UNCLASSIFIED_ITEM"
      ) {
        itemTaxonomyAncestors += 1;
        itemTaxonomyKey = parentTaxonomyKey;
      }
      current = parent;
    }
    if (itemTaxonomyAncestors !== 1) {
      throw new BudgetHierarchyConflictError();
    }
    const itemDefinition = FIXED_TAXONOMY_NODE_BY_KEY.get(itemTaxonomyKey);
    if (
      !itemDefinition ||
      (entry.finalKind === "EXPENSE" &&
        itemTaxonomyKey !== "INTERNAL_UNCLASSIFIED_ITEM" &&
        entry.finalCategory !== itemDefinition.defaultCategory)
    ) {
      throw new BudgetHierarchyConflictError();
    }
  }
}

function normalizeCategoryCounts(value) {
  if (!isPlainObject(value)) validationFailure();
  const result = {};
  for (const [category, count] of Object.entries(value)) {
    if (
      !CATEGORY_SET.has(category) ||
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      validationFailure();
    }
    result[category] = count;
  }
  return Object.fromEntries(
    BUDGET_CATEGORIES.filter((category) => result[category] !== undefined).map(
      (category) => [category, result[category]],
    ),
  );
}

function normalizeExpectedProjection(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, PROJECTION_KEYS)) {
    validationFailure();
  }
  for (const field of ["itemCount", "rootCount", "maxDepth"]) {
    if (
      typeof value[field] !== "number" ||
      !Number.isInteger(value[field]) ||
      value[field] < 0
    ) {
      validationFailure();
    }
  }
  if (
    value.itemCount === 0
      ? value.rootCount !== 0 || value.maxDepth !== 0
      : value.rootCount < 1 ||
        value.rootCount > value.itemCount ||
        value.maxDepth < 1 ||
        value.maxDepth > MAX_TREE_DEPTH
  ) {
    validationFailure();
  }
  if (
    typeof value.projectionSha256 !== "string" ||
    !SHA256_PATTERN.test(value.projectionSha256)
  ) {
    validationFailure();
  }
  return {
    itemCount: value.itemCount,
    rootCount: value.rootCount,
    maxDepth: value.maxDepth,
    categoryCounts: normalizeCategoryCounts(value.categoryCounts),
    projectionSha256: value.projectionSha256,
  };
}

function rowIsNeutralGroup(row) {
  return (
    row.plannedAmount === 0 &&
    row.actualAmount === null &&
    row.depositAmount === null &&
    row.balanceAmount === null &&
    row.additionalAmount === null &&
    row.paidAt === null &&
    row.dueDate === null &&
    row.bookingStatus === "PLANNING" &&
    row.paid === false &&
    row.estimatedRange === null &&
    row.candidateVendors === null &&
    row.confirmedVendor === null &&
    row.vendorContact === null &&
    row.primaryContact === null &&
    row.notes === null
  );
}

function analyzeProjection(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== "string" ||
      byId.has(row.id) ||
      typeof row.name !== "string"
    ) {
      throw new BudgetHierarchyConflictError();
    }
    if (
      (row.kind === "GROUP" &&
        (row.category !== null || !rowIsNeutralGroup(row))) ||
      (row.kind === "EXPENSE" && !CATEGORY_SET.has(row.category))
    ) {
      throw new BudgetHierarchyConflictError();
    }
    byId.set(row.id, row);
  }

  const pathById = new Map();
  const visiting = new Set();
  function resolvePath(id) {
    const existing = pathById.get(id);
    if (existing) return existing;
    if (visiting.has(id)) throw new BudgetHierarchyConflictError();
    const row = byId.get(id);
    if (!row) throw new BudgetHierarchyConflictError();
    visiting.add(id);
    let resolved;
    if (row.parentId === null) {
      resolved = [row.name];
    } else {
      if (!byId.has(row.parentId) || row.parentId === row.id) {
        throw new BudgetHierarchyConflictError();
      }
      resolved = [...resolvePath(row.parentId), row.name];
    }
    visiting.delete(id);
    if (resolved.length > MAX_TREE_DEPTH) {
      throw new BudgetHierarchyConflictError();
    }
    pathById.set(id, resolved);
    return resolved;
  }

  const rowByPath = new Map();
  const projectionRows = [];
  const categoryCounts = {};
  let rootCount = 0;
  let maxDepth = 0;
  for (const row of rows) {
    const itemPath = resolvePath(row.id);
    const key = pathKey(itemPath);
    if (rowByPath.has(key)) throw new BudgetHierarchyConflictError();
    rowByPath.set(key, row);
    if (row.parentId === null) rootCount += 1;
    maxDepth = Math.max(maxDepth, itemPath.length);
    if (row.kind === "EXPENSE") {
      categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
    }
    projectionRows.push({
      path: itemPath,
      kind: row.kind,
      category: row.category,
    });
  }
  projectionRows.sort((left, right) =>
    pathKey(left.path).localeCompare(pathKey(right.path), "en"),
  );
  const orderedCategoryCounts = Object.fromEntries(
    BUDGET_CATEGORIES.filter(
      (category) => categoryCounts[category] !== undefined,
    ).map((category) => [category, categoryCounts[category]]),
  );
  const projectionSha256 = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        items: projectionRows,
      }),
    )
    .digest("hex");
  return {
    projection: {
      itemCount: rows.length,
      rootCount,
      maxDepth,
      categoryCounts: orderedCategoryCounts,
      projectionSha256,
    },
    pathById,
    rowByPath,
  };
}

export function computeBudgetHierarchyProjection(rows) {
  return analyzeProjection(rows).projection;
}

function projectionsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateFinalGraph(plan) {
  const all = [...plan.groups, ...plan.items];
  const byReference = new Map(all.map((entry) => [entry.ref, entry]));
  for (const entry of all) {
    if (entry.parentRef !== null && !byReference.has(entry.parentRef)) {
      validationFailure();
    }
    if (entry.parentRef === entry.ref) validationFailure();
    const expectedPath =
      entry.parentRef === null
        ? [entry.name ?? entry.finalName]
        : [
            ...byReference.get(entry.parentRef).finalPath,
            entry.name ?? entry.finalName,
          ];
    if (!samePath(entry.finalPath, expectedPath)) validationFailure();
  }

  const visited = new Set();
  const visiting = new Set();
  function visit(reference) {
    if (visited.has(reference)) return;
    if (visiting.has(reference)) validationFailure();
    visiting.add(reference);
    const parentReference = byReference.get(reference).parentRef;
    if (parentReference !== null) visit(parentReference);
    visiting.delete(reference);
    visited.add(reference);
  }
  for (const reference of byReference.keys()) visit(reference);

  const virtualRows = all.map((entry) => ({
    id: entry.ref,
    parentId: entry.parentRef,
    name: entry.name ?? entry.finalName,
    kind: entry.finalKind ?? "GROUP",
    category: entry.finalCategory ?? null,
    plannedAmount: 0,
    actualAmount: null,
    depositAmount: null,
    balanceAmount: null,
    additionalAmount: null,
    paidAt: null,
    dueDate: null,
    bookingStatus: "PLANNING",
    paid: false,
    estimatedRange: null,
    candidateVendors: null,
    confirmedVendor: null,
    vendorContact: null,
    primaryContact: null,
    notes: null,
  }));
  let finalProjection;
  try {
    finalProjection = computeBudgetHierarchyProjection(virtualRows);
  } catch {
    validationFailure();
  }
  if (!projectionsEqual(finalProjection, plan.expected.final)) {
    validationFailure();
  }
}

export function parseBudgetHierarchyPlanJson(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    validationFailure();
  }
  if (!isPlainObject(value) || !hasExactKeys(value, PLAN_KEYS)) {
    validationFailure();
  }
  if (
    value.version !== 1 ||
    !isPlainObject(value.expected) ||
    !hasExactKeys(value.expected, EXPECTED_KEYS) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.items)
  ) {
    validationFailure();
  }

  const expected = {
    before: normalizeExpectedProjection(value.expected.before),
    final: normalizeExpectedProjection(value.expected.final),
  };
  const groups = value.groups.map((group) => {
    if (!isPlainObject(group) || !hasExactKeys(group, GROUP_KEYS)) {
      validationFailure();
    }
    const name = normalizedName(group.name);
    const finalPath = normalizedPath(group.finalPath);
    if (group.parentRef === null || finalPath.at(-1) !== name) {
      validationFailure();
    }
    return {
      ref: normalizedReference(group.ref),
      name,
      parentRef: normalizedReference(group.parentRef, true),
      finalPath,
    };
  });
  const items = value.items.map((item) => {
    if (!isPlainObject(item) || !hasExactKeys(item, ITEM_KEYS)) {
      validationFailure();
    }
    const finalName = normalizedName(item.finalName);
    const finalPath = normalizedPath(item.finalPath);
    const finalKind = item.finalKind;
    const finalCategory = item.finalCategory;
    if (
      finalPath.at(-1) !== finalName ||
      !["GROUP", "EXPENSE"].includes(finalKind) ||
      (finalKind === "GROUP" && finalCategory !== null) ||
      (finalKind === "EXPENSE" && !CATEGORY_SET.has(finalCategory))
    ) {
      validationFailure();
    }
    return {
      ref: normalizedReference(item.ref),
      beforePath: normalizedPath(item.beforePath),
      finalPath,
      finalKind,
      finalCategory,
      finalName,
      parentRef: normalizedReference(item.parentRef, true),
    };
  });

  const references = [...groups, ...items].map((entry) => entry.ref);
  const beforePaths = items.map((entry) => pathKey(entry.beforePath));
  const finalPaths = [...groups, ...items].map((entry) =>
    pathKey(entry.finalPath),
  );
  if (
    new Set(references).size !== references.length ||
    new Set(beforePaths).size !== beforePaths.length ||
    new Set(finalPaths).size !== finalPaths.length ||
    expected.before.itemCount !== items.length ||
    expected.final.itemCount !== items.length + groups.length
  ) {
    validationFailure();
  }

  const plan = { version: 1, expected, groups, items };
  validateFinalGraph(plan);
  return plan;
}

function completeBeforeState(plan, analysis) {
  if (
    !projectionsEqual(analysis.projection, plan.expected.before) ||
    analysis.projection.itemCount !== plan.items.length
  ) {
    return null;
  }
  const byReference = new Map();
  for (const item of plan.items) {
    const row = analysis.rowByPath.get(pathKey(item.beforePath));
    if (!row) return null;
    byReference.set(item.ref, row);
  }
  return byReference.size === analysis.projection.itemCount
    ? byReference
    : null;
}

function completeFinalState(plan, analysis) {
  if (!projectionsEqual(analysis.projection, plan.expected.final)) return null;
  const byReference = new Map();
  for (const entry of [...plan.groups, ...plan.items]) {
    const row = analysis.rowByPath.get(pathKey(entry.finalPath));
    if (!row) return null;
    const expectedKind = entry.finalKind ?? "GROUP";
    const expectedCategory = entry.finalCategory ?? null;
    const expectedName = entry.finalName ?? entry.name;
    if (
      row.kind !== expectedKind ||
      row.category !== expectedCategory ||
      row.name !== expectedName
    ) {
      return null;
    }
    byReference.set(entry.ref, row);
  }
  for (const entry of [...plan.groups, ...plan.items]) {
    const row = byReference.get(entry.ref);
    const expectedParentId =
      entry.parentRef === null ? null : byReference.get(entry.parentRef)?.id;
    if (expectedParentId === undefined || row.parentId !== expectedParentId) {
      return null;
    }
  }
  return byReference.size === analysis.projection.itemCount
    ? byReference
    : null;
}

function changedExistingCount(plan, byReference) {
  let changed = 0;
  for (const item of plan.items) {
    const row = byReference.get(item.ref);
    const parent = item.parentRef === null ? null : byReference.get(item.parentRef);
    const targetParentId =
      item.parentRef === null
        ? null
        : parent
          ? parent.id
          : Symbol.for("new-group-parent");
    if (
      row.name !== item.finalName ||
      row.kind !== item.finalKind ||
      row.category !== item.finalCategory ||
      row.parentId !== targetParentId
    ) {
      changed += 1;
    }
  }
  return changed;
}

function summaryFor(plan, mode, applied, create, update, unchanged) {
  return {
    mode,
    applied,
    create,
    update,
    unchanged,
    conflict: 0,
    roots: plan.expected.final.rootCount,
    maxDepth: plan.expected.final.maxDepth,
    categoryCounts: plan.expected.final.categoryCounts,
    projectionHashMatches: true,
  };
}

function isRetryableTransactionError(error) {
  return error && typeof error === "object" && error.code === "P2034";
}

async function withSerializableRetry(client, callback) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(callback, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (
        !isRetryableTransactionError(error) ||
        attempt === MAX_TRANSACTION_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
  throw new BudgetHierarchyConflictError();
}

const budgetItemSelect = {
  id: true,
  workspaceId: true,
  parentId: true,
  systemTaxonomyKey: true,
  sourceOrder: true,
  name: true,
  kind: true,
  category: true,
  plannedAmount: true,
  actualAmount: true,
  depositAmount: true,
  balanceAmount: true,
  additionalAmount: true,
  paidAt: true,
  dueDate: true,
  bookingStatus: true,
  paid: true,
  estimatedRange: true,
  candidateVendors: true,
  confirmedVendor: true,
  vendorContact: true,
  primaryContact: true,
  notes: true,
  version: true,
};

export async function reorganizeBudgetHierarchy({
  client,
  workspaceId,
  actorUserId,
  plan,
  apply = false,
}) {
  if (
    !client ||
    typeof workspaceId !== "string" ||
    workspaceId.trim() === "" ||
    typeof actorUserId !== "string" ||
    actorUserId.trim() === "" ||
    !plan
  ) {
    throw new BudgetHierarchyValidationError();
  }
  return withSerializableRetry(client, async (transaction) => {
    // Share the website move lock so the one-shot operator cannot race an
    // interactive move into a cross-path hierarchy cycle.
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0::bigint))`,
    );
    const membership = await transaction.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: actorUserId,
        },
      },
      select: { role: true },
    });
    if (!membership || !AUTHORIZED_EDITOR_ROLES.has(membership.role)) {
      throw new BudgetHierarchyConflictError();
    }
    const workspace = await transaction.weddingWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) throw new BudgetHierarchyConflictError();
    const rows = await transaction.budgetItem.findMany({
      where: { workspaceId },
      select: budgetItemSelect,
    });
    validateStoredFixedTaxonomy(rows);
    const analysis = analyzeProjection(rows);
    const finalReferences = completeFinalState(plan, analysis);
    if (finalReferences) {
      validateTaxonomyAwarePlan(plan, finalReferences);
      return summaryFor(
        plan,
        apply ? "apply" : "dry-run",
        apply,
        0,
        0,
        rows.length,
      );
    }

    const beforeReferences = completeBeforeState(plan, analysis);
    if (!beforeReferences) throw new BudgetHierarchyConflictError();
    validateTaxonomyAwarePlan(plan, beforeReferences);
    for (const item of plan.items) {
      const row = beforeReferences.get(item.ref);
      if (item.finalKind === "GROUP" && !rowIsNeutralGroup(row)) {
        throw new BudgetHierarchyConflictError();
      }
    }
    const updateCount = changedExistingCount(plan, beforeReferences);
    if (!apply) {
      return summaryFor(
        plan,
        "dry-run",
        false,
        plan.groups.length,
        updateCount,
        plan.items.length - updateCount,
      );
    }

    const references = new Map(beforeReferences);
    const orderedGroups = [...plan.groups].sort(
      (left, right) => left.finalPath.length - right.finalPath.length,
    );
    for (const group of orderedGroups) {
      const parent =
        group.parentRef === null ? null : references.get(group.parentRef);
      if (!parent) {
        throw new BudgetHierarchyConflictError();
      }
      const created = await transaction.budgetItem.create({
        data: {
          workspaceId,
          parentId: parent.id,
          name: group.name,
          kind: "GROUP",
          category: null,
          systemTaxonomyKey: null,
          sourceOrder: null,
          plannedAmount: 0,
          actualAmount: null,
          depositAmount: null,
          balanceAmount: null,
          additionalAmount: null,
          paidAt: null,
          dueDate: null,
          bookingStatus: "PLANNING",
          paid: false,
        },
        select: { id: true },
      });
      references.set(group.ref, {
        id: created.id,
        workspaceId,
        parentId: parent.id,
        name: group.name,
        kind: "GROUP",
        category: null,
        systemTaxonomyKey: null,
        sourceOrder: null,
      });
    }

    let changed = 0;
    const orderedItems = [...plan.items].sort(
      (left, right) => left.finalPath.length - right.finalPath.length,
    );
    for (const item of orderedItems) {
      const row = beforeReferences.get(item.ref);
      const parent =
        item.parentRef === null ? null : references.get(item.parentRef);
      if (item.parentRef !== null && !parent) {
        throw new BudgetHierarchyConflictError();
      }
      const parentId = parent?.id ?? null;
      const isChanged =
        row.name !== item.finalName ||
        row.parentId !== parentId ||
        row.kind !== item.finalKind ||
        row.category !== item.finalCategory;
      if (!isChanged) continue;
      if (row.systemTaxonomyKey !== null) {
        throw new BudgetHierarchyConflictError();
      }
      const result = await transaction.budgetItem.updateMany({
        where: {
          id: row.id,
          workspaceId,
          version: row.version,
        },
        data: {
          name: item.finalName,
          parentId,
          kind: item.finalKind,
          category: item.finalCategory,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new BudgetHierarchyConflictError();
      changed += 1;
      references.set(item.ref, {
        ...row,
        name: item.finalName,
        parentId,
        kind: item.finalKind,
        category: item.finalCategory,
        version: row.version + 1,
      });
    }

    const finalRows = await transaction.budgetItem.findMany({
      where: { workspaceId },
      select: budgetItemSelect,
    });
    validateStoredFixedTaxonomy(finalRows);
    const finalAnalysis = analyzeProjection(finalRows);
    if (!completeFinalState(plan, finalAnalysis)) {
      throw new BudgetHierarchyConflictError();
    }
    return summaryFor(
      plan,
      "apply",
      true,
      plan.groups.length,
      changed,
      plan.items.length - changed,
    );
  });
}

export function parseBudgetHierarchyCliArguments(argv) {
  let workspaceId;
  let confirmWorkspaceId;
  let actorUserId;
  let confirmActorUserId;
  let planPath;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (apply) throw new BudgetHierarchyValidationError("CLI 參數不可重複。");
      apply = true;
      continue;
    }
    if (
      argument === "--workspace-id" ||
      argument === "--confirm-workspace-id" ||
      argument === "--actor-user-id" ||
      argument === "--confirm-actor-user-id" ||
      argument === "--plan"
    ) {
      const value = argv[index + 1];
      if (typeof value !== "string" || value === "" || value.startsWith("--")) {
        throw new BudgetHierarchyValidationError("CLI 參數不完整。");
      }
      if (argument === "--workspace-id") {
        if (workspaceId !== undefined) {
          throw new BudgetHierarchyValidationError("CLI 參數不可重複。");
        }
        workspaceId = value.trim();
      } else if (argument === "--confirm-workspace-id") {
        if (confirmWorkspaceId !== undefined) {
          throw new BudgetHierarchyValidationError("CLI 參數不可重複。");
        }
        confirmWorkspaceId = value.trim();
      } else if (argument === "--actor-user-id") {
        if (actorUserId !== undefined) {
          throw new BudgetHierarchyValidationError("CLI 參數不可重複。");
        }
        actorUserId = value.trim();
      } else if (argument === "--confirm-actor-user-id") {
        if (confirmActorUserId !== undefined) {
          throw new BudgetHierarchyValidationError("CLI 參數不可重複。");
        }
        confirmActorUserId = value.trim();
      } else {
        if (planPath !== undefined) {
          throw new BudgetHierarchyValidationError("CLI 參數不可重複。");
        }
        planPath = value;
      }
      index += 1;
      continue;
    }
    throw new BudgetHierarchyValidationError("CLI 含有不支援的參數。");
  }
  if (
    !workspaceId ||
    !confirmWorkspaceId ||
    !actorUserId ||
    !confirmActorUserId ||
    !planPath
  ) {
    throw new BudgetHierarchyValidationError(
      "必須提供兩次 workspace、兩次操作者確認與重整計畫；預設只執行 dry-run。",
    );
  }
  if (workspaceId !== confirmWorkspaceId) {
    throw new BudgetHierarchyValidationError("兩次指定的婚宴工作區不一致。");
  }
  if (actorUserId !== confirmActorUserId) {
    throw new BudgetHierarchyValidationError("兩次指定的操作者不一致。");
  }
  if (path.basename(planPath).startsWith(".env")) {
    throw new BudgetHierarchyValidationError("重整計畫不可使用環境設定檔。");
  }
  return {
    workspaceId,
    confirmWorkspaceId,
    actorUserId,
    confirmActorUserId,
    planPath,
    apply,
  };
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

async function readRegularFileBytes(filePath) {
  const handle = await open(
    filePath,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { isFile: false, bytes: null };
    return { isFile: true, bytes: await handle.readFile() };
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BudgetHierarchyValidationError(
      "重整計畫不是有效的 UTF-8 JSON。",
    );
  }
}

export function formatBudgetHierarchySummary(summary) {
  return JSON.stringify({
    mode: summary.mode,
    applied: summary.applied,
    create: summary.create,
    update: summary.update,
    unchanged: summary.unchanged,
    conflict: summary.conflict,
    roots: summary.roots,
    maxDepth: summary.maxDepth,
    categoryCounts: Object.fromEntries(
      BUDGET_CATEGORIES.filter(
        (category) => summary.categoryCounts[category] !== undefined,
      ).map((category) => [category, summary.categoryCounts[category]]),
    ),
    projectionHashMatches: summary.projectionHashMatches,
  });
}

export async function runBudgetHierarchyCli(
  argv,
  {
    databaseUrl = process.env.DATABASE_URL,
    repositoryRoot = BUDGET_HIERARCHY_REPOSITORY_ROOT,
    resolveRealPath = (filePath) => realpath(filePath),
    readCheckedFile = (filePath) => readRegularFileBytes(filePath),
    createClient = (url) =>
      new PrismaClient({ datasources: { db: { url } } }),
    writeOutput = (line) => console.log(line),
    writeError = (line) => console.error(line),
  } = {},
) {
  let client;
  let options;
  try {
    options = parseBudgetHierarchyCliArguments(argv);
    if (!databaseUrl) {
      throw new BudgetHierarchyValidationError(
        "此 privileged offline operator command 需要 DATABASE_URL。",
      );
    }
    let repositoryRealPath;
    let planRealPath;
    try {
      [repositoryRealPath, planRealPath] = await Promise.all([
        resolveRealPath(repositoryRoot),
        resolveRealPath(options.planPath),
      ]);
    } catch {
      throw new BudgetHierarchyValidationError("無法解析重整計畫。");
    }
    if (pathIsInside(repositoryRealPath, planRealPath)) {
      throw new BudgetHierarchyValidationError(
        "重整計畫必須位於 repository 外。",
      );
    }
    let planFile;
    try {
      planFile = await readCheckedFile(planRealPath);
    } catch {
      throw new BudgetHierarchyValidationError("無法讀取重整計畫。");
    }
    if (!planFile.isFile) {
      throw new BudgetHierarchyValidationError("重整計畫必須是一般檔案。");
    }
    const plan = parseBudgetHierarchyPlanJson(decodeUtf8(planFile.bytes));
    client = createClient(databaseUrl);
    const summary = await reorganizeBudgetHierarchy({
      client,
      workspaceId: options.workspaceId,
      actorUserId: options.actorUserId,
      plan,
      apply: options.apply,
    });
    writeOutput(formatBudgetHierarchySummary(summary));
    return 0;
  } catch (error) {
    if (error instanceof BudgetHierarchyConflictError) {
      writeOutput(
        formatBudgetHierarchySummary({
          mode: options?.apply ? "apply" : "dry-run",
          applied: false,
          create: 0,
          update: 0,
          unchanged: 0,
          conflict: 1,
          roots: 0,
          maxDepth: 0,
          categoryCounts: {},
          projectionHashMatches: false,
        }),
      );
      return 2;
    }
    if (error instanceof BudgetHierarchyValidationError) {
      writeError(error.message);
    } else {
      writeError("重整失敗，沒有寫入任何資料。");
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
  process.exitCode = await runBudgetHierarchyCli(process.argv.slice(2));
}
