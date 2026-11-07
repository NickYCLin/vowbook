import "server-only";

import { safeGoogleAvatarUrl } from "@/domain/profile-avatar";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/system-admin";

export async function listProductFeedback(before?: { date: Date; id: string }) {
  await requireSystemAdmin();
  const feedback = await prisma.productFeedback.findMany({
    where: before ? { OR: [
      { createdAt: { lt: before.date } },
      { createdAt: before.date, id: { lt: before.id } },
    ] } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    select: { id: true, section: true, category: true, message: true, contact: true, createdAt: true, author: { select: { id: true, name: true, image: true, avatar: { select: { updatedAt: true } } } } },
  });
  return feedback.map(({ author, ...item }) => ({
    ...item,
    author: {
      id: author.id,
      name: author.name,
      image: safeGoogleAvatarUrl(author.image),
      avatarUpdatedAt: author.avatar?.updatedAt.toISOString() ?? null,
    },
  }));
}
