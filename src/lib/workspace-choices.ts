import "server-only";
import { prisma } from "@/lib/prisma";

/** Membership is the query root; this never accepts a client-supplied workspace filter. */
export async function listWorkspaceChoicesForUser(currentUserId: string) {
  return prisma.membership.findMany({
    where: { userId: currentUserId },
    select: {
      id: true,
      role: true,
      workspace: { select: { id: true, name: true, weddingDate: true, timezone: true, updatedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
