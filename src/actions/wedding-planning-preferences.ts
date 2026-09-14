"use server";

import { revalidatePath } from "next/cache";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WeddingPlanningPreferences = {
  hasEngagementCeremony: boolean;
  hasProcessionCeremony: boolean;
  version: number;
};

export type WeddingPlanningPreferencesMutationState = {
  status: "idle" | "success" | "error";
  code?: "VALIDATION" | "FORBIDDEN" | "STALE" | "UNAVAILABLE";
  message?: string;
  preferences?: WeddingPlanningPreferences;
};

type CountResult = { count: number };

type PreferenceTransaction = {
  weddingWorkspace: {
    updateMany(args: unknown): Promise<CountResult>;
  };
};

function checkbox(formData: FormData, name: string): boolean {
  const values = formData.getAll(name);
  if (values.length === 0) return false;
  if (values.length !== 1 || values[0] !== "on") {
    throw new Error("Invalid checkbox value.");
  }
  return true;
}

function expectedVersion(formData: FormData): number {
  const value = formData.get("expectedVersion");
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new Error("Invalid preference version.");
  }
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0 || version >= 2_147_483_647) {
    throw new Error("Invalid preference version.");
  }
  return version;
}

async function revalidatePlanningPreferenceViews(
  workspaceId: string,
): Promise<boolean> {
  let revalidated = true;
  for (const path of [`/workspaces/${workspaceId}/budget`, "/dashboard"]) {
    try {
      await revalidatePath(path);
    } catch {
      revalidated = false;
    }
  }
  if (!revalidated) {
    console.error("中式儀式設定已儲存，但相關頁面重新驗證失敗。");
  }
  return revalidated;
}

export async function updateWeddingPlanningPreferencesAction(
  workspaceId: string,
  _previousState: WeddingPlanningPreferencesMutationState,
  formData: FormData,
): Promise<WeddingPlanningPreferencesMutationState> {
  let preferences: WeddingPlanningPreferences;
  try {
    preferences = {
      hasEngagementCeremony: checkbox(formData, "hasEngagementCeremony"),
      hasProcessionCeremony: checkbox(formData, "hasProcessionCeremony"),
      version: expectedVersion(formData),
    };
  } catch {
    return {
      status: "error",
      code: "VALIDATION",
      message: "中式儀式設定無效，請重新整理後再試。",
    };
  }

  const currentUser = await requireCurrentUser();
  try {
    await requireWorkspaceAccess(workspaceId, currentUser.id, "edit");
  } catch (error) {
    return error instanceof WorkspaceAccessDeniedError
      ? {
          status: "error",
          code: "FORBIDDEN",
          message: error.message,
        }
      : {
          status: "error",
          code: "UNAVAILABLE",
          message: "目前無法確認工作區權限，請稍後再試。",
        };
  }

  try {
    const updated = await runSerializableTransaction(async (transaction) => {
      await requireLockedWorkspaceAccess(
        workspaceId,
        currentUser.id,
        "edit",
        transaction,
      );
      return (transaction as unknown as PreferenceTransaction).weddingWorkspace.updateMany({
        where: {
          id: workspaceId,
          ceremonyPreferencesVersion: preferences.version,
        },
        data: {
          hasEngagementCeremony: preferences.hasEngagementCeremony,
          hasProcessionCeremony: preferences.hasProcessionCeremony,
          ceremonyPreferencesVersion: { increment: 1 },
        },
      });
    });

    if (updated.count !== 1) {
      return {
        status: "error",
        code: "STALE",
        message: "中式儀式設定已被更新，請重新整理後再試。",
      };
    }
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新中式儀式設定，請稍後再試。",
    };
  }

  const nextPreferences = { ...preferences, version: preferences.version + 1 };
  return {
    status: "success",
    message: (await revalidatePlanningPreferenceViews(workspaceId))
      ? "已更新中式儀式設定。"
      : "已更新中式儀式設定；畫面未自動更新，請重新整理。",
    preferences: nextPreferences,
  };
}
