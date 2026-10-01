import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  isWorkspaceDocumentMediaType,
  MAX_WORKSPACE_DOCUMENT_COUNT,
  MAX_WORKSPACE_DOCUMENT_TOTAL_BYTES,
  filenameStem,
  normalizeWorkspaceDocumentDetails,
  validateWorkspaceDocumentFile,
  type WorkspaceDocumentMediaType,
  type WorkspaceDocumentMetadata,
} from "@/domain/workspace-document";
import {
  getWorkspacePermissions,
  isWorkspaceRole,
  type WorkspaceRole,
} from "@/domain/workspace";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";

export class WorkspaceDocumentPermissionError extends Error {
  constructor() {
    super("你目前是唯讀成員，不能上傳或刪除文件。");
    this.name = "WorkspaceDocumentPermissionError";
  }
}

export class WorkspaceDocumentTargetError extends Error {
  constructor() {
    super("找不到這份文件，可能已被刪除。");
    this.name = "WorkspaceDocumentTargetError";
  }
}

export class WorkspaceDocumentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceDocumentLimitError";
  }
}

export class WorkspaceDocumentDataError extends Error {
  constructor() {
    super("目前無法讀取文件，請稍後再試。");
    this.name = "WorkspaceDocumentDataError";
  }
}

type Client = Prisma.TransactionClient;

async function requireRole(
  transaction: Client,
  workspaceId: string,
  currentUserId: string,
  permission: "read" | "edit",
  lock: boolean,
): Promise<WorkspaceRole> {
  const rows = lock
    ? await transaction.$queryRaw<Array<{ role: string }>>(Prisma.sql`
        SELECT "role"::text AS "role"
        FROM "memberships"
        WHERE "workspace_id" = ${workspaceId}
          AND "user_id" = ${currentUserId}
        FOR SHARE
      `)
    : await transaction.membership.findMany({
        where: { workspaceId, userId: currentUserId },
        select: { role: true },
        take: 1,
      });
  const role = rows[0]?.role;
  if (rows.length !== 1 || !isWorkspaceRole(role)) {
    throw new WorkspaceDocumentTargetError();
  }
  if (permission === "edit" && !getWorkspacePermissions(role).canEdit) {
    throw new WorkspaceDocumentPermissionError();
  }
  return role;
}

const metadataSelect = {
  id: true,
  category: true,
  title: true,
  notes: true,
  originalName: true,
  mediaType: true,
  byteSize: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} satisfies Prisma.WorkspaceDocumentSelect;

type MetadataRecord = Prisma.WorkspaceDocumentGetPayload<{
  select: typeof metadataSelect;
}>;

function toMetadata(record: MetadataRecord): WorkspaceDocumentMetadata {
  if (!isWorkspaceDocumentMediaType(record.mediaType)) {
    throw new WorkspaceDocumentDataError();
  }
  return {
    id: record.id,
    category: record.category,
    title: record.title,
    notes: record.notes,
    originalName: record.originalName,
    mediaType: record.mediaType,
    byteSize: record.byteSize,
    createdAt: record.createdAt.toISOString(),
    uploadedByName: record.uploadedBy?.name ?? null,
  };
}

export type WorkspaceDocumentList = {
  role: WorkspaceRole;
  workspace: { id: string; name: string };
  documents: WorkspaceDocumentMetadata[];
  usage: { count: number; byteSize: number };
};

export async function listWorkspaceDocumentsForUser(
  workspaceId: string,
  currentUserId: string,
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<WorkspaceDocumentList> {
  return client.$transaction(async (transaction) => {
    const role = await requireRole(transaction, workspaceId, currentUserId, "read", false);
    const [workspace, records] = await Promise.all([
      transaction.weddingWorkspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { id: true, name: true },
      }),
      transaction.workspaceDocument.findMany({
        where: { workspaceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: metadataSelect,
      }),
    ]);
    const documents = records.map(toMetadata);
    return {
      role,
      workspace,
      documents,
      usage: {
        count: documents.length,
        byteSize: documents.reduce((sum, document) => sum + document.byteSize, 0),
      },
    };
  });
}

export async function assertWorkspaceDocumentUploadAccess(
  workspaceId: string,
  currentUserId: string,
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<void> {
  await client.$transaction((transaction) =>
    requireRole(transaction, workspaceId, currentUserId, "edit", false),
  );
}

export async function createWorkspaceDocument(
  input: {
    workspaceId: string;
    currentUserId: string;
    originalName: string;
    data: Uint8Array;
    category: unknown;
    title: unknown;
    notes: unknown;
  },
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<WorkspaceDocumentMetadata> {
  const file = validateWorkspaceDocumentFile(input);
  const details = normalizeWorkspaceDocumentDetails({
    category: input.category,
    title: input.title,
    notes: input.notes,
    fallbackTitle: filenameStem(file.originalName),
  });

  return runSerializableTransaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${"workspace-documents:" + input.workspaceId}, 0::bigint)
      )
    `;
    await requireRole(transaction, input.workspaceId, input.currentUserId, "edit", true);

    const usage = await transaction.workspaceDocument.aggregate({
      where: { workspaceId: input.workspaceId },
      _count: { _all: true },
      _sum: { byteSize: true },
    });
    if (usage._count._all >= MAX_WORKSPACE_DOCUMENT_COUNT) {
      throw new WorkspaceDocumentLimitError(
        `每場婚宴最多可存 ${MAX_WORKSPACE_DOCUMENT_COUNT} 份文件，請先刪除用不到的文件。`,
      );
    }
    if ((usage._sum.byteSize ?? 0) + file.byteSize > MAX_WORKSPACE_DOCUMENT_TOTAL_BYTES) {
      throw new WorkspaceDocumentLimitError(
        "這場婚宴的文件總量已達 500 MiB 上限，請先刪除用不到的文件。",
      );
    }

    const created = await transaction.workspaceDocument.create({
      data: {
        workspaceId: input.workspaceId,
        category: details.category,
        title: details.title,
        notes: details.notes,
        originalName: file.originalName,
        mediaType: file.mediaType,
        byteSize: file.byteSize,
        sha256: createHash("sha256").update(file.data).digest("hex"),
        data: Buffer.from(file.data),
        uploadedByUserId: input.currentUserId,
      },
      select: metadataSelect,
    });
    return toMetadata(created);
  }, client);
}

export async function getWorkspaceDocumentContent(
  input: { workspaceId: string; documentId: string; currentUserId: string },
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<{
  originalName: string;
  mediaType: WorkspaceDocumentMediaType;
  byteSize: number;
  sha256: string;
  data: Buffer;
}> {
  return client.$transaction(async (transaction) => {
    await requireRole(transaction, input.workspaceId, input.currentUserId, "read", false);
    const document = await transaction.workspaceDocument.findFirst({
      where: { id: input.documentId, workspaceId: input.workspaceId },
      select: {
        originalName: true,
        mediaType: true,
        byteSize: true,
        sha256: true,
        data: true,
      },
    });
    if (!document) throw new WorkspaceDocumentTargetError();

    const data = Buffer.from(document.data);
    if (
      !isWorkspaceDocumentMediaType(document.mediaType) ||
      data.byteLength !== document.byteSize ||
      createHash("sha256").update(data).digest("hex") !== document.sha256
    ) {
      throw new WorkspaceDocumentDataError();
    }
    return {
      originalName: document.originalName,
      mediaType: document.mediaType,
      byteSize: document.byteSize,
      sha256: document.sha256,
      data,
    };
  });
}

export async function deleteWorkspaceDocument(
  input: { workspaceId: string; documentId: string; currentUserId: string },
  client: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<void> {
  await runSerializableTransaction(async (transaction) => {
    await requireRole(transaction, input.workspaceId, input.currentUserId, "edit", true);
    const deleted = await transaction.workspaceDocument.deleteMany({
      where: { id: input.documentId, workspaceId: input.workspaceId },
    });
    if (deleted.count !== 1) throw new WorkspaceDocumentTargetError();
  }, client);
}
