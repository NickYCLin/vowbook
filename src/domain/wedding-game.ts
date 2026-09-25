export const WEDDING_GAMES = ["BOUQUET", "BROCCOLI"] as const;

export type WeddingGameKey = (typeof WEDDING_GAMES)[number];

export const WEDDING_GAME_LABELS: Record<WeddingGameKey, string> = {
  BOUQUET: "新娘捧花遊戲",
  BROCCOLI: "新郎花椰菜遊戲",
};

/** 單一遊戲最多上台人數；實際場上通常 6 到 12 位，留足空間給候補。 */
export const WEDDING_GAME_MAX_PARTICIPANTS = 40;
export const WEDDING_GAME_NAME_MAX = 60;
export const WEDDING_GAME_NOTE_MAX = 200;

export class WeddingGameValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeddingGameValidationError";
  }
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

export function parseWeddingGame(value: unknown): WeddingGameKey {
  if (
    typeof value !== "string" ||
    !(WEDDING_GAMES as readonly string[]).includes(value)
  ) {
    throw new WeddingGameValidationError("遊戲類型無效，請重新整理後再試。");
  }
  return value as WeddingGameKey;
}

export function normalizeWeddingGameName(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  const count = characterCount(normalized);
  if (count < 1 || count > WEDDING_GAME_NAME_MAX) {
    throw new WeddingGameValidationError(
      `姓名需為 1 到 ${WEDDING_GAME_NAME_MAX} 個字元。`,
    );
  }
  return normalized;
}

/**
 * 新增時可一次貼上多位：頓號、逗號或換行都當分隔。
 * 同一次輸入重複的姓名只留一筆。
 */
export function normalizeWeddingGameNames(value: unknown): string[] {
  const raw = typeof value === "string" ? value : "";
  const names: string[] = [];
  for (const part of raw.split(/[\n\r、，,；;]+/u)) {
    if (part.trim() === "") continue;
    const name = normalizeWeddingGameName(part);
    if (!names.includes(name)) names.push(name);
  }
  if (names.length === 0) {
    throw new WeddingGameValidationError("請輸入至少一位姓名。");
  }
  if (names.length > WEDDING_GAME_MAX_PARTICIPANTS) {
    throw new WeddingGameValidationError(
      `每個遊戲最多 ${WEDDING_GAME_MAX_PARTICIPANTS} 位。`,
    );
  }
  return names;
}

export function normalizeWeddingGameNote(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (characterCount(normalized) > WEDDING_GAME_NOTE_MAX) {
    throw new WeddingGameValidationError(
      `介紹詞最多 ${WEDDING_GAME_NOTE_MAX} 個字元。`,
    );
  }
  return normalized === "" ? null : normalized;
}

export type WeddingGameEntry = { name: string; note: string | null };

/**
 * 同 normalizeWeddingGameNames，但一行可以寫成「姓名：介紹詞」，
 * 方便把寫好的介紹一次貼進來。沒有冒號的行照舊用頓號、逗號分隔多位。
 */
export function normalizeWeddingGameEntries(value: unknown): WeddingGameEntry[] {
  const raw = typeof value === "string" ? value : "";
  const entries: WeddingGameEntry[] = [];
  const push = (entry: WeddingGameEntry) => {
    const existing = entries.find((item) => item.name === entry.name);
    if (!existing) entries.push(entry);
    else if (entry.note && !existing.note) existing.note = entry.note;
  };
  for (const line of raw.split(/[\n\r]+/u)) {
    const match = /^([^:：]*)[:：](.*)$/u.exec(line);
    if (match) {
      push({
        name: normalizeWeddingGameName(match[1]),
        note: normalizeWeddingGameNote(match[2]),
      });
      continue;
    }
    for (const part of line.split(/[、，,；;]+/u)) {
      if (part.trim() === "") continue;
      push({ name: normalizeWeddingGameName(part), note: null });
    }
  }
  if (entries.length === 0) {
    throw new WeddingGameValidationError("請輸入至少一位姓名。");
  }
  if (entries.length > WEDDING_GAME_MAX_PARTICIPANTS) {
    throw new WeddingGameValidationError(
      `每個遊戲最多 ${WEDDING_GAME_MAX_PARTICIPANTS} 位。`,
    );
  }
  return entries;
}
