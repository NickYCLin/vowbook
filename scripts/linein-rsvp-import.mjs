#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const MAX_TRANSACTION_ATTEMPTS = 3;
const LINEIN_SOURCE_INSTANCE = "default";
const LINEIN_MAPPING_VERSION = "linein-rsvp-v2";
const LINEIN_MANAGED_FIELDS = Object.freeze([
  "NAME",
  "SIDE",
  "ATTENDANCE_STATUS",
]);
const ALLOWED_FIELDS = new Set([
  "source",
  "externalUserId",
  "name",
  "side",
  "relationshipLabel",
  "phone",
  "email",
  "attendanceStatus",
  "attendanceReply",
  "ceremonyAttendance",
  "partySize",
  "childSeatCount",
  "vegetarianCount",
  "invitationDelivery",
  "invitationReply",
  "mailingAddress",
  "message",
  "respondedAt",
]);
const SIDE_VALUES = new Set(["PARTNER_A", "PARTNER_B", "SHARED"]);
const ATTENDANCE_VALUES = new Set(["ATTENDING", "DECLINED"]);
const INVITATION_VALUES = new Set(["PAPER", "DIGITAL", "NONE", "UNKNOWN"]);
const MANIFEST_AGGREGATE_KEYS = [
  "recordCount",
  "uniqueExternalIds",
  "partnerA",
  "partnerB",
  "shared",
  "attending",
  "declined",
  "attendingPartySize",
  "childSeatCount",
  "vegetarianCount",
  "unknownInvitation",
];
const MANIFEST_KEYS = new Set([
  "version",
  "source",
  "inputSha256",
  ...MANIFEST_AGGREGATE_KEYS,
]);
const EXPECTED_ANONYMOUS_MANIFEST = Object.freeze({
  version: 1,
  source: "LINEIN",
  recordCount: 34,
  uniqueExternalIds: 34,
  partnerA: 17,
  partnerB: 17,
  shared: 0,
  attending: 31,
  declined: 3,
  attendingPartySize: 64,
  childSeatCount: 7,
  vegetarianCount: 0,
  unknownInvitation: 3,
});
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
export const LINEIN_RSVP_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class LineinRsvpValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LineinRsvpValidationError";
  }
}

export class LineinRsvpImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "LineinRsvpImportError";
  }
}

function recordError(index, field, reason = "格式無效") {
  return new LineinRsvpValidationError(
    `第 ${index + 1} 筆的 ${field} ${reason}。`,
  );
}

function codePointCount(value) {
  return Array.from(value).length;
}

function requiredString(
  record,
  index,
  field,
  maximum,
  { collapseWhitespace = true, opaque = false } = {},
) {
  const raw = record[field];
  if (typeof raw !== "string") {
    throw recordError(index, field, "必須是字串");
  }

  const normalized = opaque
    ? raw
    : collapseWhitespace
      ? raw.trim().replace(/\s+/gu, " ")
      : raw.trim();
  if (normalized.trim().length === 0 || codePointCount(normalized) > maximum) {
    throw recordError(index, field, `長度必須介於 1 到 ${maximum} 個字元`);
  }

  return normalized;
}

function optionalString(
  record,
  index,
  field,
  maximum,
  { collapseWhitespace = false } = {},
) {
  const raw = record[field];
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== "string") {
    throw recordError(index, field, "必須是字串或省略");
  }

  const normalized = collapseWhitespace
    ? raw.trim().replace(/\s+/gu, " ")
    : raw.trim();
  if (normalized === "") {
    return null;
  }
  if (codePointCount(normalized) > maximum) {
    throw recordError(index, field, `不可超過 ${maximum} 個字元`);
  }
  return normalized;
}

function enumValue(record, index, field, allowed) {
  const value = record[field];
  if (typeof value !== "string" || !allowed.has(value)) {
    throw recordError(index, field, "不是允許的選項");
  }
  return value;
}

function integerValue(record, index, field, minimum, maximum) {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw recordError(index, field, `必須是 ${minimum} 到 ${maximum} 的整數`);
  }
  return value;
}

function timestampValue(record, index) {
  const value = requiredString(record, index, "respondedAt", 40, {
    collapseWhitespace: false,
  });
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    throw recordError(index, "respondedAt", "必須是 ISO timestamp");
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const parsed = new Date(value);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > lastDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    Number.isNaN(parsed.getTime())
  ) {
    throw recordError(index, "respondedAt", "必須是有效的 ISO timestamp");
  }
  return parsed;
}

function normalizeRecord(value, index) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw recordError(index, "record", "必須是物件");
  }

  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw recordError(index, "record", "含有不允許的欄位");
    }
  }

  const source = enumValue(value, index, "source", new Set(["LINEIN"]));
  const externalUserId = requiredString(value, index, "externalUserId", 191, {
    opaque: true,
  });
  const name = requiredString(value, index, "name", 80);
  const side = enumValue(value, index, "side", SIDE_VALUES);
  const relationshipLabel = requiredString(
    value,
    index,
    "relationshipLabel",
    100,
    { collapseWhitespace: false },
  );
  const phone = requiredString(value, index, "phone", 40);
  const email = optionalString(value, index, "email", 254, {
    collapseWhitespace: true,
  });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw recordError(index, "email", "格式無效");
  }
  const attendanceStatus = enumValue(
    value,
    index,
    "attendanceStatus",
    ATTENDANCE_VALUES,
  );
  const attendanceReply = requiredString(value, index, "attendanceReply", 120, {
    collapseWhitespace: false,
  });
  if (
    value.ceremonyAttendance !== null &&
    typeof value.ceremonyAttendance !== "boolean"
  ) {
    throw recordError(index, "ceremonyAttendance", "必須是布林值或 null");
  }
  const partySize = integerValue(value, index, "partySize", 1, 20);
  const childSeatCount = integerValue(value, index, "childSeatCount", 0, 20);
  if (childSeatCount > partySize) {
    throw recordError(index, "childSeatCount", "不可大於 partySize");
  }
  const vegetarianCount = integerValue(value, index, "vegetarianCount", 0, 20);
  if (vegetarianCount > partySize) {
    throw recordError(index, "vegetarianCount", "不可大於 partySize");
  }
  const invitationDelivery = enumValue(
    value,
    index,
    "invitationDelivery",
    INVITATION_VALUES,
  );
  const invitationReply =
    value.invitationReply === null
      ? null
      : requiredString(value, index, "invitationReply", 120, {
          collapseWhitespace: false,
        });
  const mailingAddress = optionalString(value, index, "mailingAddress", 500);
  if (invitationDelivery === "PAPER" && mailingAddress === null) {
    throw recordError(
      index,
      "mailingAddress",
      "在 invitationDelivery 為 PAPER 時不得省略",
    );
  }
  if (invitationDelivery === "UNKNOWN" && invitationReply !== null) {
    throw recordError(
      index,
      "invitationReply",
      "在 invitationDelivery 為 UNKNOWN 時必須是 null",
    );
  }
  if (invitationDelivery !== "UNKNOWN" && invitationReply === null) {
    throw recordError(index, "invitationReply", "在已回答喜帖問題時不得省略");
  }
  const message = optionalString(value, index, "message", 1000);
  const respondedAt = timestampValue(value, index);

  return {
    source,
    externalUserId,
    name,
    side,
    relationshipLabel,
    phone,
    email,
    attendanceStatus,
    attendanceReply,
    ceremonyAttendance: value.ceremonyAttendance,
    partySize,
    childSeatCount,
    vegetarianCount,
    invitationDelivery,
    invitationReply,
    mailingAddress,
    message,
    respondedAt,
  };
}

export function parseNormalizedLineinRsvpJson(json) {
  let input;
  try {
    input = JSON.parse(json);
  } catch {
    throw new LineinRsvpValidationError("頂層 JSON 格式無效。");
  }

  if (!Array.isArray(input) || input.length === 0) {
    throw new LineinRsvpValidationError("輸入必須是非空的 JSON 陣列。");
  }

  const seenExternalIds = new Set();
  return input.map((value, index) => {
    const record = normalizeRecord(value, index);
    if (seenExternalIds.has(record.externalUserId)) {
      throw recordError(index, "externalUserId", "不可在同一批次重複");
    }
    seenExternalIds.add(record.externalUserId);
    return record;
  });
}

export function computeLineinRsvpManifestAggregates(records) {
  const attending = records.filter(
    (record) => record.attendanceStatus === "ATTENDING",
  );
  return {
    recordCount: records.length,
    uniqueExternalIds: new Set(records.map((record) => record.externalUserId))
      .size,
    partnerA: records.filter((record) => record.side === "PARTNER_A").length,
    partnerB: records.filter((record) => record.side === "PARTNER_B").length,
    shared: records.filter((record) => record.side === "SHARED").length,
    attending: attending.length,
    declined: records.length - attending.length,
    attendingPartySize: attending.reduce(
      (sum, record) => sum + record.partySize,
      0,
    ),
    childSeatCount: records.reduce(
      (sum, record) => sum + record.childSeatCount,
      0,
    ),
    vegetarianCount: records.reduce(
      (sum, record) => sum + record.vegetarianCount,
      0,
    ),
    unknownInvitation: records.filter(
      (record) => record.invitationDelivery === "UNKNOWN",
    ).length,
  };
}

export function parseAndValidateLineinRsvpManifestJson(
  manifestJson,
  inputBytes,
  records,
) {
  let manifest;
  try {
    manifest = JSON.parse(manifestJson);
  } catch {
    throw new LineinRsvpImportError("匿名 manifest 格式無效。");
  }

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest) ||
    Object.keys(manifest).length !== MANIFEST_KEYS.size ||
    Object.keys(manifest).some((key) => !MANIFEST_KEYS.has(key)) ||
    manifest.version !== 1 ||
    manifest.source !== "LINEIN" ||
    typeof manifest.inputSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(manifest.inputSha256) ||
    MANIFEST_AGGREGATE_KEYS.some(
      (key) =>
        typeof manifest[key] !== "number" ||
        !Number.isSafeInteger(manifest[key]) ||
        manifest[key] < 0,
    )
  ) {
    throw new LineinRsvpImportError("匿名 manifest 格式無效。");
  }

  const actualHash = createHash("sha256").update(inputBytes).digest("hex");
  const actualAggregates = computeLineinRsvpManifestAggregates(records);
  if (
    manifest.inputSha256 !== actualHash ||
    MANIFEST_AGGREGATE_KEYS.some(
      (key) =>
        manifest[key] !== EXPECTED_ANONYMOUS_MANIFEST[key] ||
        manifest[key] !== actualAggregates[key],
    )
  ) {
    throw new LineinRsvpImportError("匿名 manifest 與匯入資料不符。");
  }

  return manifest;
}

function rsvpFields(record) {
  return {
    sourceInstance: LINEIN_SOURCE_INSTANCE,
    sourceLabel: "拍拍印",
    sourceManaged: true,
    managedFields: [...LINEIN_MANAGED_FIELDS],
    sourcePartySize: record.partySize,
    relationshipLabel: record.relationshipLabel,
    contactPhone: record.phone,
    contactEmail: record.email,
    ceremonyAttendance: record.ceremonyAttendance,
    childSeatCount: record.childSeatCount,
    vegetarianCount: record.vegetarianCount,
    invitationDelivery: record.invitationDelivery,
    mailingAddress: record.mailingAddress,
    guestMessage: record.message,
    attendanceReply: record.attendanceReply,
    invitationReply: record.invitationReply,
    sourceSubmittedAt: record.respondedAt,
  };
}

function guestFields(record) {
  return {
    name: record.name,
    side: record.side,
    attendanceStatus: record.attendanceStatus,
    partySize: record.partySize,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourcePayloadHash(record) {
  return sha256(JSON.stringify(record));
}

function derivedInputHash(records) {
  return sha256(JSON.stringify(records));
}

function equalDate(left, right) {
  return new Date(left).getTime() === new Date(right).getTime();
}

function importedRecordChanged(existing, record) {
  const rsvp = rsvpFields(record);
  return (
    existing.guest.name !== record.name ||
    existing.guest.side !== record.side ||
    existing.guest.attendanceStatus !== record.attendanceStatus ||
    existing.sourceInstance !== LINEIN_SOURCE_INSTANCE ||
    existing.sourceLabel !== rsvp.sourceLabel ||
    existing.sourceManaged !== rsvp.sourceManaged ||
    !Array.isArray(existing.managedFields) ||
    existing.managedFields.length !== LINEIN_MANAGED_FIELDS.length ||
    LINEIN_MANAGED_FIELDS.some(
      (field) => !existing.managedFields.includes(field),
    ) ||
    existing.sourcePartySize !== rsvp.sourcePartySize ||
    existing.relationshipLabel !== rsvp.relationshipLabel ||
    existing.contactPhone !== rsvp.contactPhone ||
    existing.contactEmail !== rsvp.contactEmail ||
    existing.ceremonyAttendance !== rsvp.ceremonyAttendance ||
    existing.childSeatCount !== rsvp.childSeatCount ||
    existing.vegetarianCount !== rsvp.vegetarianCount ||
    existing.invitationDelivery !== rsvp.invitationDelivery ||
    existing.mailingAddress !== rsvp.mailingAddress ||
    existing.guestMessage !== rsvp.guestMessage ||
    existing.attendanceReply !== rsvp.attendanceReply ||
    existing.invitationReply !== rsvp.invitationReply ||
    !equalDate(existing.sourceSubmittedAt, rsvp.sourceSubmittedAt)
  );
}

function aggregateSummary(records, mode) {
  const attending = records.filter(
    (record) => record.attendanceStatus === "ATTENDING",
  );
  return {
    mode,
    applied: false,
    input: records.length,
    create: 0,
    update: 0,
    unchanged: 0,
    conflict: 0,
    attendingGroups: attending.length,
    declinedGroups: records.length - attending.length,
    attendingPartySize: attending.reduce(
      (sum, record) => sum + record.partySize,
      0,
    ),
  };
}

async function planAndApplyImport(
  transaction,
  workspaceId,
  records,
  apply,
  batchMetadata,
) {
  const workspace = await transaction.weddingWorkspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    throw new LineinRsvpImportError("指定的婚宴工作區不存在。");
  }

  const existingRows = await transaction.guestImportRecord.findMany({
    where: {
      workspaceId,
      source: "LINEIN",
      sourceInstance: LINEIN_SOURCE_INSTANCE,
    },
    include: {
      guest: {
        include: {
          seatingTable: {
            select: { id: true, workspaceId: true, capacity: true },
          },
        },
      },
    },
  });
  const existingByExternalId = new Map(
    existingRows.map((row) => [row.externalId, row]),
  );
  const inputExternalIds = new Set(
    records.map((record) => record.externalUserId),
  );
  const missingExistingCount = existingRows.filter(
    (row) => !inputExternalIds.has(row.externalId),
  ).length;
  const creates = [];
  const updates = [];
  const summary = aggregateSummary(records, apply ? "apply" : "dry-run");
  const conflictIndexes = new Set();
  const unchangedIndexes = new Set();
  const importRecordIdsByIndex = new Map();

  records.forEach((record, index) => {
    const existing = existingByExternalId.get(record.externalUserId);
    if (!existing) {
      creates.push({ index, record });
      return;
    }
    importRecordIdsByIndex.set(index, existing.id);
    if (
      existing.workspaceId !== workspaceId ||
      existing.guest.workspaceId !== workspaceId ||
      existing.guestId !== existing.guest.id
    ) {
      conflictIndexes.add(index);
      updates.push({ index, record, existing });
      return;
    }
    if (!importedRecordChanged(existing, record)) {
      summary.unchanged += 1;
      unchangedIndexes.add(index);
      return;
    }

    updates.push({ index, record, existing });
    if (!existing.guest.seatingTableId) {
      return;
    }
    if (record.attendanceStatus === "DECLINED") {
      conflictIndexes.add(index);
    }
  });

  summary.create = creates.length;
  summary.update = updates.length;
  summary.conflict = missingExistingCount + conflictIndexes.size;
  if (!apply || summary.conflict > 0) {
    return summary;
  }

  const existingBatch = await transaction.guestImportBatch.findFirst({
    where: {
      workspaceId,
      source: "LINEIN",
      sourceInstance: LINEIN_SOURCE_INSTANCE,
      idempotencyKey: batchMetadata.idempotencyKey,
    },
    select: { id: true, status: true },
  });
  if (existingBatch && existingBatch.status !== "SUCCEEDED") {
    throw new LineinRsvpImportError("既有匯入批次尚未完成，請稍後再試。");
  }
  const batch = existingBatch
    ? await transaction.guestImportBatch.update({
        where: { id: existingBatch.id },
        data: {
          rerunCount: { increment: 1 },
          lastRerunAt: new Date(),
        },
        select: { id: true },
      })
    : await transaction.guestImportBatch.create({
        data: {
          workspaceId,
          source: "LINEIN",
          sourceInstance: LINEIN_SOURCE_INSTANCE,
          sourceLabel: "拍拍印",
          idempotencyKey: batchMetadata.idempotencyKey,
          mappingVersion: batchMetadata.mappingVersion,
          status: "RUNNING",
          totalRows: records.length,
        },
        select: { id: true },
      });

  for (const { index, record } of creates) {
    const guest = await transaction.guest.create({
      data: { workspaceId, ...guestFields(record) },
      select: { id: true },
    });
    const importRecord = await transaction.guestImportRecord.create({
      data: {
        guestId: guest.id,
        workspaceId,
        source: "LINEIN",
        externalId: record.externalUserId,
        ...rsvpFields(record),
      },
      select: { id: true },
    });
    importRecordIdsByIndex.set(index, importRecord.id);
  }

  for (const { record, existing } of updates) {
    await transaction.guest.update({
      where: {
        id_workspaceId: { id: existing.guestId, workspaceId },
      },
      data: {
        name: record.name,
        side: record.side,
        attendanceStatus: record.attendanceStatus,
        version: { increment: 1 },
      },
    });
    await transaction.guestImportRecord.update({
      where: { id: existing.id },
      data: rsvpFields(record),
    });
  }

  for (const [index, record] of records.entries()) {
    const rowKey = sha256(record.externalUserId);
    const importRecordId = importRecordIdsByIndex.get(index);
    if (!importRecordId) {
      throw new LineinRsvpImportError("匯入來源追蹤資料不完整。");
    }
    await transaction.guestImportBatchRow.upsert({
      where: { batchId_rowKey: { batchId: batch.id, rowKey } },
      update: {
        externalId: record.externalUserId,
        guestImportRecordId: importRecordId,
        sourcePayloadHash: sourcePayloadHash(record),
        attemptCount: { increment: 1 },
      },
      create: {
        workspaceId,
        batchId: batch.id,
        rowKey,
        externalId: record.externalUserId,
        guestImportRecordId: importRecordId,
        status: unchangedIndexes.has(index) ? "SKIPPED" : "SUCCEEDED",
        sourcePayloadHash: sourcePayloadHash(record),
      },
    });
  }

  if (!existingBatch) {
    await transaction.guestImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "SUCCEEDED",
        totalRows: records.length,
        succeededRows: creates.length + updates.length,
        failedRows: 0,
        skippedRows: summary.unchanged,
        conflictRows: 0,
        errorSummary: null,
        completedAt: new Date(),
      },
    });
  }

  summary.applied = true;
  return summary;
}

function retryableTransactionError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

export async function importLineinRsvpRecords({
  client,
  workspaceId,
  records,
  apply = false,
  inputSha256,
  mappingVersion = LINEIN_MAPPING_VERSION,
}) {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new LineinRsvpImportError("必須明確指定婚宴工作區。");
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new LineinRsvpImportError("匯入資料不得為空。");
  }
  const normalizedInputHash = inputSha256 ?? derivedInputHash(records);
  if (!/^[a-f0-9]{64}$/u.test(normalizedInputHash)) {
    throw new LineinRsvpImportError("匯入批次識別碼格式無效。");
  }
  if (
    typeof mappingVersion !== "string" ||
    mappingVersion.length === 0 ||
    mappingVersion.length > 64
  ) {
    throw new LineinRsvpImportError("匯入 mapping version 格式無效。");
  }
  const batchMetadata = {
    idempotencyKey: `${mappingVersion}:${normalizedInputHash}`,
    mappingVersion,
  };

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(
        (transaction) =>
          planAndApplyImport(
            transaction,
            workspaceId.trim(),
            records,
            apply,
            batchMetadata,
          ),
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof LineinRsvpImportError) {
        throw error;
      }
      if (
        retryableTransactionError(error) &&
        attempt < MAX_TRANSACTION_ATTEMPTS
      ) {
        continue;
      }
      if (retryableTransactionError(error)) {
        throw new LineinRsvpImportError(
          "同時有其他匯入作業，請確認後重新執行。",
        );
      }
      throw new LineinRsvpImportError("匯入交易失敗，沒有寫入任何資料。");
    }
  }

  throw new LineinRsvpImportError("匯入交易失敗，沒有寫入任何資料。");
}

export function formatLineinRsvpImportSummary(summary) {
  return [
    `mode=${summary.mode}`,
    `applied=${summary.applied}`,
    `input=${summary.input}`,
    `create=${summary.create}`,
    `update=${summary.update}`,
    `unchanged=${summary.unchanged}`,
    `conflict=${summary.conflict}`,
    `attending_groups=${summary.attendingGroups}`,
    `declined_groups=${summary.declinedGroups}`,
    `attending_party_size=${summary.attendingPartySize}`,
  ].join(" ");
}

export function parseLineinRsvpCliArguments(argv) {
  let workspaceId;
  let confirmWorkspaceId;
  let inputPath;
  let manifestPath;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (
      argument === "--workspace-id" ||
      argument === "--confirm-workspace-id" ||
      argument === "--input" ||
      argument === "--manifest"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new LineinRsvpImportError("CLI 必要參數不完整。");
      }
      if (argument === "--workspace-id") {
        if (workspaceId !== undefined) {
          throw new LineinRsvpImportError("CLI 參數不可重複。");
        }
        workspaceId = value.trim();
      } else if (argument === "--confirm-workspace-id") {
        if (confirmWorkspaceId !== undefined) {
          throw new LineinRsvpImportError("CLI 參數不可重複。");
        }
        confirmWorkspaceId = value.trim();
      } else if (argument === "--input") {
        if (inputPath !== undefined) {
          throw new LineinRsvpImportError("CLI 參數不可重複。");
        }
        inputPath = value;
      } else {
        if (manifestPath !== undefined) {
          throw new LineinRsvpImportError("CLI 參數不可重複。");
        }
        manifestPath = value;
      }
      index += 1;
      continue;
    }
    throw new LineinRsvpImportError("CLI 含有不支援的參數。");
  }

  if (!workspaceId || !confirmWorkspaceId || !inputPath || !manifestPath) {
    throw new LineinRsvpImportError(
      "必須提供兩次 workspace 確認、匯入檔與匿名 manifest；預設只執行 dry-run。",
    );
  }
  if (workspaceId !== confirmWorkspaceId) {
    throw new LineinRsvpImportError("兩次指定的婚宴工作區不一致。");
  }
  if (
    path.basename(inputPath).startsWith(".env") ||
    path.basename(manifestPath).startsWith(".env")
  ) {
    throw new LineinRsvpImportError("匯入檔不可使用環境設定檔。");
  }

  return {
    workspaceId,
    confirmWorkspaceId,
    inputPath,
    manifestPath,
    apply,
  };
}

function pathIsInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export async function readVerifiedExternalFileBytes(
  resolvedRepositoryRoot,
  resolvedFilePath,
) {
  const handle = await open(
    resolvedFilePath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new LineinRsvpImportError("匯入來源必須是一般檔案。");
    }
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
    if (pathIsInside(resolvedRepositoryRoot, openedPath)) {
      throw new LineinRsvpImportError(
        "匯入檔與匿名 manifest 必須位於 repository 外。",
      );
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes, errorMessage) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LineinRsvpImportError(errorMessage);
  }
}

export async function runLineinRsvpCli(
  argv,
  {
    databaseUrl = process.env.DATABASE_URL,
    repositoryRoot = LINEIN_RSVP_REPOSITORY_ROOT,
    resolveRealPath = (filePath) => realpath(filePath),
    readFileBytes,
    createClient = () => new PrismaClient(),
    writeOutput = (line) => console.log(line),
    writeError = (line) => console.error(line),
  } = {},
) {
  let client;
  try {
    const options = parseLineinRsvpCliArguments(argv);
    if (!databaseUrl) {
      throw new LineinRsvpImportError(
        "此 privileged offline operator command 需要 DATABASE_URL。",
      );
    }

    let resolvedRepositoryRoot;
    let resolvedInputPath;
    let resolvedManifestPath;
    try {
      [resolvedRepositoryRoot, resolvedInputPath, resolvedManifestPath] =
        await Promise.all([
          resolveRealPath(repositoryRoot),
          resolveRealPath(options.inputPath),
          resolveRealPath(options.manifestPath),
        ]);
    } catch {
      throw new LineinRsvpImportError("無法解析匯入檔或匿名 manifest。");
    }
    if (
      pathIsInside(resolvedRepositoryRoot, resolvedInputPath) ||
      pathIsInside(resolvedRepositoryRoot, resolvedManifestPath)
    ) {
      throw new LineinRsvpImportError(
        "匯入檔與匿名 manifest 必須位於 repository 外。",
      );
    }

    let inputBytes;
    let manifestBytes;
    try {
      const verifiedRead =
        readFileBytes ??
        ((filePath) =>
          readVerifiedExternalFileBytes(resolvedRepositoryRoot, filePath));
      [inputBytes, manifestBytes] = await Promise.all([
        verifiedRead(resolvedInputPath),
        verifiedRead(resolvedManifestPath),
      ]);
    } catch {
      throw new LineinRsvpImportError("無法讀取匯入檔或匿名 manifest。");
    }
    const inputJson = decodeUtf8(inputBytes, "匯入檔不是有效的 UTF-8 JSON。");
    const manifestJson = decodeUtf8(
      manifestBytes,
      "匿名 manifest 不是有效的 UTF-8 JSON。",
    );
    const records = parseNormalizedLineinRsvpJson(inputJson);
    const manifest = parseAndValidateLineinRsvpManifestJson(
      manifestJson,
      inputBytes,
      records,
    );
    client = createClient();
    const summary = await importLineinRsvpRecords({
      client,
      workspaceId: options.workspaceId,
      records,
      apply: options.apply,
      inputSha256: manifest.inputSha256,
    });
    writeOutput(formatLineinRsvpImportSummary(summary));
    return summary.conflict > 0 ? 2 : 0;
  } catch (error) {
    if (
      error instanceof LineinRsvpValidationError ||
      error instanceof LineinRsvpImportError
    ) {
      writeError(error.message);
    } else {
      writeError("匯入失敗，沒有寫入任何資料。");
    }
    return 1;
  } finally {
    if (client) {
      await client.$disconnect().catch(() => undefined);
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await runLineinRsvpCli(process.argv.slice(2));
}
