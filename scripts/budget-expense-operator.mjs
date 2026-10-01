import { constants as fileConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_TWD_AMOUNT = 2_147_483_647;
const MAX_NAME_LENGTH = 120;
const MAX_ROWS = 20;
const MAX_PLAN_BYTES = 64 * 1024;
const BUDGET_CATEGORIES = new Set([
  "RINGS_KEEPSAKES",
  "PHOTOGRAPHY_VIDEO",
  "ATTIRE_STYLING",
  "VENUE_CATERING",
  "TRANSPORT_LODGING",
  "DECOR_GIFTS",
  "PEOPLE_SERVICES",
  "OTHER_PENDING",
]);
const BOOKING_STATUSES = new Set(["PLANNING", "BOOKED_BALANCE_DUE", "PAID"]);
const BALANCE_PAYMENT_METHODS = new Set(["CASH", "TRANSFER", "CARD", "OTHER"]);
const AUTHORIZED_EDITOR_ROLES = new Set(["OWNER", "PARTNER", "PLANNER", "COORDINATOR"]);

export const BUDGET_EXPENSE_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class BudgetExpenseValidationError extends Error {}
export class BudgetExpenseConflictError extends Error {}

function invalid(message) {
  throw new BudgetExpenseValidationError(message);
}

function normalizeName(value) {
  if (typeof value !== "string") invalid("項目名稱必須是字串。");
  const name = value.normalize("NFC").trim();
  if (name === "" || name.length > MAX_NAME_LENGTH) {
    invalid(`項目名稱請填 1 到 ${MAX_NAME_LENGTH} 個字。`);
  }
  return name;
}

function normalizeAmount(value, label) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_TWD_AMOUNT
  ) {
    invalid(`${label}請填 0 到 ${MAX_TWD_AMOUNT} 的整數。`);
  }
  return value;
}

function normalizeOptionalText(value, label, maxLength) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") invalid(`${label}必須是字串。`);
  const text = value.normalize("NFC").trim();
  if (text === "") return null;
  if (text.length > maxLength) invalid(`${label}過長。`);
  return text;
}

function normalizeDueDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    invalid("到期日請使用 yyyy-MM-dd。");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) invalid("到期日不是有效日期。");
  return parsed;
}

/**
 * 費用組成決定預計金額與實付金額，和網站表單同一套規則：
 * 預計＝訂金＋尾款＋加購；訂金已付時實付＝訂金，全額付清時實付＝預計。
 */
function deriveAmounts(row) {
  const components = [row.depositAmount, row.balanceAmount, row.additionalAmount];
  const hasComponent = components.some((amount) => amount !== null);
  if (!hasComponent) invalid("每筆費用至少要填訂金、尾款或加購其中一項。");
  const plannedAmount = components.reduce(
    (total, amount) => total + (amount ?? 0),
    0,
  );
  if (plannedAmount > MAX_TWD_AMOUNT) invalid("費用組成合計過大。");
  if (row.bookingStatus === "PAID") {
    return { plannedAmount, actualAmount: plannedAmount, paid: true };
  }
  if (row.bookingStatus === "BOOKED_BALANCE_DUE") {
    return { plannedAmount, actualAmount: row.depositAmount, paid: false };
  }
  return { plannedAmount, actualAmount: null, paid: false };
}

export function parseBudgetExpensePlanJson(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid("費用計畫不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalid("費用計畫必須是物件。");
  }
  if (parsed.version !== 1) invalid("費用計畫版本不支援。");
  if (!Array.isArray(parsed.expenses) || parsed.expenses.length === 0) {
    invalid("費用計畫至少要有一筆費用。");
  }
  if (parsed.expenses.length > MAX_ROWS) {
    invalid(`一次最多新增 ${MAX_ROWS} 筆費用。`);
  }
  const names = new Set();
  const allowed = new Set([
    "name",
    "taxonomyItemKey",
    "category",
    "bookingStatus",
    "depositAmount",
    "balanceAmount",
    "additionalAmount",
    "balancePaymentMethod",
    "dueDate",
    "confirmedVendor",
    "notes",
  ]);
  const expenses = parsed.expenses.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalid("費用必須是物件。");
    }
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) invalid("費用含有不支援的欄位。");
    }
    const name = normalizeName(raw.name);
    if (names.has(name)) invalid("同一份計畫不可有重複的項目名稱。");
    names.add(name);
    if (
      typeof raw.taxonomyItemKey !== "string" ||
      !/^ITEM_[A-Z0-9_]{1,60}$/u.test(raw.taxonomyItemKey)
    ) {
      invalid("費用必須指定婚宴分類項目。");
    }
    if (typeof raw.category !== "string" || !BUDGET_CATEGORIES.has(raw.category)) {
      invalid("費用分類不在允許清單內。");
    }
    const bookingStatus = raw.bookingStatus ?? "PLANNING";
    if (typeof bookingStatus !== "string" || !BOOKING_STATUSES.has(bookingStatus)) {
      invalid("付款狀態不在允許清單內。");
    }
    const balancePaymentMethod =
      raw.balancePaymentMethod === null || raw.balancePaymentMethod === undefined
        ? null
        : raw.balancePaymentMethod;
    if (
      balancePaymentMethod !== null &&
      (typeof balancePaymentMethod !== "string" ||
        !BALANCE_PAYMENT_METHODS.has(balancePaymentMethod))
    ) {
      invalid("尾款付款方式不在允許清單內。");
    }
    const row = {
      name,
      taxonomyItemKey: raw.taxonomyItemKey,
      category: raw.category,
      bookingStatus,
      depositAmount: normalizeAmount(raw.depositAmount, "訂金"),
      balanceAmount: normalizeAmount(raw.balanceAmount, "尾款"),
      additionalAmount: normalizeAmount(raw.additionalAmount, "加購"),
      balancePaymentMethod,
      dueDate: normalizeDueDate(raw.dueDate),
      confirmedVendor: normalizeOptionalText(raw.confirmedVendor, "確定廠商", 300),
      notes: normalizeOptionalText(raw.notes, "備註", 1000),
    };
    return { ...row, ...deriveAmounts(row) };
  });
  return { version: 1, expenses };
}

export function parseBudgetExpenseCliArguments(argv) {
  const values = new Map();
  let apply = false;
  const flags = new Set([
    "--workspace-id",
    "--confirm-workspace-id",
    "--actor-user-id",
    "--confirm-actor-user-id",
    "--plan",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (apply) invalid("CLI 參數不可重複。");
      apply = true;
      continue;
    }
    if (!flags.has(argument)) invalid("CLI 含有不支援的參數。");
    const value = argv[index + 1];
    if (typeof value !== "string" || value === "" || value.startsWith("--")) {
      invalid("CLI 參數不完整。");
    }
    if (values.has(argument)) invalid("CLI 參數不可重複。");
    values.set(argument, argument === "--plan" ? value : value.trim());
    index += 1;
  }
  const workspaceId = values.get("--workspace-id");
  const confirmWorkspaceId = values.get("--confirm-workspace-id");
  const actorUserId = values.get("--actor-user-id");
  const confirmActorUserId = values.get("--confirm-actor-user-id");
  const planPath = values.get("--plan");
  if (
    !workspaceId ||
    !confirmWorkspaceId ||
    !actorUserId ||
    !confirmActorUserId ||
    !planPath
  ) {
    invalid("必須提供兩次 workspace、兩次操作者確認與費用計畫；預設只執行 dry-run。");
  }
  if (workspaceId !== confirmWorkspaceId) invalid("兩次指定的婚宴工作區不一致。");
  if (actorUserId !== confirmActorUserId) invalid("兩次指定的操作者不一致。");
  if (path.basename(planPath).startsWith(".env")) {
    invalid("費用計畫不可使用環境設定檔。");
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
  throw new BudgetExpenseConflictError("交易重試次數用盡。");
}

export async function appendBudgetExpenses({
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
    throw new BudgetExpenseValidationError("缺少必要參數。");
  }
  return withSerializableRetry(client, async (transaction) => {
    const membership = await transaction.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actorUserId } },
      select: { role: true },
    });
    if (!membership || !AUTHORIZED_EDITOR_ROLES.has(membership.role)) {
      throw new BudgetExpenseConflictError("操作者沒有這個婚宴的編輯權限。");
    }
    const workspace = await transaction.weddingWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) throw new BudgetExpenseConflictError("找不到指定的婚宴。");
    const existing = await transaction.budgetItem.findMany({
      where: { workspaceId },
      select: { name: true },
    });
    const takenNames = new Set(
      existing.map((row) => row.name.normalize("NFC").trim()),
    );
    // 只新增，不更新也不刪除；同名就整批停下來，免得又多出重複的項目。
    const duplicates = plan.expenses.filter((row) => takenNames.has(row.name));
    if (duplicates.length > 0) {
      return {
        mode: apply ? "apply" : "dry-run",
        applied: false,
        create: 0,
        conflict: duplicates.length,
        plannedTotal: 0,
        balanceDueTotal: 0,
      };
    }
    const plannedTotal = plan.expenses.reduce(
      (total, row) => total + row.plannedAmount,
      0,
    );
    const balanceDueTotal = plan.expenses.reduce(
      (total, row) =>
        total +
        (row.bookingStatus === "BOOKED_BALANCE_DUE"
          ? (row.balanceAmount ?? 0) + (row.additionalAmount ?? 0)
          : 0),
      0,
    );
    if (apply) {
      for (const row of plan.expenses) {
        // 和網站同一個規則：新項目一律掛在系統分類群組下面，沒有這個分類就不新增。
        const group = await transaction.budgetItem.findFirst({
          where: {
            workspaceId,
            kind: "GROUP",
            systemTaxonomyKey: row.taxonomyItemKey,
          },
          select: { id: true },
        });
        if (!group) {
          throw new BudgetExpenseConflictError("這場婚宴沒有指定的分類項目。");
        }
        await transaction.budgetItem.create({
          data: {
            workspaceId,
            parentId: group.id,
            source: "MANUAL",
            kind: "EXPENSE",
            name: row.name,
            category: row.category,
            bookingStatus: row.bookingStatus,
            preparationStatus: "NEEDS_ACTION",
            plannedAmount: row.plannedAmount,
            actualAmount: row.actualAmount,
            depositAmount: row.depositAmount,
            balanceAmount: row.balanceAmount,
            additionalAmount: row.additionalAmount,
            balancePaymentMethod: row.balancePaymentMethod,
            dueDate: row.dueDate,
            confirmedVendor: row.confirmedVendor,
            notes: row.notes,
            paid: row.paid,
            paidAt: row.paid ? new Date() : null,
          },
        });
      }
    }
    return {
      mode: apply ? "apply" : "dry-run",
      applied: apply,
      create: plan.expenses.length,
      conflict: 0,
      plannedTotal,
      balanceDueTotal,
    };
  });
}

export function formatBudgetExpenseSummary(summary) {
  return [
    `mode=${summary.mode}`,
    `applied=${summary.applied}`,
    `create=${summary.create}`,
    `conflict=${summary.conflict}`,
    `plannedTotal=${summary.plannedTotal}`,
    `balanceDueTotal=${summary.balanceDueTotal}`,
  ].join(" ");
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function readRegularFileBytes(filePath) {
  const handle = await open(filePath, fileConstants.O_RDONLY);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return { isFile: false, text: "" };
    if (stats.size > MAX_PLAN_BYTES) invalid("費用計畫檔案過大。");
    const bytes = await handle.readFile();
    return {
      isFile: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } finally {
    await handle.close();
  }
}

export async function runBudgetExpenseCli(
  argv,
  {
    databaseUrl = process.env.DATABASE_URL,
    repositoryRoot = BUDGET_EXPENSE_REPOSITORY_ROOT,
    resolveRealPath = (filePath) => realpath(filePath),
    readCheckedFile = (filePath) => readRegularFileBytes(filePath),
    createClient = (url) => new PrismaClient({ datasources: { db: { url } } }),
    writeOutput = (line) => console.log(line),
    writeError = (line) => console.error(line),
  } = {},
) {
  let client;
  try {
    const options = parseBudgetExpenseCliArguments(argv);
    if (!databaseUrl) {
      throw new BudgetExpenseValidationError(
        "此 privileged offline operator command 需要 DATABASE_URL。",
      );
    }
    let resolvedRoot;
    let resolvedPlanPath;
    try {
      [resolvedRoot, resolvedPlanPath] = await Promise.all([
        resolveRealPath(repositoryRoot),
        resolveRealPath(options.planPath),
      ]);
    } catch {
      throw new BudgetExpenseValidationError("無法解析費用計畫路徑。");
    }
    if (pathIsInside(resolvedRoot, resolvedPlanPath)) {
      throw new BudgetExpenseValidationError("費用計畫必須位於 repository 外。");
    }
    let planFile;
    try {
      planFile = await readCheckedFile(resolvedPlanPath);
    } catch (error) {
      if (error instanceof BudgetExpenseValidationError) throw error;
      throw new BudgetExpenseValidationError("無法讀取費用計畫。");
    }
    if (!planFile.isFile) {
      throw new BudgetExpenseValidationError("費用計畫必須是一般檔案。");
    }
    const plan = parseBudgetExpensePlanJson(planFile.text);
    client = createClient(databaseUrl);
    const summary = await appendBudgetExpenses({
      client,
      workspaceId: options.workspaceId,
      actorUserId: options.actorUserId,
      plan,
      apply: options.apply,
    });
    writeOutput(formatBudgetExpenseSummary(summary));
    return summary.conflict > 0 ? 2 : 0;
  } catch (error) {
    if (
      error instanceof BudgetExpenseValidationError ||
      error instanceof BudgetExpenseConflictError
    ) {
      writeError(error.message);
    } else {
      writeError("新增失敗，沒有寫入任何資料。");
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
  process.exitCode = await runBudgetExpenseCli(process.argv.slice(2));
}
