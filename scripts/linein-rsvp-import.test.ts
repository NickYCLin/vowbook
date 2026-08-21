import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  computeLineinRsvpManifestAggregates,
  LINEIN_RSVP_REPOSITORY_ROOT,
  LineinRsvpImportError,
  LineinRsvpValidationError,
  formatLineinRsvpImportSummary,
  importLineinRsvpRecords,
  parseAndValidateLineinRsvpManifestJson,
  parseLineinRsvpCliArguments,
  parseNormalizedLineinRsvpJson,
  readVerifiedExternalFileBytes,
  runLineinRsvpCli,
} from "./linein-rsvp-import.mjs";

type RecordOverrides = Partial<{
  source: string;
  externalUserId: string;
  name: string;
  side: string;
  relationshipLabel: string;
  phone: string;
  email: string | undefined;
  attendanceStatus: string;
  attendanceReply: string;
  ceremonyAttendance: boolean | null;
  partySize: number;
  childSeatCount: number;
  vegetarianCount: number;
  invitationDelivery: string;
  invitationReply: string | null;
  mailingAddress: string | undefined;
  message: string | undefined;
  respondedAt: string;
}>;

function sourceRecord(index = 0, overrides: RecordOverrides = {}) {
  return {
    source: "LINEIN",
    externalUserId: `synthetic-external-${index}`,
    name: `測試賓客 ${index}`,
    side: index < 17 ? "PARTNER_A" : "PARTNER_B",
    relationshipLabel: "大學 同學",
    phone: `0900-000-${String(index).padStart(3, "0")}`,
    email: `guest-${index}@example.test`,
    attendanceStatus: "ATTENDING",
    attendanceReply: "會出席",
    ceremonyAttendance: true,
    partySize: index < 2 ? 3 : 2,
    childSeatCount: index < 7 ? 1 : 0,
    vegetarianCount: 0,
    invitationDelivery: "DIGITAL",
    invitationReply: "電子喜帖",
    mailingAddress: undefined,
    message: "  謝謝邀請， 期待見面。  ",
    respondedAt: `2026-07-${String((index % 20) + 1).padStart(2, "0")}T08:30:00.000Z`,
    ...overrides,
  };
}

function anonymousContractRecords() {
  return Array.from({ length: 34 }, (_, index) => {
    if (index < 3) {
      return sourceRecord(index, {
        invitationDelivery: "UNKNOWN",
        invitationReply: null,
      });
    }
    if (index >= 31) {
      return sourceRecord(index, {
        attendanceStatus: "DECLINED",
        attendanceReply:
          index === 31 ? "不克出席，但仍希望收到喜餅" : "不克出席",
        ceremonyAttendance: false,
        partySize: 1,
        childSeatCount: 0,
        invitationDelivery: index === 31 ? "PAPER" : "NONE",
        invitationReply:
          index === 31 ? "仍希望收到紙本喜帖與喜餅" : "不需要喜帖",
        mailingAddress: index === 31 ? "  測試市測試路 1 號  " : undefined,
      });
    }

    return sourceRecord(index);
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function anonymousManifest(inputJson: string) {
  return {
    version: 1,
    source: "LINEIN",
    inputSha256: sha256(inputJson),
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
  };
}

type StoredGuest = {
  id: string;
  workspaceId: string;
  name: string;
  side: "PARTNER_A" | "PARTNER_B" | "SHARED";
  attendanceStatus: "ATTENDING" | "DECLINED";
  partySize: number;
  notes: string | null;
  seatingTableId: string | null;
};

type StoredRsvp = {
  id: string;
  guestId: string;
  workspaceId: string;
  source: string;
  sourceInstance: string;
  sourceLabel: string;
  sourceManaged: boolean;
  managedFields: string[];
  sourcePartySize: number | null;
  externalId: string;
  relationshipLabel: string;
  contactPhone: string;
  contactEmail: string | null;
  ceremonyAttendance: boolean | null;
  childSeatCount: number;
  vegetarianCount: number;
  invitationDelivery: "PAPER" | "DIGITAL" | "NONE" | "UNKNOWN";
  mailingAddress: string | null;
  guestMessage: string | null;
  attendanceReply: string;
  invitationReply: string | null;
  sourceSubmittedAt: Date;
};

type StoredTable = {
  id: string;
  workspaceId: string;
  capacity: number;
};

type StoredImportBatch = {
  id: string;
  workspaceId: string;
  source: string;
  sourceInstance: string;
  sourceLabel: string;
  idempotencyKey: string;
  mappingVersion: string;
  status: string;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
  conflictRows: number;
  rerunCount: number;
  lastRerunAt: Date | null;
  completedAt: Date | null;
};

type StoredImportBatchRow = {
  id: string;
  workspaceId: string;
  batchId: string;
  rowKey: string;
  externalId: string | null;
  guestImportRecordId: string | null;
  status: string;
  sourcePayloadHash: string | null;
  attemptCount: number;
};

type Store = {
  workspaces: string[];
  guests: StoredGuest[];
  rsvps: StoredRsvp[];
  tables: StoredTable[];
  batches: StoredImportBatch[];
  batchRows: StoredImportBatchRow[];
};

function cloneStore(store: Store): Store {
  return {
    workspaces: [...store.workspaces],
    guests: store.guests.map((guest) => ({ ...guest })),
    rsvps: store.rsvps.map((rsvp) => ({
      ...rsvp,
      sourceSubmittedAt: new Date(rsvp.sourceSubmittedAt),
    })),
    tables: store.tables.map((table) => ({ ...table })),
    batches: store.batches.map((batch) => ({
      ...batch,
      lastRerunAt: batch.lastRerunAt && new Date(batch.lastRerunAt),
      completedAt: batch.completedAt && new Date(batch.completedAt),
    })),
    batchRows: store.batchRows.map((row) => ({ ...row })),
  };
}

function fakeClient(initial: Partial<Store> = {}) {
  const store: Store = {
    workspaces: initial.workspaces ?? ["workspace_1"],
    guests: initial.guests ?? [],
    rsvps: initial.rsvps ?? [],
    tables: initial.tables ?? [],
    batches: initial.batches ?? [],
    batchRows: initial.batchRows ?? [],
  };
  const transactions: Array<{ isolationLevel?: string }> = [];

  return {
    store,
    transactions,
    client: {
      async $transaction(
        operation: (transaction: unknown) => Promise<unknown>,
        options: { isolationLevel?: string },
      ) {
        transactions.push(options);
        const working = cloneStore(store);
        let nextGuestId = working.guests.length + 1;
        const transaction = {
          weddingWorkspace: {
            findUnique: async ({ where }: { where: { id: string } }) =>
              working.workspaces.includes(where.id) ? { id: where.id } : null,
          },
          guestImportBatch: {
            findFirst: async ({
              where,
            }: {
              where: {
                workspaceId: string;
                source: string;
                sourceInstance: string;
                idempotencyKey: string;
              };
            }) =>
              working.batches.find(
                (batch) =>
                  batch.workspaceId === where.workspaceId &&
                  batch.source === where.source &&
                  batch.sourceInstance === where.sourceInstance &&
                  batch.idempotencyKey === where.idempotencyKey,
              ) ?? null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
              const batch: StoredImportBatch = {
                id: `batch_${working.batches.length + 1}`,
                workspaceId: String(data.workspaceId),
                source: String(data.source),
                sourceInstance: String(data.sourceInstance),
                sourceLabel: String(data.sourceLabel),
                idempotencyKey: String(data.idempotencyKey),
                mappingVersion: String(data.mappingVersion),
                status: String(data.status ?? "RUNNING"),
                totalRows: Number(data.totalRows ?? 0),
                succeededRows: 0,
                failedRows: 0,
                skippedRows: 0,
                conflictRows: 0,
                rerunCount: 0,
                lastRerunAt: null,
                completedAt: null,
              };
              working.batches.push(batch);
              return batch;
            },
            update: async ({
              where,
              data,
            }: {
              where: { id: string };
              data: Record<string, unknown>;
            }) => {
              const batch = working.batches.find((item) => item.id === where.id);
              if (!batch) throw new Error("missing import batch");
              if (
                typeof data.rerunCount === "object" &&
                data.rerunCount !== null &&
                "increment" in data.rerunCount
              ) {
                batch.rerunCount += Number(data.rerunCount.increment);
              }
              for (const key of [
                "status",
                "totalRows",
                "succeededRows",
                "failedRows",
                "skippedRows",
                "conflictRows",
                "lastRerunAt",
                "completedAt",
              ] as const) {
                if (key in data) {
                  (batch as unknown as Record<string, unknown>)[key] = data[key];
                }
              }
              return batch;
            },
          },
          guestImportBatchRow: {
            upsert: async ({
              where,
              update,
              create,
            }: {
              where: { batchId_rowKey: { batchId: string; rowKey: string } };
              update: Record<string, unknown>;
              create: Record<string, unknown>;
            }) => {
              const identity = where.batchId_rowKey;
              const existing = working.batchRows.find(
                (row) =>
                  row.batchId === identity.batchId &&
                  row.rowKey === identity.rowKey,
              );
              if (existing) {
                if (
                  typeof update.attemptCount === "object" &&
                  update.attemptCount !== null &&
                  "increment" in update.attemptCount
                ) {
                  existing.attemptCount += Number(update.attemptCount.increment);
                }
                for (const key of [
                  "externalId",
                  "guestImportRecordId",
                  "status",
                  "sourcePayloadHash",
                ] as const) {
                  if (key in update) {
                    (existing as unknown as Record<string, unknown>)[key] =
                      update[key];
                  }
                }
                return existing;
              }
              const row: StoredImportBatchRow = {
                id: `batch_row_${working.batchRows.length + 1}`,
                workspaceId: String(create.workspaceId),
                batchId: String(create.batchId),
                rowKey: String(create.rowKey),
                externalId:
                  create.externalId === null ? null : String(create.externalId),
                guestImportRecordId:
                  create.guestImportRecordId === null
                    ? null
                    : String(create.guestImportRecordId),
                status: String(create.status),
                sourcePayloadHash:
                  create.sourcePayloadHash === null
                    ? null
                    : String(create.sourcePayloadHash),
                attemptCount: 1,
              };
              working.batchRows.push(row);
              return row;
            },
          },
          guestImportRecord: {
            findMany: async ({
              where,
            }: {
              where: {
                workspaceId: string;
                source: string;
                sourceInstance?: string;
                externalId?: { in: string[] };
              };
            }) =>
              working.rsvps
                .filter(
                  (rsvp) =>
                    rsvp.workspaceId === where.workspaceId &&
                    rsvp.source === where.source &&
                    (!where.sourceInstance ||
                      rsvp.sourceInstance === where.sourceInstance) &&
                    (!where.externalId ||
                      where.externalId.in.includes(rsvp.externalId)),
                )
                .map((rsvp) => {
                  const guest = working.guests.find(
                    (item) => item.id === rsvp.guestId,
                  );
                  if (!guest) throw new Error("broken fake relation");
                  const seatingTable = guest.seatingTableId
                    ? (working.tables.find(
                        (table) => table.id === guest.seatingTableId,
                      ) ?? null)
                    : null;
                  return { ...rsvp, guest: { ...guest, seatingTable } };
                }),
            create: async ({ data }: { data: Omit<StoredRsvp, "id"> }) => {
              const importRecord: StoredRsvp = {
                id: `import_record_${working.rsvps.length + 1}`,
                ...data,
              };
              working.rsvps.push(importRecord);
              return importRecord;
            },
            update: async ({
              where,
              data,
            }: {
              where: { id: string };
              data: Partial<StoredRsvp>;
            }) => {
              const rsvp = working.rsvps.find((item) => item.id === where.id);
              if (!rsvp) throw new Error("missing rsvp");
              Object.assign(rsvp, data);
              return rsvp;
            },
          },
          guest: {
            create: async ({
              data,
            }: {
              data: Omit<StoredGuest, "id" | "notes" | "seatingTableId">;
            }) => {
              const guest: StoredGuest = {
                id: `guest_${nextGuestId++}`,
                notes: null,
                seatingTableId: null,
                ...data,
              };
              working.guests.push(guest);
              return guest;
            },
            update: async ({
              where,
              data,
            }: {
              where: { id_workspaceId: { id: string; workspaceId: string } };
              data: Partial<StoredGuest>;
            }) => {
              const guest = working.guests.find(
                (item) =>
                  item.id === where.id_workspaceId.id &&
                  item.workspaceId === where.id_workspaceId.workspaceId,
              );
              if (!guest) throw new Error("missing guest");
              Object.assign(guest, data);
              return guest;
            },
            aggregate: async ({
              where,
            }: {
              where: { workspaceId: string; seatingTableId: string };
            }) => ({
              _sum: {
                partySize: working.guests
                  .filter(
                    (guest) =>
                      guest.workspaceId === where.workspaceId &&
                      guest.seatingTableId === where.seatingTableId,
                  )
                  .reduce((sum, guest) => sum + guest.partySize, 0),
              },
            }),
          },
        };

        const result = await operation(transaction);
        store.workspaces = working.workspaces;
        store.guests = working.guests;
        store.rsvps = working.rsvps;
        store.tables = working.tables;
        store.batches = working.batches;
        store.batchRows = working.batchRows;
        return result;
      },
    },
  };
}

function importedState(
  record = sourceRecord(0),
  overrides: Partial<StoredGuest> = {},
  table?: StoredTable,
) {
  const guest: StoredGuest = {
    id: "guest_imported",
    workspaceId: "workspace_1",
    name: record.name,
    side: record.side as StoredGuest["side"],
    attendanceStatus:
      record.attendanceStatus as StoredGuest["attendanceStatus"],
    partySize: record.partySize,
    notes: "人工備註不得被匯入覆寫",
    seatingTableId: table?.id ?? null,
    ...overrides,
  };
  const rsvp: StoredRsvp = {
    id: `import_record_${guest.id}`,
    guestId: guest.id,
    workspaceId: guest.workspaceId,
    source: "LINEIN",
    sourceInstance: "default",
    sourceLabel: "拍拍印",
    sourceManaged: true,
    managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
    sourcePartySize: record.partySize,
    externalId: record.externalUserId,
    relationshipLabel: record.relationshipLabel,
    contactPhone: record.phone,
    contactEmail: record.email ?? null,
    ceremonyAttendance: record.ceremonyAttendance,
    childSeatCount: record.childSeatCount,
    vegetarianCount: record.vegetarianCount,
    invitationDelivery:
      record.invitationDelivery as StoredRsvp["invitationDelivery"],
    mailingAddress: record.mailingAddress?.trim() ?? null,
    guestMessage: record.message?.trim() ?? null,
    attendanceReply: record.attendanceReply,
    invitationReply: record.invitationReply,
    sourceSubmittedAt: new Date(record.respondedAt),
  };
  return { guest, rsvp, table };
}

describe("normalized LINEIN RSVP parser", () => {
  it("accepts the anonymous 34-record contract and preserves the special declined reply", () => {
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify(anonymousContractRecords()),
    );

    expect(records).toHaveLength(34);
    expect(new Set(records.map((record) => record.externalUserId)).size).toBe(
      34,
    );
    expect(
      records.filter((record) => record.side === "PARTNER_A"),
    ).toHaveLength(17);
    expect(
      records.filter((record) => record.side === "PARTNER_B"),
    ).toHaveLength(17);
    const attending = records.filter(
      (record) => record.attendanceStatus === "ATTENDING",
    );
    expect(attending).toHaveLength(31);
    expect(
      records.filter((record) => record.attendanceStatus === "DECLINED"),
    ).toHaveLength(3);
    expect(attending.reduce((sum, record) => sum + record.partySize, 0)).toBe(
      64,
    );
    expect(
      records.reduce((sum, record) => sum + record.childSeatCount, 0),
    ).toBe(7);
    expect(
      records.reduce((sum, record) => sum + record.vegetarianCount, 0),
    ).toBe(0);
    expect(records[31].attendanceReply).toBe("不克出席，但仍希望收到喜餅");
    expect(records[31].mailingAddress).toBe("測試市測試路 1 號");
    expect(records[0].name).toBe("測試賓客 0");
    expect(records[0].relationshipLabel).toBe("大學 同學");
    expect(records[0].message).toBe("謝謝邀請， 期待見面。");
  });

  it.each([
    ["malformed JSON", "{"],
    ["empty input", "[]"],
    ["invalid top level", "{}"],
  ])("rejects %s", (_label, json) => {
    expect(() => parseNormalizedLineinRsvpJson(json)).toThrow(
      LineinRsvpValidationError,
    );
  });

  it("rejects duplicate opaque external IDs without trimming or echoing them", () => {
    const opaqueId = " secret-external-id ";
    const input = [
      sourceRecord(0, { externalUserId: opaqueId }),
      sourceRecord(1, { externalUserId: opaqueId }),
    ];

    expect(() => parseNormalizedLineinRsvpJson(JSON.stringify(input))).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/第 2 筆.*externalUserId/u),
      }),
    );
    try {
      parseNormalizedLineinRsvpJson(JSON.stringify(input));
    } catch (error) {
      expect((error as Error).message).not.toContain(opaqueId);
    }
  });

  it.each([
    ["source", { source: "OTHER" }],
    ["name", { name: "" }],
    ["side", { side: "OWNER" }],
    ["attendanceStatus", { attendanceStatus: "MAYBE" }],
    ["invitationDelivery", { invitationDelivery: "COURIER" }],
    ["respondedAt", { respondedAt: "2026-02-30T25:99:00Z" }],
    ["partySize", { partySize: 21 }],
    ["childSeatCount", { partySize: 2, childSeatCount: 3 }],
    ["vegetarianCount", { partySize: 2, vegetarianCount: 3 }],
    [
      "mailingAddress",
      { invitationDelivery: "PAPER", mailingAddress: undefined },
    ],
    ["record", { unknownField: "not allowed" }],
  ])("identifies record index and invalid field %s", (field, overrides) => {
    const input = { ...sourceRecord(), ...overrides };
    expect(() =>
      parseNormalizedLineinRsvpJson(JSON.stringify([input])),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(new RegExp(`第 1 筆.*${field}`, "u")),
      }),
    );
  });

  it("counts Unicode code points and never echoes rejected PII", () => {
    const secret = "秘密姓名".repeat(30);
    const emojiName = "囍".repeat(81);

    for (const name of [emojiName, secret]) {
      try {
        parseNormalizedLineinRsvpJson(
          JSON.stringify([sourceRecord(0, { name })]),
        );
        throw new Error("expected validation failure");
      } catch (error) {
        expect(error).toBeInstanceOf(LineinRsvpValidationError);
        expect((error as Error).message).toMatch(/第 1 筆.*name/u);
        expect((error as Error).message).not.toContain(name);
      }
    }
  });

  it("does not echo a PII sentinel used as an unknown field name", () => {
    const record = {
      ...sourceRecord(),
      PII_SENTINEL_UNKNOWN_FIELD: "private value",
    };

    try {
      parseNormalizedLineinRsvpJson(JSON.stringify([record]));
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LineinRsvpValidationError);
      expect((error as Error).message).toMatch(/第 1 筆.*record/u);
      expect((error as Error).message).not.toContain("PII_SENTINEL");
      expect((error as Error).message).not.toContain("private value");
    }
  });

  it("keeps opaque IDs byte-for-byte and only outer-trims source provenance", () => {
    const opaqueId = "  opaque\n id  ";
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        sourceRecord(0, {
          externalUserId: opaqueId,
          relationshipLabel: "  大學  同學\n同社團  ",
          attendanceReply: "  會  出席\n並參加證婚  ",
          invitationReply: "  電子  喜帖\n已收到  ",
          mailingAddress: "  測試市  測試路\n1 號  ",
          message: "  謝謝  邀請\n期待見面  ",
        }),
      ]),
    );

    expect(records[0]).toMatchObject({
      externalUserId: opaqueId,
      relationshipLabel: "大學  同學\n同社團",
      attendanceReply: "會  出席\n並參加證婚",
      invitationReply: "電子  喜帖\n已收到",
      mailingAddress: "測試市  測試路\n1 號",
      message: "謝謝  邀請\n期待見面",
    });
  });

  it("accepts unanswered invitation data only as UNKNOWN with a null reply", () => {
    expect(
      parseNormalizedLineinRsvpJson(
        JSON.stringify([
          sourceRecord(0, {
            invitationDelivery: "UNKNOWN",
            invitationReply: null,
          }),
        ]),
      )[0],
    ).toMatchObject({
      invitationDelivery: "UNKNOWN",
      invitationReply: null,
    });

    for (const overrides of [
      { invitationDelivery: "UNKNOWN", invitationReply: "未填" },
      { invitationDelivery: "UNKNOWN", invitationReply: "" },
      { invitationDelivery: "UNKNOWN", invitationReply: undefined },
      {
        invitationDelivery: "PAPER",
        invitationReply: null,
        mailingAddress: "地址",
      },
      { invitationDelivery: "DIGITAL", invitationReply: null },
      { invitationDelivery: "NONE", invitationReply: null },
    ]) {
      expect(() =>
        parseNormalizedLineinRsvpJson(
          JSON.stringify([sourceRecord(0, overrides)]),
        ),
      ).toThrow(/第 1 筆.*invitationReply/u);
    }
  });
});

describe("LINEIN anonymous manifest", () => {
  it("accepts only the strict v1 anonymous contract and exact input-byte SHA-256", () => {
    const inputJson = JSON.stringify(anonymousContractRecords());
    const records = parseNormalizedLineinRsvpJson(inputJson);
    const manifest = anonymousManifest(inputJson);

    expect(computeLineinRsvpManifestAggregates(records)).toEqual({
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
    expect(
      parseAndValidateLineinRsvpManifestJson(
        JSON.stringify(manifest),
        Buffer.from(inputJson, "utf8"),
        records,
      ),
    ).toEqual(manifest);
  });

  it.each([
    [
      "33-record input",
      (manifest: ReturnType<typeof anonymousManifest>) => manifest,
    ],
    [
      "wrong hash",
      (manifest: ReturnType<typeof anonymousManifest>) => ({
        ...manifest,
        inputSha256: "0".repeat(64),
      }),
    ],
    [
      "wrong aggregate",
      (manifest: ReturnType<typeof anonymousManifest>) => ({
        ...manifest,
        attendingPartySize: 63,
      }),
    ],
  ])("rejects %s without echoing manifest values", (_label, mutate) => {
    const recordsInput =
      _label === "33-record input"
        ? anonymousContractRecords().slice(0, 33)
        : anonymousContractRecords();
    const inputJson = JSON.stringify(recordsInput);
    const records = parseNormalizedLineinRsvpJson(inputJson);
    const manifest = mutate(anonymousManifest(inputJson));

    expect(() =>
      parseAndValidateLineinRsvpManifestJson(
        JSON.stringify(manifest),
        Buffer.from(inputJson, "utf8"),
        records,
      ),
    ).toThrow(new LineinRsvpImportError("匿名 manifest 與匯入資料不符。"));
  });

  it("rejects unknown manifest keys as a fixed non-PII error", () => {
    const inputJson = JSON.stringify(anonymousContractRecords());
    const records = parseNormalizedLineinRsvpJson(inputJson);
    const manifest = {
      ...anonymousManifest(inputJson),
      privateName: "PII_SENTINEL",
    };

    expect(() =>
      parseAndValidateLineinRsvpManifestJson(
        JSON.stringify(manifest),
        Buffer.from(inputJson, "utf8"),
        records,
      ),
    ).toThrow(new LineinRsvpImportError("匿名 manifest 格式無效。"));
  });
});

describe("LINEIN RSVP importer", () => {
  it("defaults CLI parsing to dry-run and requires two matching workspace IDs plus input and manifest", () => {
    expect(
      parseLineinRsvpCliArguments([
        "--workspace-id",
        "workspace_1",
        "--confirm-workspace-id",
        "workspace_1",
        "--input",
        "normalized.json",
        "--manifest",
        "anonymous-manifest.json",
      ]),
    ).toEqual({
      workspaceId: "workspace_1",
      confirmWorkspaceId: "workspace_1",
      inputPath: "normalized.json",
      manifestPath: "anonymous-manifest.json",
      apply: false,
    });
    expect(
      parseLineinRsvpCliArguments([
        "--workspace-id",
        "workspace_1",
        "--confirm-workspace-id",
        "workspace_1",
        "--input",
        "normalized.json",
        "--manifest",
        "anonymous-manifest.json",
        "--apply",
      ]).apply,
    ).toBe(true);
    expect(() =>
      parseLineinRsvpCliArguments(["--input", "normalized.json"]),
    ).toThrow(LineinRsvpImportError);
    expect(() =>
      parseLineinRsvpCliArguments([
        "--workspace-id",
        "workspace_1",
        "--confirm-workspace-id",
        "workspace_other",
        "--input",
        "normalized.json",
        "--manifest",
        "anonymous-manifest.json",
      ]),
    ).toThrow(new LineinRsvpImportError("兩次指定的婚宴工作區不一致。"));
  });

  it("dry-runs without writes and prints aggregate counts only", async () => {
    const fake = fakeClient();
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        sourceRecord(0),
        sourceRecord(1, { attendanceStatus: "DECLINED", partySize: 1 }),
      ]),
    );

    const result = await importLineinRsvpRecords({
      client: fake.client,
      workspaceId: "workspace_1",
      records,
      apply: false,
    });

    expect(result).toMatchObject({
      mode: "dry-run",
      input: 2,
      create: 2,
      update: 0,
      unchanged: 0,
      conflict: 0,
      attendingGroups: 1,
      declinedGroups: 1,
      attendingPartySize: 3,
    });
    expect(fake.store.guests).toHaveLength(0);
    expect(fake.store.rsvps).toHaveLength(0);
    expect(fake.store.batches).toHaveLength(0);
    expect(fake.store.batchRows).toHaveLength(0);
    const output = formatLineinRsvpImportSummary(result);
    expect(output).toContain("input=2");
    expect(output).not.toContain("測試賓客");
    expect(output).not.toContain("0900");
    expect(fake.transactions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("creates Guest and GuestImportRecord atomically, then reruns identically as unchanged", async () => {
    const fake = fakeClient();
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord(0)]),
    );

    await expect(
      importLineinRsvpRecords({
        client: fake.client,
        workspaceId: "workspace_1",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 1, update: 0, unchanged: 0 });
    expect(fake.store.guests).toHaveLength(1);
    expect(fake.store.rsvps).toHaveLength(1);
    expect(fake.store.rsvps[0]).toMatchObject({
      workspaceId: "workspace_1",
      guestId: fake.store.guests[0].id,
      source: "LINEIN",
      sourceInstance: "default",
      sourceLabel: "拍拍印",
      sourceManaged: true,
      managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
      sourcePartySize: 3,
      externalId: "synthetic-external-0",
    });
    expect(fake.store.guests[0].partySize).toBe(3);
    expect(fake.store.batches).toHaveLength(1);
    expect(fake.store.batches[0]).toMatchObject({
      workspaceId: "workspace_1",
      source: "LINEIN",
      sourceInstance: "default",
      sourceLabel: "拍拍印",
      mappingVersion: "linein-rsvp-v2",
      status: "SUCCEEDED",
      totalRows: 1,
      succeededRows: 1,
      skippedRows: 0,
      rerunCount: 0,
    });
    expect(fake.store.batches[0].idempotencyKey).toMatch(
      /^linein-rsvp-v2:[a-f0-9]{64}$/u,
    );
    expect(fake.store.batchRows).toHaveLength(1);
    expect(fake.store.batchRows[0]).toMatchObject({
      workspaceId: "workspace_1",
      batchId: fake.store.batches[0].id,
      externalId: "synthetic-external-0",
      guestImportRecordId: fake.store.rsvps[0].id,
      status: "SUCCEEDED",
      attemptCount: 1,
    });
    expect(fake.store.batchRows[0].rowKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(fake.store.batchRows[0].sourcePayloadHash).toMatch(
      /^[a-f0-9]{64}$/u,
    );

    const firstCompletedAt = fake.store.batches[0].completedAt;
    await expect(
      importLineinRsvpRecords({
        client: fake.client,
        workspaceId: "workspace_1",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 0, update: 0, unchanged: 1 });
    expect(fake.store.guests).toHaveLength(1);
    expect(fake.store.rsvps).toHaveLength(1);
    expect(fake.store.batches).toHaveLength(1);
    expect(fake.store.batches[0]).toMatchObject({
      status: "SUCCEEDED",
      succeededRows: 1,
      skippedRows: 0,
      rerunCount: 1,
      completedAt: firstCompletedAt,
    });
    expect(fake.store.batchRows).toHaveLength(1);
    expect(fake.store.batchRows[0]).toMatchObject({
      status: "SUCCEEDED",
      attemptCount: 2,
    });
  });

  it("preserves a manually edited Guest party size on an identical rerun", async () => {
    const fake = fakeClient();
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord(0, { partySize: 3 })]),
    );

    await importLineinRsvpRecords({
      client: fake.client,
      workspaceId: "workspace_1",
      records,
      apply: true,
    });
    fake.store.guests[0].partySize = 5;

    await expect(
      importLineinRsvpRecords({
        client: fake.client,
        workspaceId: "workspace_1",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 0, update: 0, unchanged: 1 });
    expect(fake.store.guests[0].partySize).toBe(5);
    expect(fake.store.rsvps[0].sourcePartySize).toBe(3);
  });

  it("updates source-owned fields and provenance while preserving operational party size", async () => {
    const table = { id: "table_1", workspaceId: "workspace_1", capacity: 10 };
    const existing = importedState(sourceRecord(0), { partySize: 2 }, table);
    const fake = fakeClient({
      guests: [existing.guest],
      rsvps: [existing.rsvp],
      tables: [table],
    });
    const changed = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        sourceRecord(0, {
          name: "更新後姓名",
          partySize: 4,
          relationshipLabel: "更新關係",
          attendanceReply: "確定會到",
        }),
      ]),
    );

    await expect(
      importLineinRsvpRecords({
        client: fake.client,
        workspaceId: "workspace_1",
        records: changed,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 0, update: 1, unchanged: 0 });
    expect(fake.store.guests[0]).toMatchObject({
      id: "guest_imported",
      name: "更新後姓名",
      partySize: 2,
      notes: "人工備註不得被匯入覆寫",
      seatingTableId: "table_1",
    });
    expect(fake.store.rsvps[0]).toMatchObject({
      guestId: "guest_imported",
      sourcePartySize: 4,
      relationshipLabel: "更新關係",
      attendanceReply: "確定會到",
    });
  });

  it("updates only LINEIN provenance when the canonical Guest has another source", async () => {
    const existing = importedState(sourceRecord(0));
    const otherSource = {
      ...existing.rsvp,
      id: "import_record_other_source",
      source: "FORMSTACK",
      sourceLabel: "合成表單",
      sourceManaged: false,
      externalId: "other-source-id",
      relationshipLabel: "另一來源原值",
    };
    const fake = fakeClient({
      guests: [existing.guest],
      rsvps: [existing.rsvp, otherSource],
    });
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        sourceRecord(0, {
          name: "LINEIN 更新後姓名",
          relationshipLabel: "LINEIN 更新關係",
        }),
      ]),
    );

    await expect(
      importLineinRsvpRecords({
        client: fake.client,
        workspaceId: "workspace_1",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ create: 0, update: 1, unchanged: 0 });

    expect(fake.store.guests).toHaveLength(1);
    expect(fake.store.rsvps).toHaveLength(2);
    expect(
      fake.store.rsvps.find((record) => record.source === "LINEIN"),
    ).toMatchObject({ relationshipLabel: "LINEIN 更新關係" });
    expect(
      fake.store.rsvps.find((record) => record.source === "FORMSTACK"),
    ).toEqual(otherSource);
  });

  it("never merges by name and scopes the same external ID independently per workspace", async () => {
    const fake = fakeClient({
      workspaces: ["workspace_1", "workspace_2"],
      guests: [
        {
          id: "manual_guest",
          workspaceId: "workspace_1",
          name: "測試賓客 0",
          side: "SHARED",
          attendanceStatus: "ATTENDING",
          partySize: 1,
          notes: "manual",
          seatingTableId: null,
        },
      ],
    });
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord(0)]),
    );

    await importLineinRsvpRecords({
      client: fake.client,
      workspaceId: "workspace_1",
      records,
      apply: true,
    });
    await importLineinRsvpRecords({
      client: fake.client,
      workspaceId: "workspace_2",
      records,
      apply: true,
    });

    expect(fake.store.guests).toHaveLength(3);
    expect(
      fake.store.guests.find((guest) => guest.id === "manual_guest"),
    ).toMatchObject({
      notes: "manual",
    });
    expect(fake.store.rsvps).toHaveLength(2);
    expect(fake.store.rsvps.map((rsvp) => rsvp.workspaceId).sort()).toEqual([
      "workspace_1",
      "workspace_2",
    ]);
  });

  it("rejects an unknown workspace without writing", async () => {
    const fake = fakeClient({ workspaces: [] });
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord()]),
    );

    await expect(
      importLineinRsvpRecords({
        client: fake.client,
        workspaceId: "workspace_missing",
        records,
        apply: true,
      }),
    ).rejects.toEqual(new LineinRsvpImportError("指定的婚宴工作區不存在。"));
    expect(fake.store.guests).toHaveLength(0);
    expect(fake.store.rsvps).toHaveLength(0);
  });

  it("rolls back the whole transaction when a write fails", async () => {
    const fake = fakeClient();
    const failingClient = {
      $transaction(
        operation: (transaction: unknown) => Promise<unknown>,
        options: { isolationLevel?: string },
      ) {
        return fake.client.$transaction(async (transaction) => {
          const mutableTransaction = transaction as {
            guestImportRecord: {
              create: (...args: unknown[]) => Promise<unknown>;
            };
          };
          mutableTransaction.guestImportRecord.create = async () => {
            throw new Error("raw database error containing private data");
          };
          return operation(transaction);
        }, options);
      },
    };
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord(0), sourceRecord(1)]),
    );

    await expect(
      importLineinRsvpRecords({
        client: failingClient,
        workspaceId: "workspace_1",
        records,
        apply: true,
      }),
    ).rejects.toEqual(
      new LineinRsvpImportError("匯入交易失敗，沒有寫入任何資料。"),
    );
    expect(fake.store.guests).toHaveLength(0);
    expect(fake.store.rsvps).toHaveLength(0);
    expect(fake.store.batches).toHaveLength(0);
    expect(fake.store.batchRows).toHaveLength(0);
  });

  it("aborts the entire apply when an assigned imported guest becomes declined", async () => {
    const table = { id: "table_1", workspaceId: "workspace_1", capacity: 10 };
    const existing = importedState(sourceRecord(0), {}, table);
    const fake = fakeClient({
      guests: [existing.guest],
      rsvps: [existing.rsvp],
      tables: [table],
    });
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        sourceRecord(1),
        sourceRecord(0, {
          attendanceStatus: "DECLINED",
          attendanceReply: "不克出席，但仍希望收到喜餅",
          partySize: 1,
        }),
      ]),
    );

    const result = await importLineinRsvpRecords({
      client: fake.client,
      workspaceId: "workspace_1",
      records,
      apply: true,
    });

    expect(result).toMatchObject({ create: 1, conflict: 1, applied: false });
    expect(fake.store.guests).toHaveLength(1);
    expect(fake.store.rsvps[0].attendanceReply).toBe("會出席");
  });

  it("does not apply source party-size changes to assigned Guest occupancy", async () => {
    const table = { id: "table_1", workspaceId: "workspace_1", capacity: 6 };
    const first = importedState(
      sourceRecord(0, { partySize: 2 }),
      { id: "guest_a" },
      table,
    );
    const second = importedState(
      sourceRecord(1, { partySize: 2 }),
      { id: "guest_b" },
      table,
    );
    second.rsvp.guestId = "guest_b";
    const fake = fakeClient({
      guests: [first.guest, second.guest],
      rsvps: [first.rsvp, second.rsvp],
      tables: [table],
    });
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        sourceRecord(0, {
          partySize: 4,
          name: "PII_SENTINEL_NAME",
          phone: "PII_SENTINEL_PHONE",
          email: "pii-sentinel@example.test",
          attendanceReply: "PII_SENTINEL_SOURCE_REPLY",
          message: "PII_SENTINEL_MESSAGE",
        }),
        sourceRecord(1, { partySize: 4 }),
      ]),
    );

    const result = await importLineinRsvpRecords({
      client: fake.client,
      workspaceId: "workspace_1",
      records,
      apply: true,
    });

    expect(result).toMatchObject({ update: 2, conflict: 0, applied: true });
    expect(fake.store.guests.map((guest) => guest.partySize)).toEqual([2, 2]);
    expect(fake.store.rsvps.map((rsvp) => rsvp.sourcePartySize)).toEqual([4, 4]);
    expect(formatLineinRsvpImportSummary(result)).not.toContain("PII_SENTINEL");
    expect(formatLineinRsvpImportSummary(result)).not.toContain(
      "pii-sentinel@example.test",
    );
  });

  it("preserves differing operational party sizes across a changed-source update", async () => {
    const table = { id: "table_1", workspaceId: "workspace_1", capacity: 4 };
    const first = importedState(
      sourceRecord(0, { partySize: 3 }),
      { id: "guest_a" },
      table,
    );
    const second = importedState(
      sourceRecord(1, { partySize: 1 }),
      { id: "guest_b" },
      table,
    );
    second.rsvp.guestId = "guest_b";
    const fake = fakeClient({
      guests: [first.guest, second.guest],
      rsvps: [first.rsvp, second.rsvp],
      tables: [table],
    });
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([
        sourceRecord(0, { partySize: 2 }),
        sourceRecord(1, { partySize: 2 }),
      ]),
    );

    const result = await importLineinRsvpRecords({
      client: fake.client,
      workspaceId: "workspace_1",
      records,
      apply: true,
    });

    expect(result).toMatchObject({ update: 2, conflict: 0, applied: true });
    expect(fake.store.guests.map((guest) => guest.partySize)).toEqual([3, 1]);
    expect(fake.store.rsvps.map((rsvp) => rsvp.sourcePartySize)).toEqual([2, 2]);
  });

  it("treats existing LINEIN IDs absent from the full snapshot as a conflict and preserves them", async () => {
    const existing = importedState(sourceRecord(0));
    const fake = fakeClient({
      guests: [existing.guest],
      rsvps: [existing.rsvp],
    });
    const records = parseNormalizedLineinRsvpJson(
      JSON.stringify([sourceRecord(1)]),
    );

    await expect(
      importLineinRsvpRecords({
        client: fake.client,
        workspaceId: "workspace_1",
        records,
        apply: false,
      }),
    ).resolves.toMatchObject({
      create: 1,
      update: 0,
      unchanged: 0,
      conflict: 1,
      applied: false,
    });
    await expect(
      importLineinRsvpRecords({
        client: fake.client,
        workspaceId: "workspace_1",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ conflict: 1, applied: false });
    expect(fake.store.guests).toEqual([existing.guest]);
    expect(fake.store.rsvps).toEqual([existing.rsvp]);
  });

  it("returns a fixed non-PII error after bounded unique or serialization retries", async () => {
    const transaction = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: ["PII_SENTINEL_EXTERNAL_ID"] },
    });

    await expect(
      importLineinRsvpRecords({
        client: { $transaction: transaction },
        workspaceId: "workspace_1",
        records: parseNormalizedLineinRsvpJson(
          JSON.stringify([sourceRecord(0)]),
        ),
        apply: true,
      }),
    ).rejects.toEqual(
      new LineinRsvpImportError("同時有其他匯入作業，請確認後重新執行。"),
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});

describe("LINEIN RSVP CLI safety boundary", () => {
  it("derives the repository boundary from the checked-in script location", () => {
    expect(LINEIN_RSVP_REPOSITORY_ROOT).toBe(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    );
  });

  it("reads from one verified external handle and rejects repository or symlink targets", async () => {
    const repositoryRoot = await mkdtemp(
      path.join(tmpdir(), "linein-rsvp-repository-"),
    );
    const externalRoot = await mkdtemp(
      path.join(tmpdir(), "linein-rsvp-external-"),
    );
    try {
      const internalPath = path.join(repositoryRoot, "internal.json");
      const externalPath = path.join(externalRoot, "external.json");
      const symlinkPath = path.join(externalRoot, "external-link.json");
      await writeFile(internalPath, "internal", "utf8");
      await writeFile(externalPath, "external", "utf8");
      await symlink(externalPath, symlinkPath);

      await expect(
        readVerifiedExternalFileBytes(repositoryRoot, externalPath),
      ).resolves.toEqual(Buffer.from("external"));
      await expect(
        readVerifiedExternalFileBytes(repositoryRoot, internalPath),
      ).rejects.toEqual(
        new LineinRsvpImportError(
          "匯入檔與匿名 manifest 必須位於 repository 外。",
        ),
      );
      await expect(
        readVerifiedExternalFileBytes(repositoryRoot, symlinkPath),
      ).rejects.toBeDefined();
    } finally {
      await Promise.all([
        rm(repositoryRoot, { recursive: true, force: true }),
        rm(externalRoot, { recursive: true, force: true }),
      ]);
    }
  });

  function cliArguments() {
    return [
      "--workspace-id",
      "workspace_1",
      "--confirm-workspace-id",
      "workspace_1",
      "--input",
      "/operator/input.json",
      "--manifest",
      "/operator/manifest.json",
    ];
  }

  function cliFiles(records = anonymousContractRecords()) {
    const inputJson = JSON.stringify(records);
    return {
      inputBytes: Buffer.from(inputJson, "utf8"),
      manifestBytes: Buffer.from(
        JSON.stringify(anonymousManifest(inputJson)),
        "utf8",
      ),
    };
  }

  function safeCliDependencies(overrides: Record<string, unknown> = {}) {
    const files = cliFiles();
    const fake = fakeClient();
    const createClient = vi.fn(() => ({
      ...fake.client,
      $disconnect: async () => undefined,
    }));
    const output: string[] = [];
    const errors: string[] = [];
    return {
      dependencies: {
        databaseUrl: "postgresql://operator:secret@localhost/vowbook_test",
        repositoryRoot: "/repo/VowBook",
        resolveRealPath: vi.fn(async (filePath: string) => filePath),
        readFileBytes: vi.fn(async (filePath: string) =>
          filePath.endsWith("manifest.json")
            ? files.manifestBytes
            : files.inputBytes,
        ),
        createClient,
        writeOutput: (line: string) => output.push(line),
        writeError: (line: string) => errors.push(line),
        ...overrides,
      },
      createClient,
      output,
      errors,
    };
  }

  it.each([
    ["33 records", anonymousContractRecords().slice(0, 33), {}],
    ["wrong hash", anonymousContractRecords(), { inputSha256: "0".repeat(64) }],
    ["wrong aggregate", anonymousContractRecords(), { partnerA: 16 }],
  ])(
    "rejects %s before creating a database client",
    async (_label, records, manifestOverrides) => {
      const inputJson = JSON.stringify(records);
      const inputBytes = Buffer.from(inputJson, "utf8");
      const manifestBytes = Buffer.from(
        JSON.stringify({
          ...anonymousManifest(inputJson),
          ...manifestOverrides,
        }),
        "utf8",
      );
      const setup = safeCliDependencies({
        readFileBytes: vi.fn(async (filePath: string) =>
          filePath.endsWith("manifest.json") ? manifestBytes : inputBytes,
        ),
      });

      await expect(
        runLineinRsvpCli(cliArguments(), setup.dependencies),
      ).resolves.toBe(1);
      expect(setup.createClient).not.toHaveBeenCalled();
      expect(setup.errors).toEqual(["匿名 manifest 與匯入資料不符。"]);
    },
  );

  it("rejects duplicate external IDs before any database call without echoing the ID", async () => {
    const sentinel = "PII_SENTINEL_EXTERNAL_ID";
    const records = anonymousContractRecords();
    records[1] = sourceRecord(1, { externalUserId: sentinel });
    records[2] = sourceRecord(2, { externalUserId: sentinel });
    const inputJson = JSON.stringify(records);
    const setup = safeCliDependencies({
      readFileBytes: vi.fn(async (filePath: string) =>
        filePath.endsWith("manifest.json")
          ? Buffer.from(JSON.stringify(anonymousManifest(inputJson)), "utf8")
          : Buffer.from(inputJson, "utf8"),
      ),
    });

    await expect(
      runLineinRsvpCli(cliArguments(), setup.dependencies),
    ).resolves.toBe(1);
    expect(setup.createClient).not.toHaveBeenCalled();
    expect(setup.errors.join(" ")).not.toContain(sentinel);
    expect(setup.output.join(" ")).not.toContain(sentinel);
  });

  it("resolves input and manifest symlinks and rejects either resolved path inside the repository", async () => {
    for (const internalTarget of [
      "/repo/VowBook/private-input.json",
      "/repo/VowBook/private-manifest.json",
    ]) {
      const setup = safeCliDependencies({
        resolveRealPath: vi.fn(async (filePath: string) =>
          filePath.endsWith("input.json") ===
          internalTarget.endsWith("input.json")
            ? internalTarget
            : filePath,
        ),
      });

      await expect(
        runLineinRsvpCli(cliArguments(), setup.dependencies),
      ).resolves.toBe(1);
      expect(setup.createClient).not.toHaveBeenCalled();
      expect(setup.errors).toEqual([
        "匯入檔與匿名 manifest 必須位於 repository 外。",
      ]);
      expect(setup.errors.join(" ")).not.toContain(internalTarget);
    }
  });

  it("returns exit 2 for a dry-run full-snapshot conflict and prints aggregate-only output", async () => {
    const files = cliFiles();
    const existing = importedState(sourceRecord(99));
    const fake = fakeClient({
      guests: [existing.guest],
      rsvps: [existing.rsvp],
    });
    const output: string[] = [];
    const errors: string[] = [];

    await expect(
      runLineinRsvpCli(cliArguments(), {
        databaseUrl: "postgresql://operator:secret@localhost/vowbook_test",
        repositoryRoot: "/repo/VowBook",
        resolveRealPath: async (filePath: string) => filePath,
        readFileBytes: async (filePath: string) =>
          filePath.endsWith("manifest.json")
            ? files.manifestBytes
            : files.inputBytes,
        createClient: () => ({
          ...fake.client,
          $disconnect: async () => undefined,
        }),
        writeOutput: (line: string) => output.push(line),
        writeError: (line: string) => errors.push(line),
      }),
    ).resolves.toBe(2);
    expect(errors).toEqual([]);
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("conflict=1");
    expect(output[0]).not.toContain("PII_SENTINEL");
    expect(output[0]).not.toContain("synthetic-external");
  });

  it("prints a fixed workspace-not-found error without IDs or raw database output", async () => {
    const setup = safeCliDependencies({
      createClient: () => {
        const fake = fakeClient({ workspaces: [] });
        return {
          ...fake.client,
          $disconnect: async () => undefined,
        };
      },
    });

    await expect(
      runLineinRsvpCli(cliArguments(), setup.dependencies),
    ).resolves.toBe(1);
    expect(setup.output).toEqual([]);
    expect(setup.errors).toEqual(["指定的婚宴工作區不存在。"]);
    expect(setup.errors.join(" ")).not.toContain("workspace_1");
    expect(setup.errors.join(" ")).not.toContain("postgresql://");
  });
});
