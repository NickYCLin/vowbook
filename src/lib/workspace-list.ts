import "server-only";

import { prisma } from "@/lib/prisma";

export function listWorkspacesForUser(currentUserId: string) {
  return prisma.membership.findMany({
    where: { userId: currentUserId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
}
