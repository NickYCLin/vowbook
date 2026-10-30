import "server-only";
import { Prisma } from "@prisma/client";
import { normalizeWeddingStaffDetails, WeddingStaffValidationError } from "@/domain/wedding-staff";
import { isWeddingStaffTimelineAssignmentFingerprint, weddingStaffTimelineAssignmentFingerprint } from "@/domain/wedding-staff-timeline-snapshot";
import { prisma } from "@/lib/prisma";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";
import { runSerializableTransaction, SerializationConflictError } from "@/lib/serializable-transaction";
import { MobileRequestError } from "./protocol";

const invalid = (message = "工作人員輸入格式有誤。") => new MobileRequestError(400, "VALIDATION", message);
const stale = () => new MobileRequestError(409, "STALE", "工作人員或流程指派已變更，請重新整理後再試。");
const detailKeys = ["roleName", "personName", "contactPhone", "notes", "needsMeal", "mealCount", "vegetarianMealCount", "redEnvelopeAmount"];

function fields(body: unknown, allowed: string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) throw invalid();
  return body as Record<string, unknown>;
}

function versionOf(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid("版本資訊無效，請重新整理。");
  return value;
}

function detailsOf(input: Record<string, unknown>) {
  for (const key of ["contactPhone", "notes"]) {
    if (input[key] !== undefined && input[key] !== null && typeof input[key] !== "string") throw invalid();
  }
  if (typeof input.needsMeal !== "boolean") throw invalid("請確認是否需要便當。");
  try {
    return normalizeWeddingStaffDetails({ roleName: input.roleName, personName: input.personName, contactPhone: input.contactPhone,
      notes: input.notes, needsMeal: input.needsMeal, mealCount: input.mealCount, vegetarianMealCount: input.vegetarianMealCount,
      redEnvelopeAmount: input.redEnvelopeAmount });
  } catch (error) {
    if (error instanceof WeddingStaffValidationError) throw invalid(error.message);
    throw error;
  }
}

async function write<Result>(workspaceId: string, userId: string, operation: (tx: Prisma.TransactionClient) => Promise<Result>) {
  try {
    return await runSerializableTransaction(async (tx) => {
      await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
      return operation(tx);
    }, prisma);
  } catch (error) {
    if (error instanceof SerializationConflictError) throw stale();
    throw error;
  }
}

export async function mobileCreateStaff(workspaceId: string, userId: string, body: unknown) {
  const details = detailsOf(fields(body, detailKeys));
  return write(workspaceId, userId, (tx) => tx.weddingStaffAssignment.create({ data: { workspaceId, ...details }, select: { id: true, version: true } }));
}

export async function mobileUpdateStaff(workspaceId: string, userId: string, staffId: string, body: unknown) {
  const input = fields(body, [...detailKeys, "expectedVersion"]);
  const version = versionOf(input.expectedVersion);
  const details = detailsOf(input);
  return write(workspaceId, userId, async (tx) => {
    if (details.redEnvelopeAmount === null) {
      const current = await tx.weddingStaffAssignment.findFirst({ where: { id: staffId, workspaceId }, select: { version: true, redEnvelopeSentAt: true } });
      if (!current || current.version !== version) throw stale();
      if (current.redEnvelopeSentAt) throw invalid("紅包已標記為發放，請先改回尚未發放，再清空紅包金額。");
    }
    const result = await tx.weddingStaffAssignment.updateMany({ where: { id: staffId, workspaceId, version }, data: { ...details, version: { increment: 1 } } });
    if (result.count !== 1) throw stale();
    return { id: staffId, version: version + 1 };
  });
}

export async function mobileDeleteStaff(workspaceId: string, userId: string, staffId: string, body: unknown) {
  const input = fields(body, ["expectedVersion", "timelineAssignmentFingerprint"]);
  const version = versionOf(input.expectedVersion);
  if (!isWeddingStaffTimelineAssignmentFingerprint(input.timelineAssignmentFingerprint)) throw invalid("流程指派快照無效，請重新整理。");
  return write(workspaceId, userId, async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "wedding_staff_assignments"
      WHERE "id" = ${staffId} AND "workspace_id" = ${workspaceId} AND "version" = ${version} FOR UPDATE
    `);
    if (locked.length !== 1) throw stale();
    const assignments = await tx.$queryRaw<Array<{ timelineItemId: string }>>(Prisma.sql`
      SELECT "timeline_item_id" AS "timelineItemId" FROM "wedding_timeline_staff_assignments"
      WHERE "staff_assignment_id" = ${staffId} AND "workspace_id" = ${workspaceId}
      ORDER BY "timeline_item_id" ASC FOR UPDATE
    `);
    if (weddingStaffTimelineAssignmentFingerprint(assignments.map((assignment) => assignment.timelineItemId)) !== input.timelineAssignmentFingerprint) throw stale();
    const result = await tx.weddingStaffAssignment.deleteMany({ where: { id: staffId, workspaceId, version } });
    if (result.count !== 1) throw stale();
    return { deleted: true };
  });
}
