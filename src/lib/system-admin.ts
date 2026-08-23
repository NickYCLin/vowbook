import "server-only";

import { createHash } from "node:crypto";
import type {
  MembershipRole,
  PrismaClient,
  User,
  UserAccessStatus,
} from "@prisma/client";
import { normalizeInvitationEmail } from "@/domain/workspace-invitation";
import { requireCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

const ADMIN_HASH_PATTERN = /^[a-f0-9]{64}$/u;

export class SystemAdminAccessDeniedError extends Error {
  constructor() {
    super("無法存取系統管理功能。");
    this.name = "SystemAdminAccessDeniedError";
  }
}

export class SystemAdminConfigurationError extends Error {
  constructor() {
    super("系統管理者設定無效。");
    this.name = "SystemAdminConfigurationError";
  }
}

export class SystemAdminProtectedUserError extends Error {
  constructor() {
    super("系統管理者帳號不能被停權或移除。");
    this.name = "SystemAdminProtectedUserError";
  }
}

export class SystemAdminStaleWriteError extends Error {
  constructor() {
    super("使用者狀態已更新，請重新整理後再試。");
    this.name = "SystemAdminStaleWriteError";
  }
}

export function systemAdminEmailHash(email: string): string {
  return createHash("sha256")
    .update(normalizeInvitationEmail(email), "utf8")
    .digest("hex");
}

export function configuredSystemAdminEmailHashes(
  configured = process.env.VOWBOOK_ADMIN_EMAIL_HASHES ?? "",
): Set<string> {
  if (!configured.trim()) return new Set();

  const hashes = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (hashes.length === 0 || hashes.some((hash) => !ADMIN_HASH_PATTERN.test(hash))) {
    throw new SystemAdminConfigurationError();
  }
  return new Set(hashes);
}

export function isSystemAdmin(
  user: Pick<User, "email" | "accessStatus">,
  configured = process.env.VOWBOOK_ADMIN_EMAIL_HASHES ?? "",
): boolean {
  if (user.accessStatus !== "ACTIVE") return false;

  try {
    return configuredSystemAdminEmailHashes(configured).has(
      systemAdminEmailHash(user.email),
    );
  } catch {
    return false;
  }
}

export async function requireSystemAdmin(): Promise<User> {
  const currentUser = await requireCurrentUser();
  if (!isSystemAdmin(currentUser)) {
    throw new SystemAdminAccessDeniedError();
  }
  return currentUser;
}

export type SystemUserSummary = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  accessStatus: UserAccessStatus;
  accessStatusChangedAt: Date | null;
  lastLoginAt: Date | null;
  version: number;
  createdAt: Date;
  memberships: Array<{
    role: MembershipRole;
    workspace: { id: string; name: string };
  }>;
  systemAdmin: boolean;
};

export async function listSystemUsers(): Promise<SystemUserSummary[]> {
  await requireSystemAdmin();
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      accessStatus: true,
      accessStatusChangedAt: true,
      lastLoginAt: true,
      version: true,
      createdAt: true,
      memberships: {
        orderBy: [{ workspace: { createdAt: "asc" } }, { workspaceId: "asc" }],
        select: {
          role: true,
          workspace: { select: { id: true, name: true } },
        },
      },
    },
  });

  return users.map((user) => ({
    ...user,
    systemAdmin: isSystemAdmin(user),
  }));
}

type SystemUserAccessClient = {
  user: {
    findUnique(args: unknown): Promise<
      | Pick<User, "id" | "email" | "accessStatus" | "version">
      | null
    >;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function updateSystemUserAccessStatus(
  actor: Pick<User, "id" | "email" | "accessStatus">,
  targetUserId: string,
  expectedVersion: number,
  accessStatus: UserAccessStatus,
  client: SystemUserAccessClient = prisma as unknown as SystemUserAccessClient,
): Promise<void> {
  const target = await client.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      accessStatus: true,
      version: true,
    },
  });

  if (!target || target.version !== expectedVersion) {
    throw new SystemAdminStaleWriteError();
  }
  if (target.id === actor.id || isSystemAdmin(target)) {
    throw new SystemAdminProtectedUserError();
  }

  const result = await client.user.updateMany({
    where: { id: target.id, version: expectedVersion },
    data: {
      accessStatus,
      accessStatusChangedAt: new Date(),
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) {
    throw new SystemAdminStaleWriteError();
  }
}

export type SystemAdminPrismaClient = Pick<PrismaClient, "$transaction">;
