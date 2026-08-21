import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  type BudgetAttachmentMetadata,
  type BudgetAttachmentMediaType,
  validateBudgetAttachmentFile,
} from "@/domain/budget-attachment";
import {
  getWorkspacePermissions,
  isWorkspaceRole,
  type WorkspaceRole,
} from "@/domain/workspace";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";

export const MAX_BUDGET_ATTACHMENTS_PER_ITEM = 20;
export const MAX_WORKSPACE_BUDGET_ATTACHMENT_BYTES = 200 * 1024 * 1024;

export type BudgetAttachmentLimits = {
  maxFilesPerItem: number;
  maxWorkspaceBytes: number;
};

const DEFAULT_LIMITS: BudgetAttachmentLimits = {
  maxFilesPerItem: MAX_BUDGET_ATTACHMENTS_PER_ITEM,
  maxWorkspaceBytes: MAX_WORKSPACE_BUDGET_ATTACHMENT_BYTES,
};

export class BudgetAttachmentPermissionError extends Error {
  constructor() {
    super("沒有權限變更附件。");
    this.name = "BudgetAttachmentPermissionError";
  }
}

export class BudgetAttachmentTargetError extends Error {
  constructor() {
    super("找不到可使用的附件。");
    this.name = "BudgetAttachmentTargetError";
  }
}

export class BudgetAttachmentLimitError extends Error {
  constructor(message = "附件已達數量或容量上限。") {
    super(message);
    this.name = "BudgetAttachmentLimitError";
  }
}

export class BudgetAttachmentDataError extends Error {
  constructor() {
    super("目前無法處理附件，請稍後再試。");
    this.name = "BudgetAttachmentDataError";
  }
}

type AttachmentTransactionClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  membership: {
    findUnique(args: unknown): Promise<{
      role: string;
      workspace: { id: string };
    } | null>;
  };
  budgetItem: {
    findUnique(args: unknown): Promise<{
      id: string;
      kind: "GROUP" | "EXPENSE";
    } | null>;
  };
  budgetAttachment: {
    aggregate(args: unknown): Promise<{
      _sum: { byteSize: number | null };
    }>;
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<{
      id: string;
      originalName: string;
      mediaType: string;
      byteSize: number;
      createdAt: Date;
    }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
    findFirst<T>(args: unknown): Promise<T | null>;
  };
};

type AttachmentRootClient = {
  $transaction<T>(
    operation: (transaction: AttachmentTransactionClient) => Promise<T>,
  ): Promise<T>;
};

function assertLimits(limits: BudgetAttachmentLimits): void {
  if (
    !Number.isSafeInteger(limits.maxFilesPerItem) ||
    limits.maxFilesPerItem < 1 ||
    !Number.isSafeInteger(limits.maxWorkspaceBytes) ||
    limits.maxWorkspaceBytes < 1
  ) {
    throw new BudgetAttachmentDataError();
  }
}

async function requireMembership(
  transaction: AttachmentTransactionClient,
  workspaceId: string,
  currentUserId: string,
  permission: "read" | "edit",
): Promise<WorkspaceRole> {
  const membership = await transaction.membership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: currentUserId,
      },
    },
    include: { workspace: true },
  });

  return requireMembershipRole(membership?.role, permission);
}

function requireMembershipRole(
  role: unknown,
  permission: "read" | "edit",
): WorkspaceRole {
  if (!isWorkspaceRole(role)) {
    throw new BudgetAttachmentTargetError();
  }
  if (permission === "edit" && !getWorkspacePermissions(role).canEdit) {
    throw new BudgetAttachmentPermissionError();
  }
  return role;
}

async function requireLockedMembership(
  transaction: AttachmentTransactionClient,
  workspaceId: string,
  currentUserId: string,
  permission: "read" | "edit",
): Promise<WorkspaceRole> {
  const rows = await transaction.$queryRaw<Array<{ role: string }>>(Prisma.sql`
    SELECT "role"::text AS "role"
    FROM "memberships"
    WHERE "workspace_id" = ${workspaceId}
      AND "user_id" = ${currentUserId}
    FOR SHARE
  `);

  if (rows.length !== 1) {
    throw new BudgetAttachmentTargetError();
  }
  return requireMembershipRole(rows[0]?.role, permission);
}

async function requireExpense(
  transaction: AttachmentTransactionClient,
  workspaceId: string,
  budgetItemId: string,
): Promise<void> {
  const item = await transaction.budgetItem.findUnique({
    where: {
      id_workspaceId: {
        id: budgetItemId,
        workspaceId,
      },
    },
    select: { id: true, kind: true },
  });
  if (!item || item.kind !== "EXPENSE") {
    throw new BudgetAttachmentTargetError();
  }
}

function metadata(record: {
  id: string;
  originalName: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
}): BudgetAttachmentMetadata {
  return {
    id: record.id,
    originalName: record.originalName,
    mediaType: record.mediaType as BudgetAttachmentMediaType,
    byteSize: record.byteSize,
    createdAt: record.createdAt.toISOString(),
  };
}

export async function assertBudgetAttachmentUploadAccess(input: {
  workspaceId: string;
  budgetItemId: string;
  currentUserId: string;
}): Promise<void> {
  await (prisma as unknown as AttachmentRootClient).$transaction(
    async (transaction) => {
      await requireMembership(
        transaction,
        input.workspaceId,
        input.currentUserId,
        "edit",
      );
      await requireExpense(
        transaction,
        input.workspaceId,
        input.budgetItemId,
      );
    },
  );
}

export async function createBudgetAttachment(
  input: {
    workspaceId: string;
    budgetItemId: string;
    currentUserId: string;
    originalName: string;
    mediaType: string;
    data: Uint8Array;
  },
  limits: BudgetAttachmentLimits = DEFAULT_LIMITS,
): Promise<BudgetAttachmentMetadata> {
  assertLimits(limits);
  const validated = validateBudgetAttachmentFile(input);

  return runSerializableTransaction(async (prismaTransaction) => {
    const transaction =
      prismaTransaction as unknown as AttachmentTransactionClient;
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${input.workspaceId}, 0::bigint)
      )
    `;
    await requireLockedMembership(
      transaction,
      input.workspaceId,
      input.currentUserId,
      "edit",
    );
    await requireExpense(
      transaction,
      input.workspaceId,
      input.budgetItemId,
    );

    const itemAttachmentCount = await transaction.budgetAttachment.count({
      where: {
        workspaceId: input.workspaceId,
        budgetItemId: input.budgetItemId,
      },
    });
    if (itemAttachmentCount >= limits.maxFilesPerItem) {
      throw new BudgetAttachmentLimitError(
        `每筆花費最多可有 ${limits.maxFilesPerItem} 個附件。`,
      );
    }

    const workspaceAggregate =
      await transaction.budgetAttachment.aggregate({
        where: { workspaceId: input.workspaceId },
        _sum: { byteSize: true },
      });
    const currentWorkspaceBytes =
      workspaceAggregate._sum.byteSize ?? 0;
    if (
      !Number.isSafeInteger(currentWorkspaceBytes) ||
      currentWorkspaceBytes < 0
    ) {
      throw new BudgetAttachmentDataError();
    }
    if (
      currentWorkspaceBytes + validated.byteSize >
      limits.maxWorkspaceBytes
    ) {
      throw new BudgetAttachmentLimitError(
        "此婚宴工作區的附件總量已達 200 MiB 上限。",
      );
    }

    const created = await transaction.budgetAttachment.create({
      data: {
        workspaceId: input.workspaceId,
        budgetItemId: input.budgetItemId,
        originalName: validated.originalName,
        mediaType: validated.mediaType,
        byteSize: validated.byteSize,
        sha256: validated.sha256,
        data: Buffer.from(validated.data),
        uploadedByUserId: input.currentUserId,
      },
      select: {
        id: true,
        originalName: true,
        mediaType: true,
        byteSize: true,
        createdAt: true,
      },
    });
    return metadata(created);
  });
}

export async function assertBudgetAttachmentReadAccess(input: {
  workspaceId: string;
  budgetItemId: string;
  attachmentId: string;
  currentUserId: string;
}): Promise<void> {
  await (prisma as unknown as AttachmentRootClient).$transaction(
    async (transaction) => {
      await requireMembership(
        transaction,
        input.workspaceId,
        input.currentUserId,
        "read",
      );
      const attachment = await transaction.budgetAttachment.findFirst<{
        id: string;
      }>({
        where: {
          id: input.attachmentId,
          workspaceId: input.workspaceId,
          budgetItemId: input.budgetItemId,
          budgetItem: { kind: "EXPENSE" },
        },
        select: { id: true },
      });
      if (!attachment) throw new BudgetAttachmentTargetError();
    },
  );
}

export type BudgetAttachmentPreviewMetadata = BudgetAttachmentMetadata & {
  workspaceName: string;
};

export async function getBudgetAttachmentMetadata(input: {
  workspaceId: string;
  budgetItemId: string;
  attachmentId: string;
  currentUserId: string;
}): Promise<BudgetAttachmentPreviewMetadata> {
  return (prisma as unknown as AttachmentRootClient).$transaction(
    async (transaction) => {
      await requireMembership(
        transaction,
        input.workspaceId,
        input.currentUserId,
        "read",
      );
      const attachment = await transaction.budgetAttachment.findFirst<{
        id: string;
        originalName: string;
        mediaType: string;
        byteSize: number;
        createdAt: Date;
        workspace: { name: string };
      }>({
        where: {
          id: input.attachmentId,
          workspaceId: input.workspaceId,
          budgetItemId: input.budgetItemId,
          budgetItem: { kind: "EXPENSE" },
        },
        select: {
          id: true,
          originalName: true,
          mediaType: true,
          byteSize: true,
          createdAt: true,
          workspace: { select: { name: true } },
        },
      });
      if (!attachment) throw new BudgetAttachmentTargetError();

      return {
        ...metadata(attachment),
        workspaceName: attachment.workspace.name,
      };
    },
  );
}

export async function getBudgetAttachmentDownload(input: {
  workspaceId: string;
  budgetItemId: string;
  attachmentId: string;
  currentUserId: string;
}): Promise<{
  originalName: string;
  mediaType: BudgetAttachmentMediaType;
  byteSize: number;
  data: Buffer;
}> {
  return (prisma as unknown as AttachmentRootClient).$transaction(
    async (transaction) => {
      await requireMembership(
        transaction,
        input.workspaceId,
        input.currentUserId,
        "read",
      );
      const attachment = await transaction.budgetAttachment.findFirst<{
        originalName: string;
        mediaType: string;
        byteSize: number;
        sha256: string;
        data: Uint8Array;
      }>({
        where: {
          id: input.attachmentId,
          workspaceId: input.workspaceId,
          budgetItemId: input.budgetItemId,
          budgetItem: { kind: "EXPENSE" },
        },
        select: {
          originalName: true,
          mediaType: true,
          byteSize: true,
          sha256: true,
          data: true,
        },
      });
      if (!attachment) throw new BudgetAttachmentTargetError();

      const data = Buffer.from(attachment.data);
      const sha256 = createHash("sha256").update(data).digest("hex");
      if (
        data.byteLength !== attachment.byteSize ||
        sha256 !== attachment.sha256
      ) {
        throw new BudgetAttachmentDataError();
      }

      return {
        originalName: attachment.originalName,
        mediaType: attachment.mediaType as BudgetAttachmentMediaType,
        byteSize: attachment.byteSize,
        data,
      };
    },
  );
}

export async function deleteBudgetAttachment(input: {
  workspaceId: string;
  budgetItemId: string;
  attachmentId: string;
  currentUserId: string;
}): Promise<void> {
  await (prisma as unknown as AttachmentRootClient).$transaction(
    async (transaction) => {
      await requireLockedMembership(
        transaction,
        input.workspaceId,
        input.currentUserId,
        "edit",
      );
      await requireExpense(
        transaction,
        input.workspaceId,
        input.budgetItemId,
      );
      const deleted = await transaction.budgetAttachment.deleteMany({
        where: {
          id: input.attachmentId,
          workspaceId: input.workspaceId,
          budgetItemId: input.budgetItemId,
        },
      });
      if (deleted.count !== 1) throw new BudgetAttachmentTargetError();
    },
  );
}
