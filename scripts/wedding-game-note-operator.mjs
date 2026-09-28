import { constants as fileConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_NOTE_LENGTH = 200;
const MAX_ROWS = 20;
const MAX_PLAN_BYTES = 64 * 1024;
const GAMES = new Set(["BOUQUET", "BROCCOLI"]);
const AUTHORIZED_EDITOR_ROLES = new Set(["OWNER", "PARTNER", "PLANNER"]);

export const WEDDING_GAME_NOTE_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class WeddingGameNoteValidationError extends Error {}
export class WeddingGameNoteConflictError extends Error {}

function invalid(message) {
  throw new WeddingGameNoteValidationError(message);
}

export function parseWeddingGameNotePlanJson(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid("介紹詞計畫不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid("介紹詞計畫必須是物件。");
  if (parsed.version !== 1) invalid("介紹詞計畫版本不支援。");
  if (!Array.isArray(parsed.updates) || parsed.updates.length === 0) invalid("介紹詞計畫至少要有一筆。");
  if (parsed.updates.length > MAX_ROWS) invalid(`一次最多改 ${MAX_ROWS} 筆。`);
  const allowed = new Set(["participantId", "game", "name", "expectedVersion", "note"]);
  const ids = new Set();
  const updates = parsed.updates.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("每筆都必須是物件。");
    for (const key of Object.keys(raw)) if (!allowed.has(key)) invalid("含有不支援的欄位。");
    if (typeof raw.participantId !== "string" || !/^[a-z0-9]{10,40}$/u.test(raw.participantId)) invalid("名單編號無效。");
    if (ids.has(raw.participantId)) invalid("同一位不可重複。");
    ids.add(raw.participantId);
    if (!GAMES.has(raw.game)) invalid("遊戲類型無效。");
    if (typeof raw.name !== "string" || raw.name.trim() === "") invalid("姓名必須填寫，用來確認沒改錯人。");
    if (!Number.isSafeInteger(raw.expectedVersion) || raw.expectedVersion < 0) invalid("版本號無效。");
    if (typeof raw.note !== "string") invalid("介紹詞必須是字串。");
    const note = raw.note.normalize("NFC").trim();
    if (note === "") invalid("介紹詞不可空白。");
    if (Array.from(note).length > MAX_NOTE_LENGTH) invalid(`介紹詞最多 ${MAX_NOTE_LENGTH} 個字元。`);
    return {
      participantId: raw.participantId,
      game: raw.game,
      name: raw.name.normalize("NFC").trim(),
      expectedVersion: raw.expectedVersion,
      note,
    };
  });
  return { version: 1, updates };
}

export function parseWeddingGameNoteCliArguments(argv) {
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
    invalid("必須提供兩次 workspace、兩次操作者確認與介紹詞計畫；預設只執行 dry-run。");
  }
  if (workspaceId !== confirmWorkspaceId) invalid("兩次指定的婚宴工作區不一致。");
  if (actorUserId !== confirmActorUserId) invalid("兩次指定的操作者不一致。");
  if (path.basename(planPath).startsWith(".env")) invalid("介紹詞計畫不可使用環境設定檔。");
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
  throw new WeddingGameNoteConflictError("交易重試次數用盡。");
}

export async function updateWeddingGameNotes({ client, workspaceId, actorUserId, plan, apply = false }) {
  if (
    !client ||
    typeof workspaceId !== "string" ||
    workspaceId.trim() === "" ||
    typeof actorUserId !== "string" ||
    actorUserId.trim() === "" ||
    !plan
  ) {
    throw new WeddingGameNoteValidationError("缺少必要參數。");
  }
  return withSerializableRetry(client, async (transaction) => {
    const membership = await transaction.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actorUserId } },
      select: { role: true },
    });
    if (!membership || !AUTHORIZED_EDITOR_ROLES.has(membership.role)) {
      throw new WeddingGameNoteConflictError("操作者沒有這個婚宴的編輯權限。");
    }
    const workspace = await transaction.weddingWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) throw new WeddingGameNoteConflictError("找不到指定的婚宴。");
    const whereOf = (row) => ({
      id: row.participantId,
      workspaceId,
      game: row.game,
      name: row.name,
      version: row.expectedVersion,
    });
    // 編號、遊戲、姓名、版本全部對得上才改；有任何一筆被動過就整批不寫。
    let conflict = 0;
    for (const row of plan.updates) {
      if ((await transaction.weddingGameParticipant.count({ where: whereOf(row) })) !== 1) conflict += 1;
    }
    const mode = apply ? "apply" : "dry-run";
    if (conflict > 0) return { mode, applied: false, update: 0, conflict };
    if (apply) {
      for (const row of plan.updates) {
        const result = await transaction.weddingGameParticipant.updateMany({
          where: whereOf(row),
          data: { note: row.note, version: { increment: 1 } },
        });
        if (result.count !== 1) throw new WeddingGameNoteConflictError("名單剛被更新，沒有寫入任何資料。");
      }
    }
    return { mode, applied: apply, update: plan.updates.length, conflict: 0 };
  });
}

export function formatWeddingGameNoteSummary(summary) {
  return [
    `mode=${summary.mode}`,
    `applied=${summary.applied}`,
    `update=${summary.update}`,
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
    if (stats.size > MAX_PLAN_BYTES) invalid("介紹詞計畫檔案過大。");
    const bytes = await handle.readFile();
    return { isFile: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } finally {
    await handle.close();
  }
}

export async function runWeddingGameNoteCli(
  argv,
  {
    databaseUrl = process.env.DATABASE_URL,
    repositoryRoot = WEDDING_GAME_NOTE_REPOSITORY_ROOT,
    resolveRealPath = (filePath) => realpath(filePath),
    readCheckedFile = (filePath) => readRegularFileBytes(filePath),
    createClient = (url) => new PrismaClient({ datasources: { db: { url } } }),
    writeOutput = (line) => console.log(line),
    writeError = (line) => console.error(line),
  } = {},
) {
  let client;
  try {
    const options = parseWeddingGameNoteCliArguments(argv);
    if (!databaseUrl) {
      throw new WeddingGameNoteValidationError("此 privileged offline operator command 需要 DATABASE_URL。");
    }
    let resolvedRoot;
    let resolvedPlanPath;
    try {
      [resolvedRoot, resolvedPlanPath] = await Promise.all([
        resolveRealPath(repositoryRoot),
        resolveRealPath(options.planPath),
      ]);
    } catch {
      throw new WeddingGameNoteValidationError("無法解析介紹詞計畫路徑。");
    }
    if (pathIsInside(resolvedRoot, resolvedPlanPath)) {
      throw new WeddingGameNoteValidationError("介紹詞計畫必須位於 repository 外。");
    }
    let planFile;
    try {
      planFile = await readCheckedFile(resolvedPlanPath);
    } catch (error) {
      if (error instanceof WeddingGameNoteValidationError) throw error;
      throw new WeddingGameNoteValidationError("無法讀取介紹詞計畫。");
    }
    if (!planFile.isFile) throw new WeddingGameNoteValidationError("介紹詞計畫必須是一般檔案。");
    const plan = parseWeddingGameNotePlanJson(planFile.text);
    client = createClient(databaseUrl);
    const summary = await updateWeddingGameNotes({
      client,
      workspaceId: options.workspaceId,
      actorUserId: options.actorUserId,
      plan,
      apply: options.apply,
    });
    writeOutput(formatWeddingGameNoteSummary(summary));
    return summary.conflict > 0 ? 2 : 0;
  } catch (error) {
    if (
      error instanceof WeddingGameNoteValidationError ||
      error instanceof WeddingGameNoteConflictError
    ) {
      writeError(error.message);
    } else {
      writeError("更新失敗，沒有寫入任何資料。");
    }
    return 1;
  } finally {
    if (client) await client.$disconnect().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await runWeddingGameNoteCli(process.argv.slice(2));
}
