import "server-only";

import { normalizeProfileAvatar } from "@/domain/profile-avatar";
import { prisma } from "@/lib/prisma";

export async function readProfileAvatar(userId: string) {
  return prisma.userAvatar.findUnique({
    where: { userId },
    select: {
      data: true,
      mediaType: true,
      byteSize: true,
      sha256: true,
      updatedAt: true,
    },
  });
}

export async function findProfileAvatarUpdatedAt(
  userId: string,
): Promise<Date | null> {
  const avatar = await prisma.userAvatar.findUnique({
    where: { userId },
    select: { updatedAt: true },
  });
  return avatar?.updatedAt ?? null;
}

export async function saveProfileAvatar(input: {
  currentUserId: string;
  data: Uint8Array;
  mediaType: string;
}): Promise<{ updatedAt: string }> {
  const normalized = await normalizeProfileAvatar(input);
  const avatar = await prisma.userAvatar.upsert({
    where: { userId: input.currentUserId },
    create: {
      userId: input.currentUserId,
      data: Buffer.from(normalized.data),
      mediaType: normalized.mediaType,
      byteSize: normalized.byteSize,
      sha256: normalized.sha256,
    },
    update: {
      data: Buffer.from(normalized.data),
      mediaType: normalized.mediaType,
      byteSize: normalized.byteSize,
      sha256: normalized.sha256,
    },
    select: { updatedAt: true },
  });

  return { updatedAt: avatar.updatedAt.toISOString() };
}

export async function removeProfileAvatar(userId: string): Promise<boolean> {
  const removed = await prisma.userAvatar.deleteMany({ where: { userId } });
  return removed.count > 0;
}
