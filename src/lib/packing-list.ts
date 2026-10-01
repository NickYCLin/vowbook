import "server-only";

import { Prisma, type WeddingWorkspace } from "@prisma/client";
import {
  type PackingCategoryValue,
  type PackingSideValue,
  type PackingSupplySource,
  suggestPackingSupplies,
} from "@/domain/packing-item";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

type PackingItemRecord = {
  id: string;
  title: string;
  side: PackingSideValue;
  category: PackingCategoryValue;
  note: string | null;
  packed: boolean;
  version: number;
};

type PackingTransaction = {
  membership: {
    findUnique(args: unknown): Promise<{
      role: string;
      workspace: Pick<WeddingWorkspace, "id" | "name">;
    } | null>;
  };
  packingItem: {
    findMany(args: unknown): Promise<PackingItemRecord[]>;
  };
  budgetItem: {
    findMany(args: unknown): Promise<PackingSupplySource[]>;
  };
};

type PackingPrismaClient = {
  $transaction<T>(
    callback: (transaction: PackingTransaction) => Promise<T>,
    options: { isolationLevel: string },
  ): Promise<T>;
};

export class PackingListDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackingListDataError";
  }
}

export async function getPackingList(workspaceId: string) {
  const currentUser = await requireCurrentUser();
  const packingPrisma = prisma as unknown as PackingPrismaClient;
  try {
    return await packingPrisma.$transaction(
      async (transaction) => {
        const access = await requireWorkspaceAccess<
          Pick<WeddingWorkspace, "id" | "name">
        >(workspaceId, currentUser.id, "read", transaction);
        const items = await transaction.packingItem.findMany({
          where: { workspaceId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            title: true,
            side: true,
            category: true,
            note: true,
            packed: true,
            version: true,
          },
        });
        const budgetItems = await transaction.budgetItem.findMany({
          where: { workspaceId },
          orderBy: [{ sourceOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            parentId: true,
            name: true,
            kind: true,
            systemTaxonomyKey: true,
            relatedTaxonomyItemKey: true,
            preparationStatus: true,
            plannedAmount: true,
            actualAmount: true,
          },
        });
        return {
          role: access.role,
          workspace: { id: access.workspace.id, name: access.workspace.name },
          items,
          supplySuggestions: suggestPackingSupplies(
            budgetItems,
            items
              .filter((item) => item.category === "WEDDING_SUPPLY")
              .map((item) => item.title),
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) throw error;
    throw new PackingListDataError("目前無法載入打包清單，請稍後再試。");
  }
}
