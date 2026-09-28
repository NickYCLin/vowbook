import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestXlsxImportValidationError } from "@/domain/guest-xlsx-import";

const {
  getApiCurrentUser,
  assertGuestXlsxImportAccess,
  inspectGuestXlsxWorkbook,
  previewGuestXlsxImport,
  applyGuestXlsxImport,
  revalidatePath,
} = vi.hoisted(() => ({
  getApiCurrentUser: vi.fn(),
  assertGuestXlsxImportAccess: vi.fn(),
  inspectGuestXlsxWorkbook: vi.fn(),
  previewGuestXlsxImport: vi.fn(),
  applyGuestXlsxImport: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/api-current-user", () => ({ getApiCurrentUser }));
vi.mock("@/lib/guest-xlsx-workbook", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/guest-xlsx-workbook")
  >("@/lib/guest-xlsx-workbook");
  return { ...actual, inspectGuestXlsxWorkbook };
});
vi.mock("@/lib/guest-xlsx-import", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/guest-xlsx-import")
  >("@/lib/guest-xlsx-import");
  return {
    ...actual,
    assertGuestXlsxImportAccess,
    previewGuestXlsxImport,
    applyGuestXlsxImport,
  };
});
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  GuestXlsxImportConflictError,
  GuestXlsxImportPermissionError,
} from "@/lib/guest-xlsx-import";
import { MAX_GUEST_XLSX_FILE_BYTES } from "@/lib/guest-xlsx-workbook";
import { POST } from "./route";

const context = {
  params: Promise.resolve({ workspaceId: "workspace_1" }),
};
const xlsxBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);

function uploadFile(name = "Survey.xlsx", type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  return {
    name,
    type,
    arrayBuffer: async () => xlsxBytes.buffer,
  };
}

function request(
  values: Record<string, unknown>,
  options: {
    origin?: string;
    contentLength?: string | null;
  } = {},
) {
  const headers: Record<string, string> = {
    origin: options.origin ?? "https://example.test",
    host: "example.test",
  };
  if (options.contentLength !== null) {
    headers["content-length"] = options.contentLength ?? "1024";
  }
  const formData = {
    get: (name: string) => values[name] ?? null,
    has: (name: string) => Object.hasOwn(values, name),
  };
  const uploadRequest = new Request(
    "https://example.test/VowBook/api/workspaces/workspace_1/guests/import",
    { method: "POST", headers },
  );
  Object.defineProperty(uploadRequest, "formData", {
    configurable: true,
    value: vi.fn(async () => formData),
  });
  return uploadRequest;
}

describe("POST guest XLSX import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiCurrentUser.mockResolvedValue({ id: "owner_1" });
    assertGuestXlsxImportAccess.mockResolvedValue(undefined);
    inspectGuestXlsxWorkbook.mockResolvedValue({
      sheetNames: ["Survey"],
      sheetName: "Survey",
      headerRow: 1,
      headers: ["id", "name", "side", "attendance", "partySize"],
      rowCount: 36,
      suggestedMapping: {
        externalId: 0,
        name: 1,
        side: 2,
        attendanceStatus: 3,
        partySize: 4,
      },
    });
    previewGuestXlsxImport.mockResolvedValue({
      summary: {
        input: 36,
        create: 2,
        update: 0,
        unchanged: 34,
        conflict: 0,
        existingSourceCount: 34,
        matchedExistingCount: 34,
        attendingGroups: 33,
        attendingPartySize: 76,
      },
      rows: [],
      rowsTruncated: false,
      previewToken: "preview.token",
      expiresAt: "2026-08-15T10:15:00.000Z",
    });
    applyGuestXlsxImport.mockResolvedValue({
      applied: true,
      input: 36,
      create: 2,
      update: 0,
      unchanged: 34,
      conflict: 0,
      existingSourceCount: 34,
      matchedExistingCount: 34,
      attendingGroups: 33,
      attendingPartySize: 76,
    });
  });

  it("rejects cross-origin before authentication or multipart parsing", async () => {
    const uploadRequest = request(
      { operation: "INSPECT", file: uploadFile() },
      { origin: "https://evil.test" },
    );
    const response = await POST(uploadRequest, context);
    expect(response.status).toBe(403);
    expect(getApiCurrentUser).not.toHaveBeenCalled();
    expect(uploadRequest.formData).not.toHaveBeenCalled();
  });

  it("requires a session and bounded request size", async () => {
    getApiCurrentUser.mockResolvedValueOnce(null);
    const unauthenticated = request({ operation: "INSPECT", file: uploadFile() });
    expect((await POST(unauthenticated, context)).status).toBe(401);
    expect(unauthenticated.formData).not.toHaveBeenCalled();

    const oversized = request(
      { operation: "INSPECT", file: uploadFile() },
      { contentLength: String(MAX_GUEST_XLSX_FILE_BYTES + 1024 * 1024 + 1) },
    );
    expect((await POST(oversized, context)).status).toBe(413);
    expect(oversized.formData).not.toHaveBeenCalled();
  });

  it("checks OWNER access before parsing multipart data", async () => {
    assertGuestXlsxImportAccess.mockRejectedValueOnce(
      new GuestXlsxImportPermissionError(),
    );
    const uploadRequest = request({ operation: "INSPECT", file: uploadFile() });
    const response = await POST(uploadRequest, context);
    expect(response.status).toBe(403);
    expect(uploadRequest.formData).not.toHaveBeenCalled();
    expect(inspectGuestXlsxWorkbook).not.toHaveBeenCalled();
  });

  it("inspects valid XLSX metadata without returning workbook rows", async () => {
    const response = await POST(
      request({ operation: "INSPECT", file: uploadFile() }),
      context,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.inspection.rowCount).toBe(36);
    expect(body.inspection).not.toHaveProperty("rows");
    expect(inspectGuestXlsxWorkbook).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      { sheetName: undefined, headerRow: undefined },
    );
  });

  it("previews an explicit column mapping and ignores client identity claims", async () => {
    const response = await POST(
      request({
        operation: "PREVIEW",
        file: uploadFile(),
        sheetName: "Survey",
        headerRow: "1",
        mapping: JSON.stringify({
          externalId: 0,
          name: 1,
          side: 2,
          attendanceStatus: 3,
          partySize: 4,
        }),
        userId: "attacker",
        role: "OWNER",
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(previewGuestXlsxImport).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        currentUserId: "owner_1",
        sheetName: "Survey",
        headerRow: 1,
      }),
    );
    const call = previewGuestXlsxImport.mock.calls[0][0];
    expect(call).not.toHaveProperty("userId");
    expect(call).not.toHaveProperty("role");
  });

  it("requires the preservation confirmation before applying and revalidates both guest views", async () => {
    const baseValues = {
      operation: "APPLY",
      file: uploadFile(),
      sheetName: "Survey",
      headerRow: "1",
      mapping: JSON.stringify({
        externalId: 0,
        name: 1,
        side: 2,
        attendanceStatus: 3,
        partySize: 4,
      }),
      previewToken: "preview.token",
    };
    const missingConfirmation = await POST(request(baseValues), context);
    expect(missingConfirmation.status).toBe(400);
    expect(applyGuestXlsxImport).not.toHaveBeenCalled();

    const response = await POST(
      request({ ...baseValues, preserveExisting: "PRESERVE" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(applyGuestXlsxImport).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        currentUserId: "owner_1",
        previewToken: "preview.token",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/guests",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
  });

  it("rejects non-XLSX names and maps safe validation/conflict errors", async () => {
    const wrongFile = await POST(
      request({ operation: "INSPECT", file: uploadFile("Survey.xls") }),
      context,
    );
    expect(wrongFile.status).toBe(400);
    expect(inspectGuestXlsxWorkbook).not.toHaveBeenCalled();

    inspectGuestXlsxWorkbook.mockRejectedValueOnce(
      new GuestXlsxImportValidationError("固定安全錯誤。"),
    );
    const invalid = await POST(
      request({ operation: "INSPECT", file: uploadFile() }),
      context,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "固定安全錯誤。" });

    previewGuestXlsxImport.mockRejectedValueOnce(
      new GuestXlsxImportConflictError(),
    );
    const conflict = await POST(
      request({
        operation: "PREVIEW",
        file: uploadFile(),
        sheetName: "Survey",
        headerRow: "1",
        mapping: JSON.stringify({
          externalId: 0,
          name: 1,
          side: 2,
          attendanceStatus: 3,
          partySize: 4,
        }),
      }),
      context,
    );
    expect(conflict.status).toBe(409);
  });
});
