"use server";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  normalizeWorkspaceDeletionConfirmation,
  normalizeWorkspaceDetails,
  normalizeWorkspaceName,
  normalizeWorkspaceUpdatedAt,
  type NormalizedWorkspaceDetails,
  WorkspaceValidationError,
} from "@/domain/workspace";
import {
  BUDGET_SYSTEM_NODES,
  type BudgetSystemNodeKey,
} from "@/domain/budget-item";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

export type CreateWorkspaceState = {
  status: "idle" | "error";
  message?: string;
};

export type WorkspaceMutationCode =
  | "VALIDATION"
  | "STALE"
  | "CONFIRMATION"
  | "UNAVAILABLE";

export type WorkspaceMutationState = {
  status: "idle" | "success" | "error";
  code?: WorkspaceMutationCode;
  message?: string;
};

const WORKSPACE_MODULE_PATHS = [
  "guests",
  "tables",
  "tasks",
  "budget",
  "staff",
  "timeline",
  "members",
] as const;

function detailsFromFormData(formData: FormData): NormalizedWorkspaceDetails {
  return normalizeWorkspaceDetails({
    name: formData.get("name"),
    weddingDate: formData.get("weddingDate"),
    timezone: formData.get("timezone"),
  });
}

function mutationValidationState(error: unknown): WorkspaceMutationState {
  return {
    status: "error",
    code: "VALIDATION",
    message:
      error instanceof WorkspaceValidationError
        ? error.message
        : "輸入內容有誤，請重新確認。",
  };
}

function staleState(): WorkspaceMutationState {
  return {
    status: "error",
    code: "STALE",
    message: "婚宴工作區已被更新或不存在，請重新整理後再試。",
  };
}

async function isTransactionOwner(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  currentUserId: string,
): Promise<boolean> {
  const memberships = await transaction.$queryRaw<Array<{ role: string }>>`
    SELECT "role"::text AS "role"
    FROM "memberships"
    WHERE "workspace_id" = ${workspaceId}
      AND "user_id" = ${currentUserId}
    FOR UPDATE
  `;

  return memberships[0]?.role === "OWNER";
}

function revalidateUpdatedWorkspace(workspaceId: string): boolean {
  try {
    revalidatePath("/dashboard");
    for (const modulePath of WORKSPACE_MODULE_PATHS) {
      revalidatePath(`/workspaces/${workspaceId}/${modulePath}`);
    }
    return true;
  } catch {
    console.error("婚宴工作區頁面重新驗證失敗。");
    return false;
  }
}

function revalidateWorkspaceCollection(): void {
  try {
    revalidatePath("/dashboard");
    revalidatePath("/onboarding");
  } catch {
    console.error("婚宴工作區清單重新驗證失敗。");
  }
}

export async function createWorkspaceAction(
  _previousState: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const currentUser = await requireCurrentUser();

  let details: NormalizedWorkspaceDetails;
  try {
    details = detailsFromFormData(formData);
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      return { status: "error", message: error.message };
    }

    return { status: "error", message: "輸入內容有誤，請重新確認。" };
  }

  try {
    const taxonomyNodeIds = Object.fromEntries(
      BUDGET_SYSTEM_NODES.map((node) => [node.key, randomUUID()]),
    ) as Record<BudgetSystemNodeKey, string>;

    await prisma.$transaction((transaction) =>
      transaction.weddingWorkspace.create({
        data: {
          ...details,
          createdById: currentUser.id,
          memberships: {
            create: {
              userId: currentUser.id,
              role: "OWNER",
            },
          },
          budgetItems: {
            create: BUDGET_SYSTEM_NODES.map((node) => ({
              id: taxonomyNodeIds[node.key],
              parentId:
                node.parentKey === null
                  ? null
                  : taxonomyNodeIds[node.parentKey],
              source: "MANUAL" as const,
              externalId: null,
              sourceHash: null,
              sourceOrder: node.sourceOrder,
              name: node.label,
              kind: "GROUP" as const,
              category: null,
              systemTaxonomyKey: node.key,
              legacyCategory: null,
              plannedAmount: 0,
              actualAmount: null,
              dueDate: null,
              notes: null,
              paid: false,
              paidAt: null,
              bookingStatus: "PLANNING" as const,
              depositAmount: null,
              balanceAmount: null,
              additionalAmount: null,
              estimatedRange: null,
              candidateVendors: null,
              confirmedVendor: null,
              vendorContact: null,
              primaryContact: null,
            })),
          },
        },
      }),
    );
  } catch {
    return {
      status: "error",
      message: "目前無法建立婚宴工作區，請稍後再試。",
    };
  }

  revalidateWorkspaceCollection();
  redirect("/dashboard");
}

export async function updateWorkspaceAction(
  workspaceId: string,
  _previousState: WorkspaceMutationState,
  formData: FormData,
): Promise<WorkspaceMutationState> {
  const currentUser = await requireCurrentUser();

  let details: NormalizedWorkspaceDetails;
  let expectedUpdatedAt: Date;
  try {
    details = detailsFromFormData(formData);
    expectedUpdatedAt = normalizeWorkspaceUpdatedAt(
      formData.get("expectedUpdatedAt"),
    );
  } catch (error) {
    return mutationValidationState(error);
  }

  let outcome: "UPDATED" | "STALE";
  try {
    outcome = await prisma.$transaction(async (transaction) => {
      if (!(await isTransactionOwner(transaction, workspaceId, currentUser.id))) {
        return "STALE";
      }

      const result = await transaction.weddingWorkspace.updateMany({
        where: { id: workspaceId, updatedAt: expectedUpdatedAt },
        data: details,
      });
      return result.count === 1 ? "UPDATED" : "STALE";
    });
  } catch {
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法更新婚宴工作區，請稍後再試。",
    };
  }

  if (outcome === "STALE") {
    return staleState();
  }

  return {
    status: "success",
    message: revalidateUpdatedWorkspace(workspaceId)
      ? "已更新婚宴工作區。"
      : "已更新婚宴工作區；畫面未自動更新，請重新整理。",
  };
}

export async function deleteWorkspaceAction(
  workspaceId: string,
  _previousState: WorkspaceMutationState,
  formData: FormData,
): Promise<WorkspaceMutationState> {
  const currentUser = await requireCurrentUser();

  let confirmationName: string;
  let expectedUpdatedAt: Date;
  try {
    confirmationName = normalizeWorkspaceDeletionConfirmation(
      formData.get("confirmationName"),
    );
    expectedUpdatedAt = normalizeWorkspaceUpdatedAt(
      formData.get("expectedUpdatedAt"),
    );
  } catch (error) {
    return mutationValidationState(error);
  }

  let outcome:
    | { type: "DELETED"; remainingWorkspaceCount: number }
    | { type: "STALE" }
    | { type: "CONFIRMATION" };
  try {
    outcome = await prisma.$transaction(async (transaction) => {
      if (!(await isTransactionOwner(transaction, workspaceId, currentUser.id))) {
        return { type: "STALE" as const };
      }

      const workspace = await transaction.weddingWorkspace.findFirst({
        where: { id: workspaceId, updatedAt: expectedUpdatedAt },
        select: { name: true },
      });
      if (!workspace) {
        return { type: "STALE" as const };
      }

      if (confirmationName !== normalizeWorkspaceName(workspace.name)) {
        return { type: "CONFIRMATION" as const };
      }

      const result = await transaction.weddingWorkspace.deleteMany({
        where: { id: workspaceId, updatedAt: expectedUpdatedAt },
      });
      if (result.count !== 1) {
        return { type: "STALE" as const };
      }

      const remainingWorkspaceCount = await transaction.membership.count({
        where: { userId: currentUser.id },
      });
      return { type: "DELETED" as const, remainingWorkspaceCount };
    });
  } catch {
    return {
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法刪除婚宴工作區，請稍後再試。",
    };
  }

  if (outcome.type === "STALE") {
    return staleState();
  }
  if (outcome.type === "CONFIRMATION") {
    return {
      status: "error",
      code: "CONFIRMATION",
      message: "婚宴名稱不相符，工作區未刪除。",
    };
  }

  revalidateWorkspaceCollection();
  redirect(
    outcome.remainingWorkspaceCount === 0
      ? "/onboarding"
      : "/dashboard?workspaceDeleted=1",
  );
}
