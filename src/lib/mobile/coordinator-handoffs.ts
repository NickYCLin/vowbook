import "server-only";

import { Prisma } from "@prisma/client";
import {
  HANDOFF_PHASE_LABELS,
  HANDOFF_STATUS_LABELS,
  HandoffValidationError,
  handoffLocalTime,
  normalizeHandoff,
} from "@/domain/coordinator-handoff";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { prisma } from "@/lib/prisma";
import {
  runSerializableTransaction,
  SerializationConflictError,
} from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

const EDITOR_ROLES = new Set(["OWNER", "PARTNER", "PLANNER", "COORDINATOR"]);
const STALE_MESSAGE = "這筆交辦剛剛被其他人更新，請重新整理後再試。";

export const HANDOFF_FIELDS = [
  "title",
  "details",
  "phase",
  "status",
  "dueAt",
  "staffId",
  "timelineItemId",
];

function failure(error: unknown): never {
  if (error instanceof MobileRequestError) throw error;
  if (error instanceof HandoffValidationError) {
    throw new MobileRequestError(400, "VALIDATION", error.message);
  }
  if (error instanceof WorkspaceAccessDeniedError) {
    throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
  }
  if (error instanceof SerializationConflictError) {
    throw new MobileRequestError(409, "CONFLICT", "剛剛有人同時操作，請重新整理後再試。");
  }
  throw new MobileRequestError(503, "UNAVAILABLE", "目前無法完成操作，請稍後再試。");
}

function versionOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "版本資訊無效，請重新整理後再試。");
  }
  return value;
}

export function handoffBody(body: unknown, allowed: string[]): Record<string, unknown> {
  // 工作區與身分只認路徑與已驗證的使用者，不從 body 讀。
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new MobileRequestError(400, "INVALID_REQUEST", "交辦事項輸入格式有誤。");
  }
  return body as Record<string, unknown>;
}

/** 借用網站那套 FormData 驗證，手機與網站的字數與時間規則才不會各走各的。 */
function details(fields: Record<string, unknown>) {
  const data = new FormData();
  for (const key of HANDOFF_FIELDS) {
    const value = fields[key];
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new HandoffValidationError("輸入格式有誤。");
    }
    data.set(key, typeof value === "string" ? value : "");
  }
  return normalizeHandoff(data);
}

type HandoffTransaction = {
  coordinatorHandoff: {
    create(args: unknown): Promise<{ id: string; version: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  weddingStaffAssignment: { findFirst(args: unknown): Promise<{ id: string } | null> };
  weddingTimelineItem: { findFirst(args: unknown): Promise<{ id: string } | null> };
};

async function assertReferences(client: HandoffTransaction, workspaceId: string, input: ReturnType<typeof details>) {
  if (input.staffId && !await client.weddingStaffAssignment.findFirst({ where: { id: input.staffId, workspaceId }, select: { id: true } })) {
    throw new HandoffValidationError("負責人已不存在，請重新選擇。");
  }
  if (input.timelineItemId && !await client.weddingTimelineItem.findFirst({ where: { id: input.timelineItemId, workspaceId }, select: { id: true } })) {
    throw new HandoffValidationError("流程已不存在，請重新選擇。");
  }
}

/** 交辦清單，連同可指派的工作人員與流程選項一起送，手機才不用多打一次 API。 */
export async function mobileHandoffs(workspaceId: string, userId: string) {
  const data = await prisma.$transaction(async (tx) => {
    const access = await requireWorkspaceAccess(workspaceId, userId, "read", tx);
    const [items, staff, timeline] = await Promise.all([
      tx.coordinatorHandoff.findMany({
        where: { workspaceId },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, title: true, details: true, phase: true, status: true, dueAt: true, staffId: true, timelineItemId: true, version: true },
      }),
      tx.weddingStaffAssignment.findMany({
        where: { workspaceId },
        orderBy: [{ roleName: "asc" }, { personName: "asc" }, { id: "asc" }],
        select: { id: true, roleName: true, personName: true },
      }),
      tx.weddingTimelineItem.findMany({
        where: { workspaceId },
        orderBy: [{ startMinute: "asc" }, { id: "asc" }],
        select: { id: true, title: true, startMinute: true },
      }),
    ]);
    return { role: access.role, items, staff, timeline };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  return {
    canEdit: EDITOR_ROLES.has(data.role),
    phases: Object.entries(HANDOFF_PHASE_LABELS).map(([key, label]) => ({ key, label })),
    statuses: Object.entries(HANDOFF_STATUS_LABELS).map(([key, label]) => ({ key, label })),
    handoffs: data.items.map((item) => ({
      id: item.id,
      title: item.title,
      details: item.details,
      phase: item.phase,
      status: item.status,
      // 手機直接拿台北時間的 yyyy-MM-ddTHH:mm，存回來時原樣送回即可。
      dueAt: handoffLocalTime(item.dueAt) || null,
      staffId: item.staffId,
      timelineItemId: item.timelineItemId,
      version: item.version,
    })),
    staff: data.staff.map((person) => ({ id: person.id, label: `${person.roleName} ${person.personName}` })),
    timeline: data.timeline.map((item) => ({
      id: item.id,
      label: `${String(Math.floor(item.startMinute / 60)).padStart(2, "0")}:${String(item.startMinute % 60).padStart(2, "0")} ${item.title}`,
    })),
  };
}

export async function mobileCreateHandoff(workspaceId: string, userId: string, fields: Record<string, unknown>) {
  try {
    const input = details(fields);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as HandoffTransaction;
      await assertReferences(client, workspaceId, input);
      const created = await client.coordinatorHandoff.create({
        data: { workspaceId, ...input },
        select: { id: true, version: true },
      });
      return { id: created.id, title: input.title, version: created.version };
    });
  } catch (error) {
    return failure(error);
  }
}

export async function mobileUpdateHandoff(workspaceId: string, userId: string, handoffId: string, fields: Record<string, unknown>) {
  try {
    const input = details(fields);
    const version = versionOf(fields.expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as HandoffTransaction;
      await assertReferences(client, workspaceId, input);
      const updated = await client.coordinatorHandoff.updateMany({
        where: { id: handoffId, workspaceId, version },
        data: { ...input, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { id: handoffId, title: input.title, version: version + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}

/** 現場最常用的動作：只把狀態往前推，不碰其他欄位。 */
export async function mobileSetHandoffStatus(workspaceId: string, userId: string, handoffId: string, status: unknown, expectedVersion: unknown) {
  try {
    if (typeof status !== "string" || !Object.hasOwn(HANDOFF_STATUS_LABELS, status)) {
      throw new MobileRequestError(400, "VALIDATION", "請選擇有效的處理狀態。");
    }
    const version = versionOf(expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as HandoffTransaction;
      const updated = await client.coordinatorHandoff.updateMany({
        where: { id: handoffId, workspaceId, version },
        data: { status, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { id: handoffId, status, version: version + 1 };
    });
  } catch (error) {
    return failure(error);
  }
}

export async function mobileDeleteHandoff(workspaceId: string, userId: string, handoffId: string, expectedVersion: unknown) {
  try {
    const version = versionOf(expectedVersion);
    return await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", transaction);
      const client = transaction as unknown as HandoffTransaction;
      const deleted = await client.coordinatorHandoff.deleteMany({
        where: { id: handoffId, workspaceId, version },
      });
      if (deleted.count !== 1) throw new MobileRequestError(409, "STALE", STALE_MESSAGE);
      return { removed: true };
    });
  } catch (error) {
    return failure(error);
  }
}
