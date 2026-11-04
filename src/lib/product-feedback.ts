import "server-only";

import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/system-admin";

export async function listProductFeedback(before?: { date: Date; id: string }) {
  await requireSystemAdmin();
  return prisma.productFeedback.findMany({
    where: before ? { OR: [
      { createdAt: { lt: before.date } },
      { createdAt: before.date, id: { lt: before.id } },
    ] } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    select: { id: true, section: true, category: true, message: true, contact: true, createdAt: true },
  });
}
