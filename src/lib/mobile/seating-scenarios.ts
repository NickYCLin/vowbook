import "server-only";

import { SeatingScenarioValidationError } from "@/domain/seating-scenario";
import { SeatingTableValidationError } from "@/domain/seating-table";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import {
  SeatingScenarioNotFoundError,
  SeatingScenarioStaleError,
} from "@/lib/seating-scenarios";
import { SerializationConflictError } from "@/lib/serializable-transaction";

/**
 * 手機座位方案只是把網站的資料層包成 JSON。workspace、方案與桌次 id 一律看路徑，
 * Membership 與「這些 id 屬於這場婚宴」由資料層在同一個交易裡重新確認。
 */

export function scenarioBody(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "座位方案輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

export function scenarioVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "版本資訊無效，請重新整理後再試。");
  }
  return value;
}

/** guestId、tableId 這類 client 帶來的 id 只當查詢條件，先擋掉明顯不合理的值。 */
export function scenarioId(value: unknown, allowNull = false): string | null {
  if (allowNull && value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "資料已更新，請重新整理後再試。");
  }
  return value;
}

export function liveFingerprint(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "正式安排已更新，請重新整理後再試。");
  }
  return value;
}

/** 讀取時沒權限沿用共用訊息；修改時多半是唯讀成員，要講清楚是沒有編輯權限。 */
export function scenarioFailure(error: unknown, mode: "read" | "edit" = "edit"): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof SeatingScenarioValidationError || error instanceof SeatingTableValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof SeatingScenarioNotFoundError) {
    throw new MobileRequestError(404, "NOT_FOUND", error.message);
  }
  if (error instanceof SeatingScenarioStaleError || error instanceof SerializationConflictError) {
    throw new MobileRequestError(409, "CONFLICT", error.message);
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    if (mode === "read") throw error;
    throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法處理座位方案，請稍後再試。");
}
