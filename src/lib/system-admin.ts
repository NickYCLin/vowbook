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

export class SystemAdminDeleteConfirmationError extends Error {
  constructor() {
    super("請輸入完全相同的 Email 以確認刪除。");
    this.name = "SystemAdminDeleteConfirmationError";
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
  /** 由這個帳號建立的婚宴；刪除帳號會連同整場婚宴一起刪掉，所以先讓管理者看見。 */
  createdWorkspaces: Array<{
    id: string;
    name: string;
    memberCount: number;
    guestCount: number;
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
      createdWorkspaces: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          _count: { select: { memberships: true, guests: true } },
        },
      },
    },
  });

  return users.map(({ createdWorkspaces, ...user }) => ({
    ...user,
    createdWorkspaces: createdWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      memberCount: workspace._count.memberships,
      guestCount: workspace._count.guests,
    })),
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

type SystemUserDeleteClient = {
  user: {
    findUnique(args: unknown): Promise<
      | Pick<User, "id" | "email" | "accessStatus" | "version">
      | null
    >;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  weddingWorkspace: { deleteMany(args: unknown): Promise<{ count: number }> };
  budgetAttachment: { deleteMany(args: unknown): Promise<{ count: number }> };
  workspaceInvitation: {
    deleteMany(args: unknown): Promise<{ count: number }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

/**
 * 徹底刪除一個帳號。這是不可回復的操作，所以要求輸入相同的 Email 再確認一次。
 *
 * 由這個帳號建立的婚宴會一起刪除，裡面的名單、桌次、花費、附件都跟著走；
 * 他在別人婚宴裡的成員身分、上傳的收據與送出的邀請也會一併清掉。
 * 這些關聯在資料庫上是 Restrict，本來就不允許留著孤兒資料。
 */
export async function deleteSystemUser(
  actor: Pick<User, "id" | "email" | "accessStatus">,
  targetUserId: string,
  expectedVersion: number,
  confirmationEmail: string,
  client: SystemUserDeleteClient,
): Promise<void> {
  const target = await client.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, accessStatus: true, version: true },
  });

  if (!target || target.version !== expectedVersion) {
    throw new SystemAdminStaleWriteError();
  }
  if (target.id === actor.id || isSystemAdmin(target)) {
    throw new SystemAdminProtectedUserError();
  }
  if (
    normalizeInvitationEmail(confirmationEmail) !==
    normalizeInvitationEmail(target.email)
  ) {
    throw new SystemAdminDeleteConfirmationError();
  }

  // 先送走他建立的婚宴，裡面的資料由 workspace 的 cascade 帶走。
  await client.weddingWorkspace.deleteMany({
    where: { createdById: target.id },
  });
  // 留在別人婚宴裡的上傳檔案與邀請紀錄沒有 cascade，要自己清。
  await client.budgetAttachment.deleteMany({
    where: { uploadedByUserId: target.id },
  });
  await client.workspaceInvitation.updateMany({
    where: { acceptedByUserId: target.id },
    data: { acceptedByUserId: null },
  });
  await client.workspaceInvitation.deleteMany({
    where: { invitedByUserId: target.id },
  });

  const removed = await client.user.deleteMany({
    where: { id: target.id, version: expectedVersion },
  });
  if (removed.count !== 1) {
    throw new SystemAdminStaleWriteError();
  }
}

export type SystemAdminPrismaClient = Pick<PrismaClient, "$transaction">;
