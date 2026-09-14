export const HANDOFF_STATUS_LABELS = { PENDING: "待確認", CONFIRMED: "已確認", DONE: "已完成" } as const;
export const HANDOFF_PHASE_LABELS = { PREPARATION: "婚前準備", EVENT_DAY: "婚宴當日" } as const;
export type HandoffStatus = keyof typeof HANDOFF_STATUS_LABELS;
export type HandoffPhase = keyof typeof HANDOFF_PHASE_LABELS;
export class HandoffValidationError extends Error {}
export function handoffLocalTime(value: Date | string | null): string {
  return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16) : "";
}
function field(data: FormData, key: string, max: number, required = false): string {
  const raw = data.get(key);
  if (raw !== null && typeof raw !== "string") throw new HandoffValidationError("輸入格式有誤。");
  const value = (raw ?? "").trim();
  if ((required && !value) || [...value].length > max) throw new HandoffValidationError("請填寫事項名稱與交代內容，並確認字數限制。");
  return value;
}
export function normalizeHandoff(data: FormData) {
  const title = field(data, "title", 120, true);
  const details = field(data, "details", 2000, true);
  const phase = field(data, "phase", 30) as HandoffPhase;
  const status = field(data, "status", 30) as HandoffStatus;
  if (!Object.hasOwn(HANDOFF_PHASE_LABELS, phase) || !Object.hasOwn(HANDOFF_STATUS_LABELS, status)) throw new HandoffValidationError("請選擇有效的處理時機與狀態。");
  const rawDue = field(data, "dueAt", 16);
  let dueAt: Date | null = null;
  if (rawDue) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(rawDue)) throw new HandoffValidationError("請填寫完整的完成日期與時間。");
    dueAt = new Date(rawDue + ":00+08:00");
    if (!Number.isFinite(dueAt.getTime()) || handoffLocalTime(dueAt) !== rawDue) throw new HandoffValidationError("完成時間無效。");
  }
  return { title, details, phase, status, dueAt, staffId: field(data, "staffId", 128) || null, timelineItemId: field(data, "timelineItemId", 128) || null };
}
export function handoffVersion(data: FormData) {
  const raw = data.get("expectedVersion");
  if (typeof raw !== "string" || !/^\d+$/u.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) >= 2147483647) throw new HandoffValidationError("版本資訊無效，請重新整理後再試。");
  return Number(raw);
}
