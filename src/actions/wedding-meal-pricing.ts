"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeWeddingMealPricing,
  WeddingMealPricingError,
} from "@/domain/budget-derived-cost";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";

export type WeddingMealPricingMutationState = {
  status: "idle" | "success" | "error";
  code?: "VALIDATION" | "FORBIDDEN" | "UNAVAILABLE";
  message?: string;
};

type PricingTransaction = {
  weddingWorkspace: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function updateWeddingMealPricingAction(
  workspaceId: string,
  _previousState: WeddingMealPricingMutationState,
  formData: FormData,
): Promise<WeddingMealPricingMutationState> {
  let pricing;
  try {
    pricing = normalizeWeddingMealPricing({
      staffMealUnitPrice: formData.get("staffMealUnitPrice"),
      vegetarianMealUnitPrice: formData.get("vegetarianMealUnitPrice"),
      serviceChargePercent: formData.get("serviceChargePercent"),
    });
  } catch (error) {
    return {
      status: "error",
      code: "VALIDATION",
      message:
        error instanceof WeddingMealPricingError
          ? error.message
          : "餐費設定無效，請確認後再試。",
    };
  }

  const currentUser = await requireCurrentUser();
  try {
    await requireWorkspaceAccess(workspaceId, currentUser.id, "edit");
  } catch (error) {
    return error instanceof WorkspaceAccessDeniedError
      ? { status: "error", code: "FORBIDDEN", message: error.message }
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
      return (
        transaction as unknown as PricingTransaction
      ).weddingWorkspace.updateMany({
        where: { id: workspaceId },
        data: pricing,
      });
    });
    if (updated.count !== 1) {
      return {
        status: "error",
        code: "UNAVAILABLE",
        message: "目前無法儲存餐費設定，請稍後再試。",
      };
    }
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      return { status: "error", code: "FORBIDDEN", message: error.message };
    }
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法儲存餐費設定，請稍後再試。",
    };
  }

  let revalidated = true;
  for (const path of [`/workspaces/${workspaceId}/budget`, "/dashboard"]) {
    try {
      await revalidatePath(path);
    } catch {
      revalidated = false;
    }
  }
  return revalidated
    ? { status: "success" }
    : {
        status: "success",
        message: "餐費設定已儲存；畫面未自動更新，請重新整理。",
      };
}
