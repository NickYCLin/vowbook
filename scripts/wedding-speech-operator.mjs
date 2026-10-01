import { constants as fileConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_SPEECH_LENGTH = 3000;
const MAX_PLAN_BYTES = 64 * 1024;
const SPEECH_KINDS = new Set(["GROOM_PARENTS", "BRIDE_PARENTS"]);
const AUTHORIZED_EDITOR_ROLES = new Set(["OWNER", "PARTNER", "PLANNER", "COORDINATOR"]);

export const WEDDING_SPEECH_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class WeddingSpeechOperatorValidationError extends Error {}
export class WeddingSpeechOperatorConflictError extends Error {}

function invalid(message) {
  throw new WeddingSpeechOperatorValidationError(message);
}

/** 和網站編輯器同一套：統一換行、去掉行尾與頭尾空白。 */
function normalizeContent(value) {
  if (typeof value !== "string") invalid("致詞稿必須是字串。");
  const normalized = value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  if (normalized === "") invalid("致詞稿不可空白。");
  if (Array.from(normalized).length > MAX_SPEECH_LENGTH) {
    invalid(`致詞稿最多 ${MAX_SPEECH_LENGTH} 個字。`);
  }
  return normalized;
}

export function parseWeddingSpeechPlanJson(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid("致詞計畫不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalid("致詞計畫必須是物件。");
  }
  if (parsed.version !== 1) invalid("致詞計畫版本不支援。");
  if (!Array.isArray(parsed.speeches) || parsed.speeches.length === 0) {
    invalid("致詞計畫至少要有一份稿子。");
  }
  if (parsed.speeches.length > SPEECH_KINDS.size) invalid("致詞稿數量過多。");
  const kinds = new Set();
  const speeches = parsed.speeches.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalid("致詞稿必須是物件。");
    }
    for (const key of Object.keys(raw)) {
      if (key !== "kind" && key !== "content") invalid("致詞稿含有不支援的欄位。");
    }
    if (!SPEECH_KINDS.has(raw.kind)) invalid("致詞類型無效。");
    if (kinds.has(raw.kind)) invalid("同一種致詞稿只能有一份。");
    kinds.add(raw.kind);
    return { kind: raw.kind, content: normalizeContent(raw.content) };
  });
  return { version: 1, speeches };
}

export function parseWeddingSpeechCliArguments(argv) {
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
  if (!workspaceId || !confirmWorkspaceId || !actorUserId || !confirmActorUserId || !planPath) {
    invalid("必須提供兩次 workspace、兩次操作者確認與致詞計畫；預設只執行 dry-run。");
  }
  if (workspaceId !== confirmWorkspaceId) invalid("兩次指定的婚宴工作區不一致。");
  if (actorUserId !== confirmActorUserId) invalid("兩次指定的操作者不一致。");
  if (path.basename(planPath).startsWith(".env")) invalid("致詞計畫不可使用環境設定檔。");
  return { workspaceId, confirmWorkspaceId, actorUserId, confirmActorUserId, planPath, apply };
}

function isRetryableTransactionError(error) {
  return error && typeof error === "object" && error.code === "P2034";
}

async function withSerializableRetry(client, callback) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(callback, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw new WeddingSpeechOperatorConflictError("交易重試次數用盡。");
}

export async function appendWeddingSpeeches({ client, workspaceId, actorUserId, plan, apply = false }) {
  if (
    !client ||
    typeof workspaceId !== "string" ||
    workspaceId.trim() === "" ||
    typeof actorUserId !== "string" ||
    actorUserId.trim() === "" ||
    !plan
  ) {
    throw new WeddingSpeechOperatorValidationError("缺少必要參數。");
  }
  return withSerializableRetry(client, async (transaction) => {
    const membership = await transaction.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actorUserId } },
      select: { role: true },
    });
    if (!membership || !AUTHORIZED_EDITOR_ROLES.has(membership.role)) {
      throw new WeddingSpeechOperatorConflictError("操作者沒有這個婚宴的編輯權限。");
    }
    const workspace = await transaction.weddingWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) throw new WeddingSpeechOperatorConflictError("找不到指定的婚宴。");
    const existing = await transaction.weddingSpeech.findMany({
      where: { workspaceId },
      select: { kind: true },
    });
    const takenKinds = new Set(existing.map((row) => row.kind));
    // 只新增；已經有稿子就整批停下來，改稿交給網站，才不會蓋掉別人寫的。
    const conflicts = plan.speeches.filter((row) => takenKinds.has(row.kind));
    if (conflicts.length > 0) {
      return { mode: apply ? "apply" : "dry-run", applied: false, create: 0, conflict: conflicts.length };
    }
    if (apply) {
      for (const row of plan.speeches) {
        await transaction.weddingSpeech.create({
          data: { workspaceId, kind: row.kind, content: row.content },
        });
      }
    }
    return { mode: apply ? "apply" : "dry-run", applied: apply, create: plan.speeches.length, conflict: 0 };
  });
}

export function formatWeddingSpeechSummary(summary) {
  return [
    `mode=${summary.mode}`,
    `applied=${summary.applied}`,
    `create=${summary.create}`,
    `conflict=${summary.conflict}`,
  ].join(" ");
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readRegularFileBytes(filePath) {
  const handle = await open(filePath, fileConstants.O_RDONLY);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return { isFile: false, text: "" };
    if (stats.size > MAX_PLAN_BYTES) invalid("致詞計畫檔案過大。");
    const bytes = await handle.readFile();
    return { isFile: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } finally {
    await handle.close();
  }
}

export async function runWeddingSpeechCli(
  argv,
  {
    databaseUrl = process.env.DATABASE_URL,
    repositoryRoot = WEDDING_SPEECH_REPOSITORY_ROOT,
    resolveRealPath = (filePath) => realpath(filePath),
    readCheckedFile = (filePath) => readRegularFileBytes(filePath),
    createClient = (url) => new PrismaClient({ datasources: { db: { url } } }),
    writeOutput = (line) => console.log(line),
    writeError = (line) => console.error(line),
  } = {},
) {
  let client;
  try {
    const options = parseWeddingSpeechCliArguments(argv);
    if (!databaseUrl) {
      throw new WeddingSpeechOperatorValidationError("此 privileged offline operator command 需要 DATABASE_URL。");
    }
    let resolvedRoot;
    let resolvedPlanPath;
    try {
      [resolvedRoot, resolvedPlanPath] = await Promise.all([
        resolveRealPath(repositoryRoot),
        resolveRealPath(options.planPath),
      ]);
    } catch {
      throw new WeddingSpeechOperatorValidationError("無法解析致詞計畫路徑。");
    }
    if (pathIsInside(resolvedRoot, resolvedPlanPath)) {
      throw new WeddingSpeechOperatorValidationError("致詞計畫必須位於 repository 外。");
    }
    let planFile;
    try {
      planFile = await readCheckedFile(resolvedPlanPath);
    } catch (error) {
      if (error instanceof WeddingSpeechOperatorValidationError) throw error;
      throw new WeddingSpeechOperatorValidationError("無法讀取致詞計畫。");
    }
    if (!planFile.isFile) throw new WeddingSpeechOperatorValidationError("致詞計畫必須是一般檔案。");
    const plan = parseWeddingSpeechPlanJson(planFile.text);
    client = createClient(databaseUrl);
    const summary = await appendWeddingSpeeches({
      client,
      workspaceId: options.workspaceId,
      actorUserId: options.actorUserId,
      plan,
      apply: options.apply,
    });
    writeOutput(formatWeddingSpeechSummary(summary));
    return summary.conflict > 0 ? 2 : 0;
  } catch (error) {
    if (
      error instanceof WeddingSpeechOperatorValidationError ||
      error instanceof WeddingSpeechOperatorConflictError
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

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await runWeddingSpeechCli(process.argv.slice(2));
}
