import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  NotionBudgetImportError,
  NotionBudgetValidationError,
  computeNotionBudgetManifestAggregates,
  computeNotionBudgetSourceHash,
  formatNotionBudgetImportSummary,
  importNotionBudgetRecords,
  parseAndValidateNotionBudgetManifestJson,
  parseNormalizedNotionBudgetJson,
  parseNotionBudgetCliArguments,
  runNotionBudgetCli,
  type NormalizedNotionBudgetRecord,
} from "./notion-budget-import.mjs";

const BUDGET_SYSTEM_ITEM_KEYS = [
  "ITEM_PROPOSAL",
  "ITEM_WEDDING_VENUE",
  "ITEM_PRE_WEDDING_PHOTOGRAPHY",
  "ITEM_WEDDING_CAKES",
  "ITEM_BRIDAL_STYLIST",
  "ITEM_WEDDING_PHOTOGRAPHY",
  "ITEM_WEDDING_VIDEOGRAPHY",
  "ITEM_WEDDING_HOST",
  "ITEM_WEDDING_BAND",
  "ITEM_WEDDING_INTERACTION",
  "ITEM_ATTIRE_RENTAL",
  "ITEM_WEDDING_SHOES",
  "ITEM_WEDDING_DECOR",
  "ITEM_INVITATIONS_POSTAGE",
  "ITEM_BEAUTY_TREATMENTS",
  "ITEM_WEDDING_FAVORS",
  "ITEM_ENGAGEMENT_GROOM",
  "ITEM_ENGAGEMENT_BRIDE",
  "ITEM_PROCESSION_GROOM",
  "ITEM_PROCESSION_BRIDE",
  "INTERNAL_UNCLASSIFIED_ITEM",
] as const;

type RawRecord = {
  source: "NOTION";
  externalId: string;
  parentExternalId: string | null;
  sourceOrder: number;
  name: string;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  totalAmount: number;
  rollupAmount: number;
  estimatedRange: string | null;
  candidateVendors: string | null;
  confirmedVendor: string | null;
  vendorContact: string | null;
  primaryContact: "PARTNER_A" | "PARTNER_B" | null;
  bookingStatus: "PLANNING" | "BOOKED_BALANCE_DUE" | "PAID";
  notes: string | null;
};

function syntheticUuid(index: number): string {
  return `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function recomputeSyntheticRollups(records: RawRecord[]): void {
  const children = new Map<string, RawRecord[]>();
  for (const record of records) {
    if (record.parentExternalId) {
      const siblings = children.get(record.parentExternalId) ?? [];
      siblings.push(record);
      children.set(record.parentExternalId, siblings);
    }
  }
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    record.rollupAmount = (children.get(record.externalId) ?? []).reduce(
      (sum, child) => sum + child.totalAmount,
      0,
    );
    record.totalAmount =
      (record.depositAmount ?? 0) +
      (record.balanceAmount ?? 0) +
      (record.additionalAmount ?? 0) +
      record.rollupAmount;
  }
}

function syntheticRawRecords(): RawRecord[] {
  const parentIndexes: Array<number | null> = [
    null,
    null,
    null,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    ...Array.from({ length: 21 }, (_, offset) => 3 + Math.floor(offset / 3)),
    0,
    0,
    0,
    1,
    1,
    2,
  ];
  // Match the source's real edge-depth distribution without using any real IDs
  // or content: one former parent becomes a leaf while another leaf becomes a
  // depth-2 parent, preserving 3 roots / 10 parents / 27 leaves at max depth 3.
  parentIndexes[28] = 10;
  parentIndexes[29] = 8;
  parentIndexes[30] = 8;

  const records: RawRecord[] = parentIndexes.map((parentIndex, index) => {
    const directAmount =
      index === 36 ? 754_185 : 1_000 + index * 100;
    const bookingStatus =
      index < 18
        ? "PAID"
        : index < 25
          ? "BOOKED_BALANCE_DUE"
          : "PLANNING";
    return {
      source: "NOTION",
      externalId: syntheticUuid(index),
      parentExternalId:
        parentIndex === null ? null : syntheticUuid(parentIndex),
      sourceOrder: index,
      name: `合成預算節點 ${String(index + 1).padStart(2, "0")}`,
      depositAmount: directAmount,
      balanceAmount: null,
      additionalAmount: null,
      totalAmount: directAmount,
      rollupAmount: 0,
      estimatedRange: index === 10 ? "合成估價範圍" : null,
      candidateVendors: index === 10 ? "合成候選廠商" : null,
      confirmedVendor: index === 11 ? "合成確認廠商" : null,
      vendorContact:
        index === 11 ? "synthetic-contact@example.test" : null,
      primaryContact: index % 3 === 0 ? "PARTNER_A" : null,
      bookingStatus,
      notes: index === 12 ? "合成備註" : null,
    };
  });

  recomputeSyntheticRollups(records);
  return records;
}

function inputJson(records = syntheticRawRecords()): string {
  return JSON.stringify(records);
}

function manifestJson(json: string, records: NormalizedNotionBudgetRecord[]) {
  return JSON.stringify({
    version: 1,
    source: "NOTION",
    inputSha256: createHash("sha256").update(json).digest("hex"),
    ...computeNotionBudgetManifestAggregates(records),
  });
}

type StoredItem = Record<string, unknown> & {
  id: string;
  workspaceId: string;
  parentId: string | null;
  source: "MANUAL" | "NOTION";
  externalId: string | null;
  sourceHash: string | null;
};

function cloneItems(items: StoredItem[]): StoredItem[] {
  return items.map((item) => ({ ...item }));
}

function fakeClient(
  initial: StoredItem[] = [],
  failParentUpdate = false,
  workspaceExists = true,
) {
  const store = { items: cloneItems(initial) };
  let nextId = 1;

  function transactionFor(items: StoredItem[]) {
    return {
      weddingWorkspace: {
        findUnique: vi.fn(async () =>
          workspaceExists ? { id: "synthetic_workspace" } : null,
        ),
      },
      budgetItem: {
        findMany: vi.fn(async (args?: { where?: { systemTaxonomyKey?: unknown } }) => {
          if (args?.where?.systemTaxonomyKey) {
            return BUDGET_SYSTEM_ITEM_KEYS.map((systemTaxonomyKey) => ({
              id: `fixed_${systemTaxonomyKey}`,
              systemTaxonomyKey,
            }));
          }
          return items
            .filter((item) => item.source === "NOTION")
            .map((item) => {
              const parent = item.parentId
                ? items.find((candidate) => candidate.id === item.parentId)
                : null;
              return {
                ...item,
                parent: item.parentId
                  ? {
                      externalId: parent?.externalId ?? null,
                      systemTaxonomyKey:
                        parent?.systemTaxonomyKey ??
                        (item.parentId.startsWith("fixed_")
                          ? item.parentId.slice("fixed_".length)
                          : null),
                    }
                  : null,
              };
            });
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (failParentUpdate) {
            throw new Error("synthetic database detail");
          }
          const item: StoredItem = {
            ...data,
            id: `synthetic_native_${nextId++}`,
            workspaceId: String(data.workspaceId),
            parentId: String(data.parentId),
            source: data.source as "NOTION",
            externalId: String(data.externalId),
            sourceHash: String(data.sourceHash),
            version: 0,
            createdAt: new Date("2027-01-01T00:00:00.000Z"),
            updatedAt: new Date("2027-01-01T00:00:00.000Z"),
          };
          items.push(item);
          return { id: item.id };
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: { parentId: string } }) => {
            if (failParentUpdate) {
              throw new Error("synthetic database detail");
            }
            const item = items.find((candidate) => candidate.id === where.id);
            if (!item) throw new Error("synthetic missing row");
            item.parentId = data.parentId;
            return item;
          },
        ),
      },
    };
  }

  const client = {
    $transaction: vi.fn(
      async (callback: (transaction: unknown) => Promise<unknown>) => {
        const pending = cloneItems(store.items);
        const result = await callback(transactionFor(pending));
        store.items = pending;
        return result;
      },
    ),
    $disconnect: vi.fn(async () => undefined),
  };
  return { client, store };
}

describe("Notion Budget normalized parser", () => {
  it("validates the fixed anonymous 37-row active tree and derives native fields", () => {
    const records = parseNormalizedNotionBudgetJson(inputJson());

    expect(records).toHaveLength(37);
    expect(computeNotionBudgetManifestAggregates(records)).toEqual({
      recordCount: 37,
      uniqueExternalIds: 37,
      rootCount: 3,
      parentCount: 10,
      leafCount: 27,
      maxDepth: 3,
      paidCount: 18,
      bookedBalanceDueCount: 7,
      planningCount: 12,
      rootRollupTotal: 853185,
      formulaMismatchCount: 0,
    });
    expect(records[3]).toMatchObject({
      kind: "EXPENSE",
      category: "OTHER_PENDING",
      dueDate: null,
      plannedAmount: 1300,
      actualAmount: 1300,
      paid: true,
      paidAt: null,
    });
    expect(records[20]).toMatchObject({
      bookingStatus: "BOOKED_BALANCE_DUE",
      actualAmount: 3000,
      paid: false,
    });
    expect(records[30]).toMatchObject({
      bookingStatus: "PLANNING",
      actualAmount: null,
    });
    expect(records.every((record) => /^[0-9a-f]{64}$/u.test(record.sourceHash))).toBe(true);
  });

  it("classifies only metadata-free neutral parents as groups", () => {
    const rows = syntheticRawRecords();
    rows[22].depositAmount =
      (rows[22].depositAmount ?? 0) + (rows[7].depositAmount ?? 0);
    rows[25].depositAmount =
      (rows[25].depositAmount ?? 0) + (rows[8].depositAmount ?? 0);
    for (const index of [7, 8]) {
      rows[index].depositAmount = null;
      rows[index].balanceAmount = null;
      rows[index].additionalAmount = null;
      rows[index].bookingStatus = "PLANNING";
    }
    rows[31].bookingStatus = "PAID";
    rows[32].bookingStatus = "PAID";
    rows[8].notes = "合成父項備註必須保留可編輯";
    rows[7].primaryContact = null;
    rows[8].primaryContact = null;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      rows[index].rollupAmount = rows
        .filter((candidate) => candidate.parentExternalId === rows[index].externalId)
        .reduce((sum, child) => sum + child.totalAmount, 0);
      rows[index].totalAmount =
        (rows[index].depositAmount ?? 0) +
        (rows[index].balanceAmount ?? 0) +
        (rows[index].additionalAmount ?? 0) +
        rows[index].rollupAmount;
    }

    const records = parseNormalizedNotionBudgetJson(inputJson(rows));

    expect(records[7]).toMatchObject({ kind: "GROUP", category: null });
    expect(records[8]).toMatchObject({
      kind: "EXPENSE",
      category: "OTHER_PENDING",
      notes: "合成父項備註必須保留可編輯",
    });
  });

  it("uses versioned canonical JSON hashes with explicit nullable fields", () => {
    const [record] = parseNormalizedNotionBudgetJson(inputJson());
    const firstHash = computeNotionBudgetSourceHash(record);
    expect(firstHash).toBe(record.sourceHash);
    expect(computeNotionBudgetSourceHash({ ...record })).toBe(firstHash);
    expect(
      computeNotionBudgetSourceHash({ ...record, notes: "合成修改" }),
    ).not.toBe(firstHash);
  });

  it.each([
    ["unknown field", (rows: RawRecord[]) => Object.assign(rows[0], { rawNotion: "forbidden" })],
    ["duplicate id", (rows: RawRecord[]) => { rows[1].externalId = rows[0].externalId; }],
    ["missing parent", (rows: RawRecord[]) => { rows[10].parentExternalId = syntheticUuid(99); }],
    ["cycle", (rows: RawRecord[]) => { rows[0].parentExternalId = rows[3].externalId; }],
    ["formula mismatch", (rows: RawRecord[]) => { rows[0].totalAmount += 1; }],
    ["rollup mismatch", (rows: RawRecord[]) => { rows[0].rollupAmount += 1; rows[0].totalAmount += 1; }],
    ["non-canonical uuid", (rows: RawRecord[]) => { rows[0].externalId = rows[0].externalId.toUpperCase(); }],
    ["padded uuid", (rows: RawRecord[]) => { rows[0].externalId = ` ${rows[0].externalId}`; }],
    ["component overflow", (rows: RawRecord[]) => { rows[36].depositAmount = 2_147_483_647; rows[36].balanceAmount = 1; }],
    ["root category overflow", (rows: RawRecord[]) => { rows[0].name = "根".repeat(61); }],
  ])("returns one fixed non-PII validation error for %s", (_label, mutate) => {
    const rows = syntheticRawRecords();
    mutate(rows);
    expect(() => parseNormalizedNotionBudgetJson(JSON.stringify(rows))).toThrow(
      new NotionBudgetValidationError("匯入資料驗證失敗。"),
    );
  });
});

describe("Notion Budget manifest and import", () => {
  it("requires matching input bytes and the exact anonymous aggregate baseline", () => {
    const json = inputJson();
    const records = parseNormalizedNotionBudgetJson(json);
    expect(
      parseAndValidateNotionBudgetManifestJson(
        manifestJson(json, records),
        Buffer.from(json),
        records,
      ),
    ).toMatchObject({ recordCount: 37, rootRollupTotal: 853185 });

    const badManifest = JSON.parse(manifestJson(json, records));
    badManifest.inputSha256 = "0".repeat(64);
    expect(() =>
      parseAndValidateNotionBudgetManifestJson(
        JSON.stringify(badManifest),
        Buffer.from(json),
        records,
      ),
    ).toThrow(new NotionBudgetImportError("匿名 manifest 與匯入資料不符。"));
  });

  it("is dry-run by default, applies atomically, and reruns as unchanged", async () => {
    const records = parseNormalizedNotionBudgetJson(inputJson());
    const { client, store } = fakeClient();

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
      }),
    ).resolves.toMatchObject({
      mode: "dry-run",
      applied: false,
      input: 37,
      create: 37,
      unchanged: 0,
      conflict: 0,
    });
    expect(store.items).toHaveLength(0);

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ applied: true, create: 37, conflict: 0 });
    expect(store.items).toHaveLength(37);
    expect(store.items.filter((item) => item.parentId === null)).toHaveLength(0);
    expect(
      records
        .filter((record) => record.parentExternalId === null)
        .map(
          (record) =>
            store.items.find((item) => item.externalId === record.externalId)
              ?.parentId,
        ),
    ).toEqual([
      "fixed_INTERNAL_UNCLASSIFIED_ITEM",
      "fixed_INTERNAL_UNCLASSIFIED_ITEM",
      "fixed_INTERNAL_UNCLASSIFIED_ITEM",
    ]);

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({
      applied: true,
      create: 0,
      unchanged: 37,
      conflict: 0,
    });
    expect(store.items).toHaveLength(37);
  });

  it.each([
    ["v2", "previousSourceHash"],
    ["v1", "legacySourceHash"],
  ] as const)(
    "accepts a %s source hash only when the current v3 projection and source path still match",
    async (_version, hashField) => {
      const records = parseNormalizedNotionBudgetJson(inputJson());
      const { client, store } = fakeClient();
      await importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      });

      const recordsByExternalId = new Map(
        records.map((record) => [record.externalId, record]),
      );
      store.items.forEach((item) => {
        if (!item.externalId) {
          throw new Error("Synthetic imported identity is missing.");
        }
        const record = recordsByExternalId.get(item.externalId);
        if (!record) throw new Error("Synthetic imported record is missing.");
        item.sourceHash = record[hashField];
      });

      await expect(
        importNotionBudgetRecords({
          client,
          workspaceId: "synthetic_workspace",
          records,
          apply: false,
        }),
      ).resolves.toMatchObject({
        applied: false,
        create: 0,
        unchanged: 37,
        conflict: 0,
      });

      store.items[0].sourceHierarchyPath = [];
      await expect(
        importNotionBudgetRecords({
          client,
          workspaceId: "synthetic_workspace",
          records,
          apply: false,
        }),
      ).resolves.toMatchObject({
        applied: false,
        create: 0,
        unchanged: 0,
        conflict: 1,
      });
    },
  );

  it("uses a compatible Drive item label while transport and unknown roots stay internal", async () => {
    const rows = syntheticRawRecords();
    rows[0].name = "婚禮攝影";
    rows[1].name = "交通與住宿";
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const snapshots = records.map((record) => ({
      category: record.category,
      sourceHash: record.sourceHash,
    }));
    const { client, store } = fakeClient();

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ applied: true, create: 37, conflict: 0 });

    expect(
      records
        .filter((record) => record.parentExternalId === null)
        .map(
          (record) =>
            store.items.find((item) => item.externalId === record.externalId)
              ?.parentId,
        ),
    ).toEqual([
      "fixed_ITEM_WEDDING_PHOTOGRAPHY",
      "fixed_INTERNAL_UNCLASSIFIED_ITEM",
      "fixed_INTERNAL_UNCLASSIFIED_ITEM",
    ]);
    expect(records[0].category).toBe("PHOTOGRAPHY_VIDEO");
    expect(records[1].category).toBe("TRANSPORT_LODGING");
    expect(
      records.map((record) => ({
        category: record.category,
        sourceHash: record.sourceHash,
      })),
    ).toEqual(snapshots);
  });

  it("keeps every photo-shoot descendant in the single Drive photo-shoot item", async () => {
    const rows = syntheticRawRecords();
    rows[0].name = "婚紗拍攝";
    rows[3].name = "租婚紗";
    rows[4].name = "租西裝";
    rows[5].name = "拍攝造型費";
    rows[11].name = "拍攝用小白鞋";
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const { client, store } = fakeClient();

    expect(records[0]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });
    expect(records[3]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });
    expect(records[4]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });
    expect(records[5]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });
    expect(records[10]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });
    expect(records[11]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ applied: true, create: 37, conflict: 0 });

    const storedByExternalId = new Map(
      store.items.map((item) => [item.externalId, item]),
    );
    expect(storedByExternalId.get(syntheticUuid(0))?.parentId).toBe(
      "fixed_ITEM_PRE_WEDDING_PHOTOGRAPHY",
    );
    expect(storedByExternalId.get(syntheticUuid(3))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(0))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(4))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(0))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(5))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(0))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(10))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(3))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(11))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(3))?.id,
    );
    expect(
      storedByExternalId.get(syntheticUuid(3))?.relatedTaxonomyItemKey,
    ).toBeNull();
    expect(
      storedByExternalId.get(syntheticUuid(10))?.relatedTaxonomyItemKey,
    ).toBeNull();
    expect(
      storedByExternalId.get(syntheticUuid(11))?.relatedTaxonomyItemKey,
    ).toBeNull();

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({
      applied: true,
      create: 0,
      unchanged: 37,
      conflict: 0,
    });
  });

  it("preserves an anonymous Notion photo-extension path while Drive remains the only primary tree", async () => {
    const rows = syntheticRawRecords();
    rows[0].name = "婚紗拍攝";
    rows[3].name = "其他";
    rows[11].name = "合成姓名的小白鞋";

    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const { client, store } = fakeClient();

    expect(records[3]).toMatchObject({
      sourceHierarchyPath: ["婚紗拍攝", "其他"],
    });
    expect(records[11]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
      sourceHierarchyPath: [
        "婚紗拍攝",
        "其他",
        "合成姓名的小白鞋",
      ],
    });

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ applied: true, create: 37, conflict: 0 });

    const storedByExternalId = new Map(
      store.items.map((item) => [item.externalId, item]),
    );
    const photoRoot = storedByExternalId.get(syntheticUuid(0));
    const sourceContainer = storedByExternalId.get(syntheticUuid(3));
    const shoes = storedByExternalId.get(syntheticUuid(11));
    expect(photoRoot?.parentId).toBe(
      "fixed_ITEM_PRE_WEDDING_PHOTOGRAPHY",
    );
    expect(sourceContainer?.parentId).toBe(photoRoot?.id);
    expect(shoes).toMatchObject({
      parentId: sourceContainer?.id,
      relatedTaxonomyItemKey: null,
      sourceHierarchyPath: [
        "婚紗拍攝",
        "其他",
        "合成姓名的小白鞋",
      ],
    });

    if (shoes) shoes.sourceHierarchyPath = [];
    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: false,
      }),
    ).resolves.toMatchObject({
      applied: false,
      create: 0,
      unchanged: 0,
      conflict: 1,
    });
  });

  it("keeps props and media-looking labels inside the photo-shoot source tree", async () => {
    const rows = syntheticRawRecords();
    rows[0].name = "婚紗拍攝";
    rows[3].name = "婚禮拍攝小物";
    rows[10].name = "合成拍攝小物葉節點";
    rows[4].name = "婚禮攝影廠商";
    rows[13].name = "動態";
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const { client, store } = fakeClient();

    expect(records[3]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });
    expect(records[10]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });
    expect(records[4]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });
    expect(records[13]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });

    await importNotionBudgetRecords({
      client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });

    const storedByExternalId = new Map(
      store.items.map((item) => [item.externalId, item]),
    );
    expect(storedByExternalId.get(syntheticUuid(3))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(0))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(10))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(3))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(4))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(0))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(13))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(4))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(13))?.parentId).not.toBe(
      "fixed_ITEM_WEDDING_VIDEOGRAPHY",
    );
  });

  it("routes evidence-backed reception branches and keeps unmapped costs pending", async () => {
    const rows = syntheticRawRecords();
    rows[1].name = "宴客";
    rows[6].name = "宴客場地";
    rows[19].name = "拍拍印";
    rows[20].name = "宴客婚紗廠商";
    rows[21].name = "新娘秘書";
    rows[7].name = "婚禮攝影廠商";
    rows[22].name = "平面";
    rows[23].name = "動態";
    rows[24].name = "婚禮小物";
    rows[34].name = "婚禮主持人";
    rows[35].name = "喜餅";
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const { client, store } = fakeClient();

    expect(records[1]).toMatchObject({
      category: "OTHER_PENDING",
      relatedTaxonomyItemKey: null,
    });
    expect(records[6].category).toBe("VENUE_CATERING");
    expect(records[19].category).toBe("PEOPLE_SERVICES");
    expect(records[20].category).toBe("ATTIRE_STYLING");
    expect(records[21].category).toBe("ATTIRE_STYLING");
    expect(records[7].category).toBe("PHOTOGRAPHY_VIDEO");
    expect(records[22].category).toBe("PHOTOGRAPHY_VIDEO");
    expect(records[23].category).toBe("PHOTOGRAPHY_VIDEO");
    expect(records[24].category).toBe("DECOR_GIFTS");
    expect(records[34].category).toBe("PEOPLE_SERVICES");
    expect(records[35].category).toBe("DECOR_GIFTS");

    await importNotionBudgetRecords({
      client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });

    const storedByExternalId = new Map(
      store.items.map((item) => [item.externalId, item]),
    );
    expect(storedByExternalId.get(syntheticUuid(1))?.parentId).toBe(
      "fixed_INTERNAL_UNCLASSIFIED_ITEM",
    );
    expect(storedByExternalId.get(syntheticUuid(6))?.parentId).toBe(
      "fixed_ITEM_WEDDING_VENUE",
    );
    expect(storedByExternalId.get(syntheticUuid(19))?.parentId).toBe(
      "fixed_ITEM_WEDDING_INTERACTION",
    );
    expect(storedByExternalId.get(syntheticUuid(20))?.parentId).toBe(
      "fixed_ITEM_ATTIRE_RENTAL",
    );
    expect(storedByExternalId.get(syntheticUuid(21))?.parentId).toBe(
      "fixed_ITEM_BRIDAL_STYLIST",
    );
    expect(storedByExternalId.get(syntheticUuid(7))?.parentId).toBe(
      "fixed_ITEM_WEDDING_PHOTOGRAPHY",
    );
    expect(storedByExternalId.get(syntheticUuid(22))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(7))?.id,
    );
    expect(storedByExternalId.get(syntheticUuid(23))?.parentId).toBe(
      "fixed_ITEM_WEDDING_VIDEOGRAPHY",
    );
    expect(storedByExternalId.get(syntheticUuid(24))?.parentId).toBe(
      "fixed_ITEM_WEDDING_FAVORS",
    );
    expect(storedByExternalId.get(syntheticUuid(34))?.parentId).toBe(
      "fixed_ITEM_WEDDING_HOST",
    );
    expect(storedByExternalId.get(syntheticUuid(35))?.parentId).toBe(
      "fixed_ITEM_WEDDING_CAKES",
    );

    const mixedRows = syntheticRawRecords();
    mixedRows[1].name = "宴客";
    mixedRows[6].name = "婚禮工作人員紅包";
    mixedRows[7].name = "婚宴場地";
    mixedRows[19].name = "印卡讚";
    const mixedRecords = parseNormalizedNotionBudgetJson(inputJson(mixedRows));
    const mixedClient = fakeClient();
    await importNotionBudgetRecords({
      client: mixedClient.client,
      workspaceId: "synthetic_workspace",
      records: mixedRecords,
      apply: true,
    });
    expect(mixedRecords[6]).toMatchObject({
      category: "OTHER_PENDING",
      relatedTaxonomyItemKey: null,
    });
    expect(mixedRecords[7]).toMatchObject({
      category: "OTHER_PENDING",
      relatedTaxonomyItemKey: null,
    });
    expect(mixedRecords[19]).toMatchObject({
      category: "PEOPLE_SERVICES",
      relatedTaxonomyItemKey: null,
    });
    expect(
      mixedClient.store.items.find(
        (item) => item.externalId === syntheticUuid(6),
      )?.parentId,
    ).toBe(
      mixedClient.store.items.find(
        (item) => item.externalId === syntheticUuid(1),
      )?.id,
    );
    expect(
      mixedClient.store.items.find(
        (item) => item.externalId === syntheticUuid(7),
      )?.parentId,
    ).toBe(
      mixedClient.store.items.find(
        (item) => item.externalId === syntheticUuid(1),
      )?.id,
    );
    expect(
      mixedClient.store.items.find(
        (item) => item.externalId === syntheticUuid(19),
      )?.parentId,
    ).toBe("fixed_ITEM_WEDDING_INTERACTION");
  });

  it.each([
    "婚戒",
    "婚戒(求婚戒與對戒)",
    "婚戒（求婚戒與對戒）",
  ])("places a Notion %s root below the Drive proposal item", async (rootName) => {
    const rows = syntheticRawRecords();
    rows[0].name = rootName;
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const { client, store } = fakeClient();

    expect(records[0].category).toBe("RINGS_KEEPSAKES");
    expect(records[3].category).toBe("RINGS_KEEPSAKES");

    await importNotionBudgetRecords({
      client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });

    const storedByExternalId = new Map(
      store.items.map((item) => [item.externalId, item]),
    );
    expect(storedByExternalId.get(syntheticUuid(0))?.parentId).toBe(
      "fixed_ITEM_PROPOSAL",
    );
    expect(storedByExternalId.get(syntheticUuid(3))?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(0))?.id,
    );
  });

  it("keeps a hair-styling suffix under the photo branch", async () => {
    const rows = syntheticRawRecords();
    rows[0].name = "婚紗拍攝";
    rows[3].name = "其他";
    rows[11].name = "合成姓名髮型整理";
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const { client, store } = fakeClient();

    expect(records[11]).toMatchObject({
      category: "PHOTOGRAPHY_VIDEO",
      relatedTaxonomyItemKey: null,
    });

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ applied: true, create: 37, conflict: 0 });

    const storedByExternalId = new Map(
      store.items.map((item) => [item.externalId, item]),
    );
    const hairStyling = storedByExternalId.get(syntheticUuid(11));
    expect(hairStyling?.parentId).toBe(
      storedByExternalId.get(syntheticUuid(3))?.id,
    );
    expect(hairStyling?.relatedTaxonomyItemKey).toBeNull();
  });

  it("keeps every active Notion node under an explicit Drive or pending item", async () => {
    const rows = syntheticRawRecords();
    const activeParentIndexes: Array<number | null> = [
      null,
      null,
      null,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      3,
      6,
      6,
      8,
      2,
      15,
      15,
      2,
      18,
      18,
      18,
      18,
      18,
      18,
      2,
      2,
      2,
      2,
      2,
      27,
      30,
      28,
      2,
      2,
      2,
      2,
    ];
    activeParentIndexes.forEach((parentIndex, index) => {
      rows[index].parentExternalId =
        parentIndex === null ? null : syntheticUuid(parentIndex);
    });
    rows[0].name = "婚戒(求婚戒與對戒)";
    rows[1].name = "宴客";
    rows[2].name = "婚紗拍攝";
    rows[3].name = "宴客場地";
    rows[4].name = "宴客婚紗廠商";
    rows[5].name = "新娘秘書";
    rows[6].name = "婚禮攝影廠商";
    rows[7].name = "婚禮主持人";
    rows[8].name = "喜餅";
    rows[9].name = "拍拍印";
    rows[10].name = "新娘秘書";
    rows[12].name = "平面";
    rows[13].name = "動態";
    rows[15].name = "租婚紗";
    rows[18].name = "婚禮拍攝小物";
    rows[25].name = "拍攝用小白鞋";
    rows[26].name = "合成姓名髮型整理";
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      rows[index].rollupAmount = rows
        .filter(
          (candidate) =>
            candidate.parentExternalId === rows[index].externalId,
        )
        .reduce((sum, child) => sum + child.totalAmount, 0);
      rows[index].totalAmount =
        (rows[index].depositAmount ?? 0) +
        (rows[index].balanceAmount ?? 0) +
        (rows[index].additionalAmount ?? 0) +
        rows[index].rollupAmount;
    }
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const { client, store } = fakeClient();

    expect(
      records
        .filter((record) => record.category === "OTHER_PENDING")
        .map((record) => record.sourceOrder),
    ).toEqual([1]);

    await importNotionBudgetRecords({
      client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });

    const storedById = new Map(store.items.map((item) => [item.id, item]));
    const fixedAncestorIds = store.items
      .filter((item) => item.source === "NOTION")
      .map((item) => {
        let parentId = item.parentId;
        const visited = new Set<string>();
        while (parentId && !parentId.startsWith("fixed_")) {
          expect(visited.has(parentId)).toBe(false);
          visited.add(parentId);
          parentId = storedById.get(parentId)?.parentId ?? null;
        }
        return parentId;
      });
    expect(fixedAncestorIds).toHaveLength(37);
    expect(fixedAncestorIds).toContain(
      "fixed_INTERNAL_UNCLASSIFIED_ITEM",
    );
    expect(
      fixedAncestorIds.every(
        (id) =>
          id?.startsWith("fixed_ITEM_") ||
          id === "fixed_INTERNAL_UNCLASSIFIED_ITEM",
      ),
    ).toBe(true);
    const primaryCounts = fixedAncestorIds.reduce<Record<string, number>>(
      (counts, id) => {
        const key = String(id).slice("fixed_".length);
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(primaryCounts).toEqual({
      ITEM_PROPOSAL: 1,
      INTERNAL_UNCLASSIFIED_ITEM: 1,
      ITEM_WEDDING_VENUE: 2,
      ITEM_ATTIRE_RENTAL: 1,
      ITEM_BRIDAL_STYLIST: 2,
      ITEM_WEDDING_PHOTOGRAPHY: 2,
      ITEM_WEDDING_HOST: 1,
      ITEM_WEDDING_CAKES: 2,
      ITEM_WEDDING_INTERACTION: 1,
      ITEM_WEDDING_VIDEOGRAPHY: 1,
      ITEM_PRE_WEDDING_PHOTOGRAPHY: 23,
    });
    expect(
      store.items.filter(
        (item) =>
          item.relatedTaxonomyItemKey ===
          "ITEM_PRE_WEDDING_PHOTOGRAPHY",
      ),
    ).toHaveLength(0);
  });

  it("keeps an exact item label internal when its preserved snapshot category is incompatible", async () => {
    const rows = syntheticRawRecords();
    rows[0].name = "喜餅";
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const rootHash = records[0].sourceHash;
    const { client, store } = fakeClient();

    await importNotionBudgetRecords({
      client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });

    expect(records[0]).toMatchObject({
      category: "OTHER_PENDING",
      sourceHash: rootHash,
    });
    expect(
      store.items.find((item) => item.externalId === syntheticUuid(0))
        ?.parentId,
    ).toBe("fixed_INTERNAL_UNCLASSIFIED_ITEM");
    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({
      applied: true,
      create: 0,
      unchanged: 37,
      conflict: 0,
    });
  });

  it("accepts a legacy venue snapshot after migration reparents its former root", async () => {
    const rows = syntheticRawRecords();
    rows[0].name = "場地與餐飲";
    const records = parseNormalizedNotionBudgetJson(inputJson(rows));
    const seeded = fakeClient();
    await importNotionBudgetRecords({
      client: seeded.client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });

    const preMigrationRows = cloneItems(seeded.store.items);
    const formerRoot = preMigrationRows.find(
      (item) => item.externalId === syntheticUuid(0),
    );
    expect(formerRoot).toBeDefined();
    formerRoot!.parentId = null;
    const migrated = fakeClient(preMigrationRows);
    const migratedRoot = migrated.store.items.find(
      (item) => item.externalId === syntheticUuid(0),
    );
    expect(migratedRoot).toMatchObject({
      parentId: null,
      category: "VENUE_CATERING",
    });

    migratedRoot!.parentId = "fixed_ITEM_WEDDING_VENUE";
    await expect(
      importNotionBudgetRecords({
        client: migrated.client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({
      applied: true,
      create: 0,
      unchanged: 37,
      conflict: 0,
    });
    expect(migratedRoot).toMatchObject({
      parentId: "fixed_ITEM_WEDDING_VENUE",
      category: "VENUE_CATERING",
    });
  });

  it("treats a root moved below the wrong fixed item as a whole-snapshot conflict", async () => {
    const records = parseNormalizedNotionBudgetJson(inputJson());
    const { client, store } = fakeClient();
    await importNotionBudgetRecords({
      client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });
    const importedRoot = store.items.find(
      (item) => item.externalId === syntheticUuid(0),
    );
    expect(importedRoot).toBeDefined();
    importedRoot!.parentId = "fixed_ITEM_WEDDING_VENUE";

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({
      applied: false,
      conflict: 1,
      unchanged: 0,
    });
    expect(importedRoot!.parentId).toBe("fixed_ITEM_WEDDING_VENUE");
  });

  it("checks workspace existence inside the same Serializable transaction", async () => {
    const records = parseNormalizedNotionBudgetJson(inputJson());
    const { client, store } = fakeClient([], false, false);

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).rejects.toEqual(
      new NotionBudgetImportError("指定的婚宴工作區不存在。"),
    );
    expect(client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
    expect(store.items).toEqual([]);
  });

  it("never collides with or mutates MANUAL rows", async () => {
    const manual: StoredItem = {
      id: "synthetic_manual_native",
      workspaceId: "synthetic_workspace",
      parentId: null,
      source: "MANUAL",
      externalId: null,
      sourceHash: null,
      name: "合成預算節點 01",
      kind: "EXPENSE",
      category: "OTHER_PENDING",
    };
    const { client, store } = fakeClient([manual]);
    const records = parseNormalizedNotionBudgetJson(inputJson());
    await importNotionBudgetRecords({
      client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });
    expect(store.items).toHaveLength(38);
    expect(store.items[0]).toEqual(manual);
  });

  it("retries a parallel unique/serialization loser and converges to unchanged", async () => {
    const records = parseNormalizedNotionBudgetJson(inputJson());
    const { client, store } = fakeClient();
    await importNotionBudgetRecords({
      client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });
    const transactionImplementation = client.$transaction.getMockImplementation();
    client.$transaction
      .mockRejectedValueOnce({ code: "P2002" })
      .mockImplementation(transactionImplementation!);

    await expect(
      importNotionBudgetRecords({
        client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({
      create: 0,
      unchanged: 37,
      conflict: 0,
      applied: true,
    });
    expect(store.items).toHaveLength(37);
  });

  it("conflicts without writes after source or VowBook projection drift", async () => {
    const records = parseNormalizedNotionBudgetJson(inputJson());
    const { client, store } = fakeClient();
    await importNotionBudgetRecords({ client, workspaceId: "synthetic_workspace", records, apply: true });

    const changedRows = syntheticRawRecords();
    changedRows[10].notes = "合成來源改動";
    const changed = parseNormalizedNotionBudgetJson(JSON.stringify(changedRows));
    await expect(
      importNotionBudgetRecords({ client, workspaceId: "synthetic_workspace", records: changed, apply: true }),
    ).resolves.toMatchObject({ applied: false, conflict: 1, create: 0 });
    expect(store.items).toHaveLength(37);

    store.items[0].name = "VowBook 合成手動編輯";
    await expect(
      importNotionBudgetRecords({ client, workspaceId: "synthetic_workspace", records, apply: true }),
    ).resolves.toMatchObject({ applied: false, conflict: 1 });
    expect(store.items[0].name).toBe("VowBook 合成手動編輯");
  });

  it("treats missing or extra NOTION identities as whole-snapshot conflicts", async () => {
    const records = parseNormalizedNotionBudgetJson(inputJson());
    const missing = fakeClient();
    await importNotionBudgetRecords({
      client: missing.client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });
    missing.store.items.pop();
    const missingSnapshot = cloneItems(missing.store.items);
    await expect(
      importNotionBudgetRecords({
        client: missing.client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ applied: false, create: 0, conflict: 1 });
    expect(missing.store.items).toEqual(missingSnapshot);

    const extra = fakeClient();
    await importNotionBudgetRecords({
      client: extra.client,
      workspaceId: "synthetic_workspace",
      records,
      apply: true,
    });
    extra.store.items.push({
      ...extra.store.items[0],
      id: "synthetic_extra_native",
      externalId: "a0000000-0000-4000-8000-000000000099",
    });
    const extraSnapshot = cloneItems(extra.store.items);
    await expect(
      importNotionBudgetRecords({
        client: extra.client,
        workspaceId: "synthetic_workspace",
        records,
        apply: true,
      }),
    ).resolves.toMatchObject({ applied: false, create: 0, conflict: 1 });
    expect(extra.store.items).toEqual(extraSnapshot);
  });

  it("rolls back all rows when parent resolution fails", async () => {
    const records = parseNormalizedNotionBudgetJson(inputJson());
    const { client, store } = fakeClient([], true);
    await expect(
      importNotionBudgetRecords({ client, workspaceId: "synthetic_workspace", records, apply: true }),
    ).rejects.toEqual(
      new NotionBudgetImportError("匯入交易失敗，沒有寫入任何資料。"),
    );
    expect(store.items).toHaveLength(0);
  });
});

describe("Notion Budget CLI safety", () => {
  const required = [
    "--input",
    "/operator/synthetic-input.json",
    "--manifest",
    "/operator/synthetic-manifest.json",
    "--workspace-id",
    "synthetic_workspace",
    "--confirm-workspace-id",
    "synthetic_workspace",
  ];

  it("rejects unknown, duplicate, user, role, and mismatched workspace flags", () => {
    expect(parseNotionBudgetCliArguments(required)).toMatchObject({ apply: false });
    expect(parseNotionBudgetCliArguments([...required, "--apply"])).toMatchObject({ apply: true });
    for (const argv of [
      [...required, "--apply", "--apply"],
      [...required, "--unknown"],
      [...required, "--user-id", "synthetic_user"],
      [...required, "--role", "OWNER"],
      [...required.slice(0, -1), "different_workspace"],
    ]) {
      expect(() => parseNotionBudgetCliArguments(argv)).toThrow(NotionBudgetImportError);
    }
  });

  it("formats aggregate-only output without identity, paths, or source IDs", () => {
    const output = formatNotionBudgetImportSummary({
      mode: "dry-run",
      applied: false,
      input: 37,
      create: 37,
      unchanged: 0,
      conflict: 0,
      roots: 3,
      parents: 10,
      maximumDepth: 3,
      plannedTotal: "853185",
    });
    expect(output).toBe(
      "mode=dry-run applied=false input=37 create=37 unchanged=0 conflict=0 roots=3 parents=10 max_depth=3 planned_total=853185",
    );
    expect(output).not.toContain("synthetic_workspace");
    expect(output).not.toContain("a0000000-");
    expect(output).not.toContain("/operator/");
  });

  it("rejects repository-resolved paths and non-regular files before reading", async () => {
    const errors: string[] = [];
    const readCheckedFile = vi.fn();
    const repositoryRoot = path.resolve(process.cwd());
    const exitCode = await runNotionBudgetCli(required, {
      databaseUrl: "postgresql://synthetic.invalid/synthetic",
      repositoryRoot,
      resolveRealPath: vi.fn(async (value: string) =>
        value === repositoryRoot
          ? repositoryRoot
          : path.join(repositoryRoot, "synthetic-private.json"),
      ),
      readCheckedFile,
      writeOutput: vi.fn(),
      writeError: (line: string) => errors.push(line),
    });
    expect(exitCode).toBe(1);
    expect(readCheckedFile).not.toHaveBeenCalled();
    expect(errors).toEqual([
      "匯入檔與匿名 manifest 必須位於 repository 外。",
    ]);

    errors.length = 0;
    const nonFileExit = await runNotionBudgetCli(required, {
      databaseUrl: "postgresql://synthetic.invalid/synthetic",
      repositoryRoot,
      resolveRealPath: vi.fn(async (value: string) =>
        value === repositoryRoot ? repositoryRoot : `/operator/${path.basename(value)}`,
      ),
      readCheckedFile: vi.fn(async () => ({ isFile: false, bytes: null })),
      writeOutput: vi.fn(),
      writeError: (line: string) => errors.push(line),
    });
    expect(nonFileExit).toBe(1);
    expect(errors).toEqual(["匯入檔與匿名 manifest 必須是一般檔案。"]);
  });

  it("runs only through injected synthetic bytes and emits safe aggregate output", async () => {
    const json = inputJson();
    const records = parseNormalizedNotionBudgetJson(json);
    const manifest = manifestJson(json, records);
    const { client } = fakeClient();
    const output: string[] = [];
    const errors: string[] = [];
    const repositoryRoot = path.resolve(process.cwd());

    const exitCode = await runNotionBudgetCli(required, {
      databaseUrl: "postgresql://synthetic.invalid/synthetic",
      repositoryRoot,
      resolveRealPath: vi.fn(async (value: string) =>
        value === repositoryRoot ? repositoryRoot : `/operator/${path.basename(value)}`,
      ),
      readCheckedFile: vi.fn(async (value: string) => ({
        isFile: true,
        bytes: Buffer.from(value.includes("manifest") ? manifest : json),
      })),
      createClient: () => client,
      writeOutput: (line: string) => output.push(line),
      writeError: (line: string) => errors.push(line),
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output).toHaveLength(1);
    const aggregates = Object.fromEntries(
      output[0].split(" ").map((entry) => entry.split("=")),
    );
    expect(aggregates).toMatchObject({
      mode: "dry-run",
      applied: "false",
      input: "37",
      create: "37",
      unchanged: "0",
      conflict: "0",
    });
    expect(output[0]).not.toContain("synthetic_workspace");
    expect(output[0]).not.toContain("合成預算節點");
  });

  it("turns raw database failures into one fixed non-PII CLI error", async () => {
    const json = inputJson();
    const records = parseNormalizedNotionBudgetJson(json);
    const manifest = manifestJson(json, records);
    const output: string[] = [];
    const errors: string[] = [];
    const repositoryRoot = path.resolve(process.cwd());
    const client = {
      $transaction: vi.fn(async () => {
        throw new Error("synthetic-contact@example.test /operator/private.json");
      }),
      $disconnect: vi.fn(async () => undefined),
    };

    const exitCode = await runNotionBudgetCli(required, {
      databaseUrl: "postgresql://synthetic.invalid/synthetic",
      repositoryRoot,
      resolveRealPath: vi.fn(async (value: string) =>
        value === repositoryRoot ? repositoryRoot : `/operator/${path.basename(value)}`,
      ),
      readCheckedFile: vi.fn(async (value: string) => ({
        isFile: true,
        bytes: Buffer.from(value.includes("manifest") ? manifest : json),
      })),
      createClient: () => client,
      writeOutput: (line: string) => output.push(line),
      writeError: (line: string) => errors.push(line),
    });

    expect(exitCode).toBe(1);
    expect(output).toEqual([]);
    expect(errors).toEqual(["匯入交易失敗，沒有寫入任何資料。"]);
    expect(errors.join(" ")).not.toContain("synthetic-contact@example.test");
    expect(errors.join(" ")).not.toContain("/operator/");
  });
});
