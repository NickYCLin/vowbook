import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type {
  GuestAttendanceStatus,
  GuestManagedField,
  GuestSide,
} from "@prisma/client";
import type { GuestXlsxColumnMapping } from "@/domain/guest-xlsx-import";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";
import { parseGuestXlsxWorkbook } from "@/lib/guest-xlsx-workbook";

const IMPORT_SOURCE = "LINEIN";
const IMPORT_SOURCE_INSTANCE = "default";
const IMPORT_SOURCE_LABEL = "拍拍印";
const IMPORT_MAPPING_VERSION = "linein-xlsx-column-map-v1";
const IMPORT_MANAGED_FIELDS: GuestManagedField[] = [
  "NAME",
  "SIDE",
  "ATTENDANCE_STATUS",
];
const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const PREVIEW_ROW_LIMIT = 100;

export class GuestXlsxImportPermissionError extends Error {
  constructor() {
    super("只有婚宴 OWNER 可以匯入賓客。");
    this.name = "GuestXlsxImportPermissionError";
  }
}

export class GuestXlsxImportConflictError extends Error {
  constructor(message = "匯入預覽已失效，請重新預覽後再試。") {
    super(message);
    this.name = "GuestXlsxImportConflictError";
  }
}

export class GuestXlsxImportDataError extends Error {
  constructor(message = "目前無法處理賓客匯入，請稍後再試。") {
    super(message);
    this.name = "GuestXlsxImportDataError";
  }
}

export type GuestXlsxImportSummary = {
  input: number;
  create: number;
  update: number;
  unchanged: number;
  conflict: number;
  existingSourceCount: number;
  matchedExistingCount: number;
  attendingGroups: number;
  attendingPartySize: number;
};

export type GuestXlsxImportPreviewRow = {
  rowNumber: number;
  name: string;
  action: "CREATE" | "UPDATE" | "UNCHANGED" | "CONFLICT";
  message?: string;
};

export type GuestXlsxImportPreview = {
  summary: GuestXlsxImportSummary;
  rows: GuestXlsxImportPreviewRow[];
  rowsTruncated: boolean;
  warning?: string;
  previewToken: string;
  expiresAt: string;
};

type GuestWorkbookInput = {
  workspaceId: string;
  currentUserId: string;
  data: Uint8Array;
  sheetName: string;
  headerRow: number;
  mapping: GuestXlsxColumnMapping;
  signingSecret?: string;
  now?: Date;
};

type ExistingImportRow = {
  id: string;
  guestId: string;
  workspaceId: string;
  externalId: string;
  sourceInstance: string;
  sourceLabel: string;
  sourceManaged: boolean;
  managedFields: GuestManagedField[];
  sourcePartySize: number | null;
  guest: {
    id: string;
    workspaceId: string;
    name: string;
    side: GuestSide;
    attendanceStatus: GuestAttendanceStatus;
    partySize: number;
    version: number;
    seatingTableId: string | null;
  };
};

type ImportClient = {
  guestImportRecord: {
    findMany(args: unknown): Promise<ExistingImportRow[]>;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<{ id?: string }>;
  };
  guest: {
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
  guestImportBatch: {
    findFirst(args: unknown): Promise<{ id: string; status: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<{ id: string }>;
  };
  guestImportBatchRow: {
    upsert(args: unknown): Promise<unknown>;
  };
};

type PlannedRow = GuestXlsxImportPreviewRow & {
  record: Awaited<ReturnType<typeof parseGuestXlsxWorkbook>>["rows"][number];
  existing?: ExistingImportRow;
};

type ImportPlan = {
  summary: GuestXlsxImportSummary;
  rows: PlannedRow[];
  warning?: string;
  databaseSnapshotHash: string;
};

type PreviewTokenPayload = {
  version: 1;
  workspaceId: string;
  inputSha256: string;
  mappingHash: string;
  databaseSnapshotHash: string;
  expiresAt: number;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function signingSecret(value?: string): string {
  const secret = value ?? process.env.AUTH_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new GuestXlsxImportDataError();
  }
  return secret;
}

function mappingHash(input: {
  sheetName: string;
  headerRow: number;
  mapping: GuestXlsxColumnMapping;
}): string {
  return sha256(
    JSON.stringify({
      version: 1,
      sheetName: input.sheetName,
      headerRow: input.headerRow,
      mapping: {
        externalId: input.mapping.externalId,
        name: input.mapping.name,
        side: input.mapping.side,
        attendanceStatus: input.mapping.attendanceStatus,
        partySize: input.mapping.partySize,
      },
    }),
  );
}

function encodePreviewToken(
  payload: PreviewTokenPayload,
  secret: string,
): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function decodePreviewToken(
  token: string,
  secret: string,
  now: Date,
): PreviewTokenPayload {
  if (typeof token !== "string" || token.length > 2_000) {
    throw new GuestXlsxImportConflictError();
  }
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined) {
    throw new GuestXlsxImportConflictError();
  }
  const expected = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw new GuestXlsxImportConflictError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new GuestXlsxImportConflictError();
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    (payload as Record<string, unknown>).version !== 1 ||
    typeof (payload as Record<string, unknown>).workspaceId !== "string" ||
    typeof (payload as Record<string, unknown>).inputSha256 !== "string" ||
    typeof (payload as Record<string, unknown>).mappingHash !== "string" ||
    typeof (payload as Record<string, unknown>).databaseSnapshotHash !==
      "string" ||
    typeof (payload as Record<string, unknown>).expiresAt !== "number" ||
    !Number.isSafeInteger((payload as Record<string, unknown>).expiresAt)
  ) {
    throw new GuestXlsxImportConflictError();
  }
  const parsed = payload as PreviewTokenPayload;
  if (
    !/^[a-f0-9]{64}$/u.test(parsed.inputSha256) ||
    !/^[a-f0-9]{64}$/u.test(parsed.mappingHash) ||
    !/^[a-f0-9]{64}$/u.test(parsed.databaseSnapshotHash) ||
    parsed.expiresAt < now.getTime()
  ) {
    throw new GuestXlsxImportConflictError();
  }
  return parsed;
}

async function authorizeOwner(
  workspaceId: string,
  currentUserId: string,
): Promise<void> {
  try {
    await requireWorkspaceAccess(
      workspaceId,
      currentUserId,
      "manageMembers",
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw new GuestXlsxImportPermissionError();
    }
    throw new GuestXlsxImportDataError();
  }
}

export async function assertGuestXlsxImportAccess(input: {
  workspaceId: string;
  currentUserId: string;
}): Promise<void> {
  await authorizeOwner(input.workspaceId, input.currentUserId);
}

async function loadExistingRows(
  client: Pick<ImportClient, "guestImportRecord">,
  workspaceId: string,
): Promise<ExistingImportRow[]> {
  return client.guestImportRecord.findMany({
    where: {
      workspaceId,
      source: IMPORT_SOURCE,
      sourceInstance: IMPORT_SOURCE_INSTANCE,
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      guestId: true,
      workspaceId: true,
      externalId: true,
      sourceInstance: true,
      sourceLabel: true,
      sourceManaged: true,
      managedFields: true,
      sourcePartySize: true,
      guest: {
        select: {
          id: true,
          workspaceId: true,
          name: true,
          side: true,
          attendanceStatus: true,
          partySize: true,
          version: true,
          seatingTableId: true,
        },
      },
    },
  });
}

function snapshotHash(existingRows: ExistingImportRow[]): string {
  return sha256(
    JSON.stringify(
      existingRows
        .map((row) => ({
          id: row.id,
          guestId: row.guestId,
          workspaceId: row.workspaceId,
          externalId: row.externalId,
          sourceInstance: row.sourceInstance,
          sourceLabel: row.sourceLabel,
          sourceManaged: row.sourceManaged,
          managedFields: [...row.managedFields].sort(),
          sourcePartySize: row.sourcePartySize,
          guest: {
            id: row.guest.id,
            workspaceId: row.guest.workspaceId,
            name: row.guest.name,
            side: row.guest.side,
            attendanceStatus: row.guest.attendanceStatus,
            partySize: row.guest.partySize,
            version: row.guest.version,
            seatingTableId: row.guest.seatingTableId,
          },
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ),
  );
}

function importedRowChanged(
  existing: ExistingImportRow,
  record: PlannedRow["record"],
): boolean {
  return (
    existing.guest.name !== record.name ||
    existing.guest.side !== record.side ||
    existing.guest.attendanceStatus !== record.attendanceStatus ||
    existing.sourceInstance !== IMPORT_SOURCE_INSTANCE ||
    existing.sourceLabel !== IMPORT_SOURCE_LABEL ||
    !existing.sourceManaged ||
    existing.sourcePartySize !== record.partySize ||
    existing.managedFields.length !== IMPORT_MANAGED_FIELDS.length ||
    IMPORT_MANAGED_FIELDS.some(
      (field) => !existing.managedFields.includes(field),
    )
  );
}

function buildPlan(
  workspaceId: string,
  records: PlannedRow["record"][],
  existingRows: ExistingImportRow[],
): ImportPlan {
  const existingByExternalId = new Map(
    existingRows.map((row) => [row.externalId, row]),
  );
  let matchedExistingCount = 0;
  const rows: PlannedRow[] = records.map((record) => {
    const existing = existingByExternalId.get(record.externalId);
    if (!existing) {
      return { ...record, record, action: "CREATE" as const };
    }
    matchedExistingCount += 1;
    if (
      existing.workspaceId !== workspaceId ||
      existing.guest.workspaceId !== workspaceId ||
      existing.guestId !== existing.guest.id
    ) {
      return {
        ...record,
        record,
        existing,
        action: "CONFLICT" as const,
        message: "來源資料歸屬異常，已停止匯入。",
      };
    }
    if (
      existing.guest.seatingTableId &&
      record.attendanceStatus === "DECLINED"
    ) {
      return {
        ...record,
        record,
        existing,
        action: "CONFLICT" as const,
        message: "已安排座位，不能直接改為不出席。",
      };
    }
    return {
      ...record,
      record,
      existing,
      action: importedRowChanged(existing, record)
        ? ("UPDATE" as const)
        : ("UNCHANGED" as const),
    };
  });

  const identityMismatch =
    existingRows.length > 0 && records.length > 0 && matchedExistingCount === 0;
  const attending = records.filter(
    (record) => record.attendanceStatus === "ATTENDING",
  );
  const rowConflictCount = rows.filter(
    (row) => row.action === "CONFLICT",
  ).length;
  return {
    rows,
    warning: identityMismatch
      ? "沒有任何來源識別碼對應到現有拍拍印資料，請確認選到正確的來源 ID 欄位。"
      : undefined,
    databaseSnapshotHash: snapshotHash(existingRows),
    summary: {
      input: records.length,
      create: rows.filter((row) => row.action === "CREATE").length,
      update: rows.filter((row) => row.action === "UPDATE").length,
      unchanged: rows.filter((row) => row.action === "UNCHANGED").length,
      conflict: rowConflictCount + (identityMismatch ? 1 : 0),
      existingSourceCount: existingRows.length,
      matchedExistingCount,
      attendingGroups: attending.length,
      attendingPartySize: attending.reduce(
        (total, record) => total + record.partySize,
        0,
      ),
    },
  };
}

function publicPreviewRows(rows: PlannedRow[]): GuestXlsxImportPreviewRow[] {
  return rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => ({
    rowNumber: row.rowNumber,
    name: row.name,
    action: row.action,
    ...(row.message ? { message: row.message } : {}),
  }));
}

export async function previewGuestXlsxImport(
  input: GuestWorkbookInput,
): Promise<GuestXlsxImportPreview> {
  await authorizeOwner(input.workspaceId, input.currentUserId);
  const workbook = await parseGuestXlsxWorkbook(input.data, {
    sheetName: input.sheetName,
    headerRow: input.headerRow,
    mapping: input.mapping,
  });
  let existingRows: ExistingImportRow[];
  try {
    existingRows = await loadExistingRows(
      prisma as unknown as Pick<ImportClient, "guestImportRecord">,
      input.workspaceId,
    );
  } catch {
    throw new GuestXlsxImportDataError();
  }
  const plan = buildPlan(input.workspaceId, workbook.rows, existingRows);
  const effectiveNow = input.now ?? new Date();
  const expiresAt = effectiveNow.getTime() + PREVIEW_TTL_MS;
  const payload: PreviewTokenPayload = {
    version: 1,
    workspaceId: input.workspaceId,
    inputSha256: workbook.inputSha256,
    mappingHash: mappingHash(input),
    databaseSnapshotHash: plan.databaseSnapshotHash,
    expiresAt,
  };
  return {
    summary: plan.summary,
    rows: publicPreviewRows(plan.rows),
    rowsTruncated: plan.rows.length > PREVIEW_ROW_LIMIT,
    ...(plan.warning ? { warning: plan.warning } : {}),
    previewToken: encodePreviewToken(payload, signingSecret(input.signingSecret)),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function sourceRecordData(record: PlannedRow["record"]) {
  return {
    sourceInstance: IMPORT_SOURCE_INSTANCE,
    sourceLabel: IMPORT_SOURCE_LABEL,
    sourceManaged: true,
    managedFields: IMPORT_MANAGED_FIELDS,
    sourcePartySize: record.partySize,
  };
}

function sourcePayloadHash(record: PlannedRow["record"]): string {
  return sha256(
    JSON.stringify({
      externalId: record.externalId,
      name: record.name,
      side: record.side,
      attendanceStatus: record.attendanceStatus,
      partySize: record.partySize,
    }),
  );
}

async function writePlan(
  client: ImportClient,
  workspaceId: string,
  plan: ImportPlan,
  inputSha256: string,
  importMappingHash: string,
): Promise<void> {
  const idempotencyKey = sha256(
    `${IMPORT_MAPPING_VERSION}\0${inputSha256}\0${importMappingHash}`,
  );
  const existingBatch = await client.guestImportBatch.findFirst({
    where: {
      workspaceId,
      source: IMPORT_SOURCE,
      sourceInstance: IMPORT_SOURCE_INSTANCE,
      idempotencyKey,
    },
    select: { id: true, status: true },
  });
  if (existingBatch && existingBatch.status !== "SUCCEEDED") {
    throw new GuestXlsxImportConflictError(
      "相同檔案已有未完成的匯入批次，請稍後再試。",
    );
  }
  const batch = existingBatch
    ? await client.guestImportBatch.update({
        where: { id: existingBatch.id },
        data: { rerunCount: { increment: 1 }, lastRerunAt: new Date() },
        select: { id: true },
      })
    : await client.guestImportBatch.create({
        data: {
          workspaceId,
          source: IMPORT_SOURCE,
          sourceInstance: IMPORT_SOURCE_INSTANCE,
          sourceLabel: IMPORT_SOURCE_LABEL,
          idempotencyKey,
          mappingVersion: IMPORT_MAPPING_VERSION,
          status: "RUNNING",
          totalRows: plan.summary.input,
        },
        select: { id: true },
      });

  const importRecordIds = new Map<string, string>();
  for (const row of plan.rows) {
    if (row.action === "CREATE") {
      const guest = await client.guest.create({
        data: {
          workspaceId,
          name: row.record.name,
          side: row.record.side,
          attendanceStatus: row.record.attendanceStatus,
          partySize: row.record.partySize,
        },
        select: { id: true },
      });
      const importRecord = await client.guestImportRecord.create({
        data: {
          guestId: guest.id,
          workspaceId,
          source: IMPORT_SOURCE,
          externalId: row.record.externalId,
          ...sourceRecordData(row.record),
        },
        select: { id: true },
      });
      importRecordIds.set(row.record.externalId, importRecord.id);
      continue;
    }
    if (!row.existing) throw new GuestXlsxImportConflictError();
    importRecordIds.set(row.record.externalId, row.existing.id);
    if (row.action === "UPDATE") {
      await client.guest.update({
        where: {
          id_workspaceId: {
            id: row.existing.guestId,
            workspaceId,
          },
        },
        data: {
          name: row.record.name,
          side: row.record.side,
          attendanceStatus: row.record.attendanceStatus,
          version: { increment: 1 },
        },
      });
      await client.guestImportRecord.update({
        where: { id: row.existing.id },
        data: sourceRecordData(row.record),
      });
    }
  }

  for (const row of plan.rows) {
    const importRecordId = importRecordIds.get(row.record.externalId);
    if (!importRecordId) throw new GuestXlsxImportConflictError();
    await client.guestImportBatchRow.upsert({
      where: {
        batchId_rowKey: {
          batchId: batch.id,
          rowKey: sha256(row.record.externalId),
        },
      },
      update: {
        externalId: row.record.externalId,
        guestImportRecordId: importRecordId,
        sourcePayloadHash: sourcePayloadHash(row.record),
        attemptCount: { increment: 1 },
      },
      create: {
        workspaceId,
        batchId: batch.id,
        rowKey: sha256(row.record.externalId),
        externalId: row.record.externalId,
        guestImportRecordId: importRecordId,
        status: row.action === "UNCHANGED" ? "SKIPPED" : "SUCCEEDED",
        sourcePayloadHash: sourcePayloadHash(row.record),
      },
    });
  }

  if (!existingBatch) {
    await client.guestImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "SUCCEEDED",
        totalRows: plan.summary.input,
        succeededRows: plan.summary.create + plan.summary.update,
        failedRows: 0,
        skippedRows: plan.summary.unchanged,
        conflictRows: 0,
        errorSummary: null,
        completedAt: new Date(),
      },
      select: { id: true },
    });
  }
}

export async function applyGuestXlsxImport(
  input: GuestWorkbookInput & { previewToken: string },
): Promise<GuestXlsxImportSummary & { applied: true }> {
  await authorizeOwner(input.workspaceId, input.currentUserId);
  const workbook = await parseGuestXlsxWorkbook(input.data, {
    sheetName: input.sheetName,
    headerRow: input.headerRow,
    mapping: input.mapping,
  });
  const effectiveNow = input.now ?? new Date();
  const importMappingHash = mappingHash(input);
  const token = decodePreviewToken(
    input.previewToken,
    signingSecret(input.signingSecret),
    effectiveNow,
  );
  if (
    token.workspaceId !== input.workspaceId ||
    token.inputSha256 !== workbook.inputSha256 ||
    token.mappingHash !== importMappingHash
  ) {
    throw new GuestXlsxImportConflictError();
  }

  try {
    const summary = await runSerializableTransaction(async (transaction) => {
      try {
        await requireLockedWorkspaceAccess(
          input.workspaceId,
          input.currentUserId,
          "manageMembers",
          transaction,
        );
      } catch (error) {
        if (error instanceof WorkspaceAccessDeniedError) {
          throw new GuestXlsxImportPermissionError();
        }
        throw error;
      }
      const client = transaction as unknown as ImportClient;
      const existingRows = await loadExistingRows(client, input.workspaceId);
      const plan = buildPlan(input.workspaceId, workbook.rows, existingRows);
      if (
        plan.databaseSnapshotHash !== token.databaseSnapshotHash ||
        plan.summary.conflict > 0
      ) {
        throw new GuestXlsxImportConflictError();
      }
      await writePlan(
        client,
        input.workspaceId,
        plan,
        workbook.inputSha256,
        importMappingHash,
      );
      return plan.summary;
    });
    return { ...summary, applied: true };
  } catch (error) {
    if (
      error instanceof GuestXlsxImportPermissionError ||
      error instanceof GuestXlsxImportConflictError
    ) {
      throw error;
    }
    throw new GuestXlsxImportDataError();
  }
}
