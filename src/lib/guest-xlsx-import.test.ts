import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  parseGuestXlsxWorkbook,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  guestImportRecordFindMany,
  guestCreate,
  guestUpdate,
  importRecordCreate,
  importRecordUpdate,
  batchFindFirst,
  batchCreate,
  batchUpdate,
  batchRowUpsert,
  runSerializableTransaction,
} = vi.hoisted(() => ({
  parseGuestXlsxWorkbook: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  guestImportRecordFindMany: vi.fn(),
  guestCreate: vi.fn(),
  guestUpdate: vi.fn(),
  importRecordCreate: vi.fn(),
  importRecordUpdate: vi.fn(),
  batchFindFirst: vi.fn(),
  batchCreate: vi.fn(),
  batchUpdate: vi.fn(),
  batchRowUpsert: vi.fn(),
  runSerializableTransaction: vi.fn(),
}));

vi.mock("@/lib/guest-xlsx-workbook", () => ({
  parseGuestXlsxWorkbook,
}));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/serializable-transaction", () => ({
  runSerializableTransaction,
  SerializationConflictError: class SerializationConflictError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestImportRecord: { findMany: guestImportRecordFindMany },
  },
}));

import {
  applyGuestXlsxImport,
  GuestXlsxImportConflictError,
  GuestXlsxImportPermissionError,
  previewGuestXlsxImport,
} from "./guest-xlsx-import";

const data = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
const mapping = {
  externalId: 0,
  name: 1,
  side: 2,
  attendanceStatus: 3,
  partySize: 4,
} as const;
const workbookOptions = {
  data,
  sheetName: "Survey",
  headerRow: 1,
  mapping,
};
const signingSecret = "synthetic-signing-secret-with-enough-entropy";
const now = new Date("2026-08-15T10:00:00.000Z");

const existingUnchanged = {
  id: "record_a",
  guestId: "guest_a",
  workspaceId: "workspace_1",
  externalId: "opaque-a",
  sourceInstance: "default",
  sourceLabel: "拍拍印",
  sourceManaged: true,
  managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
  sourcePartySize: 2,
  guest: {
    id: "guest_a",
    workspaceId: "workspace_1",
    name: "合成甲",
    side: "PARTNER_A",
    attendanceStatus: "ATTENDING",
    partySize: 5,
    version: 3,
    seatingTableId: "table_1",
  },
};

const existingUpdate = {
  ...existingUnchanged,
  id: "record_b",
  guestId: "guest_b",
  externalId: "opaque-b",
  sourcePartySize: 1,
  guest: {
    ...existingUnchanged.guest,
    id: "guest_b",
    name: "舊姓名",
    side: "PARTNER_B",
    partySize: 4,
    version: 7,
    seatingTableId: null,
  },
};

function parsedRows() {
  return {
    sheetName: "Survey",
    headerRow: 1,
    headers: ["id", "name", "side", "attendance", "partySize"],
    inputSha256: "a".repeat(64),
    rows: [
      {
        rowNumber: 2,
        externalId: "opaque-a",
        name: "合成甲",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: 2,
      },
      {
        rowNumber: 3,
        externalId: "opaque-b",
        name: "合成乙",
        side: "PARTNER_B",
        attendanceStatus: "ATTENDING",
        partySize: 3,
      },
      {
        rowNumber: 4,
        externalId: "opaque-c",
        name: "合成丙",
        side: "SHARED",
        attendanceStatus: "UNDECIDED",
        partySize: 1,
      },
    ],
  };
}

const transaction = {
  guestImportRecord: {
    findMany: guestImportRecordFindMany,
    create: importRecordCreate,
    update: importRecordUpdate,
  },
  guest: { create: guestCreate, update: guestUpdate },
  guestImportBatch: {
    findFirst: batchFindFirst,
    create: batchCreate,
    update: batchUpdate,
  },
  guestImportBatchRow: { upsert: batchRowUpsert },
};

describe("guest XLSX import service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue("OWNER");
    parseGuestXlsxWorkbook.mockResolvedValue(parsedRows());
    guestImportRecordFindMany.mockResolvedValue([
      existingUnchanged,
      existingUpdate,
    ]);
    guestCreate.mockResolvedValue({ id: "guest_c" });
    importRecordCreate.mockResolvedValue({ id: "record_c" });
    batchFindFirst.mockResolvedValue(null);
    batchCreate.mockResolvedValue({ id: "batch_1" });
    batchUpdate.mockResolvedValue({ id: "batch_1" });
    batchRowUpsert.mockResolvedValue({ id: "row_1" });
    runSerializableTransaction.mockImplementation(
      async (operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
    );
  });

  it("previews create/update/unchanged only after OWNER authorization", async () => {
    const preview = await previewGuestXlsxImport({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      ...workbookOptions,
      signingSecret,
      now,
    });

    expect(preview.summary).toEqual({
      input: 3,
      create: 1,
      update: 1,
      unchanged: 1,
      conflict: 0,
      existingSourceCount: 2,
      matchedExistingCount: 2,
      attendingGroups: 2,
      attendingPartySize: 5,
    });
    expect(preview.rows).toEqual([
      { rowNumber: 2, name: "合成甲", action: "UNCHANGED" },
      { rowNumber: 3, name: "合成乙", action: "UPDATE" },
      { rowNumber: 4, name: "合成丙", action: "CREATE" },
    ]);
    expect(preview.previewToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "user_1",
      "manageMembers",
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      parseGuestXlsxWorkbook.mock.invocationCallOrder[0],
    );
    expect(parseGuestXlsxWorkbook.mock.invocationCallOrder[0]).toBeLessThan(
      guestImportRecordFindMany.mock.invocationCallOrder[0],
    );
  });

  it("sanitizes non-OWNER denial before reading the workbook", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      previewGuestXlsxImport({
        workspaceId: "workspace_1",
        currentUserId: "viewer_1",
        ...workbookOptions,
        signingSecret,
        now,
      }),
    ).rejects.toBeInstanceOf(GuestXlsxImportPermissionError);
    expect(parseGuestXlsxWorkbook).not.toHaveBeenCalled();
    expect(guestImportRecordFindMany).not.toHaveBeenCalled();
  });

  it("blocks a likely wrong external-ID mapping when none match existing LINEIN rows", async () => {
    guestImportRecordFindMany.mockResolvedValue([
      existingUnchanged,
      existingUpdate,
    ]);
    parseGuestXlsxWorkbook.mockResolvedValue({
      ...parsedRows(),
      rows: parsedRows().rows.map((row, index) => ({
        ...row,
        externalId: `wrong-${index}`,
      })),
    });

    const preview = await previewGuestXlsxImport({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      ...workbookOptions,
      signingSecret,
      now,
    });
    expect(preview.summary.conflict).toBe(1);
    expect(preview.warning).toContain("沒有任何來源識別碼對應到現有拍拍印資料");
  });

  it("blocks changing a seated guest to declined", async () => {
    parseGuestXlsxWorkbook.mockResolvedValue({
      ...parsedRows(),
      rows: [
        {
          ...parsedRows().rows[0],
          attendanceStatus: "DECLINED",
        },
      ],
    });
    guestImportRecordFindMany.mockResolvedValue([existingUnchanged]);

    const preview = await previewGuestXlsxImport({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      ...workbookOptions,
      signingSecret,
      now,
    });
    expect(preview.summary.conflict).toBe(1);
    expect(preview.rows[0]).toEqual({
      rowNumber: 2,
      name: "合成甲",
      action: "CONFLICT",
      message: "已安排座位，不能直接改為不出席。",
    });
  });

  it("applies the exact preview atomically while preserving notes, seating and operational party size", async () => {
    const preview = await previewGuestXlsxImport({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      ...workbookOptions,
      signingSecret,
      now,
    });
    guestImportRecordFindMany.mockClear();
    guestImportRecordFindMany.mockResolvedValue([
      existingUnchanged,
      existingUpdate,
    ]);

    const result = await applyGuestXlsxImport({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      ...workbookOptions,
      previewToken: preview.previewToken,
      signingSecret,
      now: new Date("2026-08-15T10:05:00.000Z"),
    });

    expect(result).toMatchObject({ applied: true, create: 1, update: 1, unchanged: 1 });
    expect(requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "user_1",
      "manageMembers",
      transaction,
    );
    expect(requireLockedWorkspaceAccess.mock.invocationCallOrder.at(-1)).toBeLessThan(
      guestImportRecordFindMany.mock.invocationCallOrder.at(-1)!,
    );
    expect(guestUpdate).toHaveBeenCalledWith({
      where: {
        id_workspaceId: { id: "guest_b", workspaceId: "workspace_1" },
      },
      data: {
        name: "合成乙",
        side: "PARTNER_B",
        attendanceStatus: "ATTENDING",
        version: { increment: 1 },
      },
    });
    expect(guestUpdate.mock.calls[0][0].data).not.toHaveProperty("partySize");
    expect(guestUpdate.mock.calls[0][0].data).not.toHaveProperty("notes");
    expect(guestUpdate.mock.calls[0][0].data).not.toHaveProperty("seatingTableId");
    expect(guestCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        name: "合成丙",
        side: "SHARED",
        attendanceStatus: "UNDECIDED",
        partySize: 1,
      },
      select: { id: true },
    });
    expect(batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "batch_1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
          totalRows: 3,
          succeededRows: 2,
          skippedRows: 1,
          conflictRows: 0,
        }),
      }),
    );
  });

  it("rejects expired or stale previews before any write", async () => {
    const preview = await previewGuestXlsxImport({
      workspaceId: "workspace_1",
      currentUserId: "user_1",
      ...workbookOptions,
      signingSecret,
      now,
    });
    batchCreate.mockClear();
    guestCreate.mockClear();

    await expect(
      applyGuestXlsxImport({
        workspaceId: "workspace_1",
        currentUserId: "user_1",
        ...workbookOptions,
        previewToken: preview.previewToken,
        signingSecret,
        now: new Date("2026-08-15T10:20:01.000Z"),
      }),
    ).rejects.toBeInstanceOf(GuestXlsxImportConflictError);
    expect(runSerializableTransaction).not.toHaveBeenCalled();
    expect(guestCreate).not.toHaveBeenCalled();
    expect(batchCreate).not.toHaveBeenCalled();
  });
});
