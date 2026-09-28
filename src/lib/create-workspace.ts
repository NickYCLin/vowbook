import "server-only";
import { randomUUID } from "node:crypto";
import { BUDGET_SYSTEM_NODES, type BudgetSystemNodeKey } from "@/domain/budget-item";
import type { NormalizedWorkspaceDetails } from "@/domain/workspace";
import { prisma } from "@/lib/prisma";

// Caller must supply the server-authenticated identity; never a client userId.
export async function createWorkspaceForUser(currentUserId: string, details: NormalizedWorkspaceDetails) {
    const taxonomyNodeIds = Object.fromEntries(
      BUDGET_SYSTEM_NODES.map((node) => [node.key, randomUUID()]),
    ) as Record<BudgetSystemNodeKey, string>;

    return prisma.$transaction((transaction) =>
      transaction.weddingWorkspace.create({
        data: {
          ...details,
          createdById: currentUserId,
          memberships: {
            create: {
              userId: currentUserId,
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
              balancePaymentMethod: null,
            })),
          },
        },
      }),
    );
}
