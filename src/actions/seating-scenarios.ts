"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SeatingScenarioValidationError } from "@/domain/seating-scenario";
import { SeatingTableValidationError } from "@/domain/seating-table";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import {
  addScenarioTable,
  applySeatingScenario,
  createSeatingScenarioFromLive,
  deleteSeatingScenario,
  removeScenarioTable,
  renameSeatingScenario,
  seatGuestInScenario,
  SeatingScenarioNotFoundError,
  SeatingScenarioStaleError,
  updateScenarioTable,
} from "@/lib/seating-scenarios";
import { SerializationConflictError } from "@/lib/serializable-transaction";

/**
 * 座位方案的 Server Actions。workspaceId、scenarioId、guestId、tableId 都來自
 * client，只當查詢條件；Membership 與「這些 id 屬於這場婚宴」一律由資料層在
 * 同一個交易內重新確認。
 */

export type SeatingScenarioMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
};

class InvalidFormError extends Error {}

function formVersion(formData: FormData): number {
  const raw = formData.get("expectedVersion");
  if (typeof raw !== "string" || !/^\d{1,9}$/u.test(raw)) {
    throw new InvalidFormError("版本資訊無效，請重新整理後再試。");
  }
  return Number(raw);
}

function formId(formData: FormData, key: string): string {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) {
    throw new InvalidFormError("資料已更新，請重新整理後再試。");
  }
  return raw;
}

function errorState(error: unknown): SeatingScenarioMutationState {
  if (
    error instanceof InvalidFormError ||
    error instanceof SeatingScenarioValidationError ||
    error instanceof SeatingTableValidationError ||
    error instanceof SeatingScenarioStaleError ||
    error instanceof SeatingScenarioNotFoundError ||
    error instanceof SerializationConflictError ||
    error instanceof WorkspaceAccessDeniedError
  ) {
    return { status: "error", message: error.message };
  }
  return { status: "error", message: "目前無法儲存座位方案，請稍後再試。" };
}

function tablesPath(workspaceId: string) {
  return `/workspaces/${workspaceId}/tables`;
}

function scenarioPath(workspaceId: string, scenarioId: string) {
  return `${tablesPath(workspaceId)}/scenarios/${scenarioId}`;
}

function revalidateScenario(workspaceId: string, scenarioId: string) {
  revalidatePath(tablesPath(workspaceId));
  revalidatePath(scenarioPath(workspaceId, scenarioId));
}

export async function createSeatingScenarioAction(
  workspaceId: string,
  _previous: SeatingScenarioMutationState,
  formData: FormData,
): Promise<SeatingScenarioMutationState> {
  const user = await requireCurrentUser();
  let scenarioId: string;
  try {
    const scenario = await createSeatingScenarioFromLive(workspaceId, user.id, formData.get("name"));
    scenarioId = scenario.id;
  } catch (error) {
    return errorState(error);
  }
  revalidatePath(tablesPath(workspaceId));
  redirect(scenarioPath(workspaceId, scenarioId));
}

export async function renameSeatingScenarioAction(
  workspaceId: string,
  scenarioId: string,
  _previous: SeatingScenarioMutationState,
  formData: FormData,
): Promise<SeatingScenarioMutationState> {
  const user = await requireCurrentUser();
  try {
    await renameSeatingScenario(workspaceId, user.id, scenarioId, formData.get("name"), formVersion(formData));
  } catch (error) {
    return errorState(error);
  }
  revalidateScenario(workspaceId, scenarioId);
  return { status: "success", message: "已更新方案名稱。" };
}

export async function deleteSeatingScenarioAction(
  workspaceId: string,
  scenarioId: string,
  _previous: SeatingScenarioMutationState,
  formData: FormData,
): Promise<SeatingScenarioMutationState> {
  const user = await requireCurrentUser();
  try {
    await deleteSeatingScenario(workspaceId, user.id, scenarioId, formVersion(formData));
  } catch (error) {
    return errorState(error);
  }
  revalidatePath(tablesPath(workspaceId));
  redirect(tablesPath(workspaceId));
}

export async function seatScenarioGuestAction(
  workspaceId: string,
  scenarioId: string,
  _previous: SeatingScenarioMutationState,
  formData: FormData,
): Promise<SeatingScenarioMutationState> {
  const user = await requireCurrentUser();
  try {
    const rawTable = formData.get("tableId");
    const tableId = rawTable === "" ? null : formId(formData, "tableId");
    await seatGuestInScenario(
      workspaceId,
      user.id,
      scenarioId,
      formId(formData, "guestId"),
      tableId,
      formVersion(formData),
    );
  } catch (error) {
    return errorState(error);
  }
  revalidateScenario(workspaceId, scenarioId);
  return { status: "success" };
}

function tableInput(formData: FormData) {
  return {
    name: formData.get("name"),
    capacity: formData.get("capacity"),
    notes: formData.get("notes") ?? "",
  };
}

export async function addScenarioTableAction(
  workspaceId: string,
  scenarioId: string,
  _previous: SeatingScenarioMutationState,
  formData: FormData,
): Promise<SeatingScenarioMutationState> {
  const user = await requireCurrentUser();
  try {
    await addScenarioTable(workspaceId, user.id, scenarioId, tableInput(formData), formVersion(formData));
  } catch (error) {
    return errorState(error);
  }
  revalidateScenario(workspaceId, scenarioId);
  return { status: "success", message: "已在方案裡加開一桌。" };
}

export async function updateScenarioTableAction(
  workspaceId: string,
  scenarioId: string,
  _previous: SeatingScenarioMutationState,
  formData: FormData,
): Promise<SeatingScenarioMutationState> {
  const user = await requireCurrentUser();
  try {
    await updateScenarioTable(
      workspaceId,
      user.id,
      scenarioId,
      formId(formData, "tableId"),
      tableInput(formData),
      formVersion(formData),
    );
  } catch (error) {
    return errorState(error);
  }
  revalidateScenario(workspaceId, scenarioId);
  return { status: "success", message: "已更新這桌。" };
}

export async function removeScenarioTableAction(
  workspaceId: string,
  scenarioId: string,
  _previous: SeatingScenarioMutationState,
  formData: FormData,
): Promise<SeatingScenarioMutationState> {
  const user = await requireCurrentUser();
  try {
    await removeScenarioTable(workspaceId, user.id, scenarioId, formId(formData, "tableId"), formVersion(formData));
  } catch (error) {
    return errorState(error);
  }
  revalidateScenario(workspaceId, scenarioId);
  return { status: "success", message: "已從方案移除這桌，原本坐這桌的人回到未入座。" };
}

export async function applySeatingScenarioAction(
  workspaceId: string,
  scenarioId: string,
  _previous: SeatingScenarioMutationState,
  formData: FormData,
): Promise<SeatingScenarioMutationState> {
  const user = await requireCurrentUser();
  let backupName: string;
  try {
    const fingerprint = formData.get("expectedLiveFingerprint");
    if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(fingerprint)) {
      throw new InvalidFormError("差異資訊無效，請重新整理後再試。");
    }
    const result = await applySeatingScenario(workspaceId, user.id, scenarioId, formVersion(formData), fingerprint);
    backupName = result.backupName;
  } catch (error) {
    return errorState(error);
  }
  // 正式安排會影響賓客名單、報到、列印與首頁統計，整個工作區一起重新整理。
  revalidatePath(`/workspaces/${workspaceId}`, "layout");
  return {
    status: "success",
    message: `已套用為正式安排。原本的安排存成「${backupName}」，需要時可以換回來。`,
  };
}
