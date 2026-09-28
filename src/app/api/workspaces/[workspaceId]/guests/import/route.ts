import { revalidatePath } from "next/cache";
import {
  GuestXlsxImportValidationError,
  type GuestXlsxColumnMapping,
} from "@/domain/guest-xlsx-import";
import { getApiCurrentUser } from "@/lib/api-current-user";
import {
  applyGuestXlsxImport,
  assertGuestXlsxImportAccess,
  GuestXlsxImportConflictError,
  GuestXlsxImportDataError,
  GuestXlsxImportPermissionError,
  previewGuestXlsxImport,
} from "@/lib/guest-xlsx-import";
import {
  GuestXlsxWorkbookError,
  inspectGuestXlsxWorkbook,
  MAX_GUEST_XLSX_FILE_BYTES,
} from "@/lib/guest-xlsx-workbook";
import {
  hasBoundedContentLength,
  isSameOriginMutationRequest,
} from "@/lib/http-request-security";

const MAX_MULTIPART_REQUEST_BYTES = MAX_GUEST_XLSX_FILE_BYTES + 1024 * 1024;
const XLSX_MEDIA_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

type UploadFile = {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function guestImportJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-security-policy":
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorResponse(error: unknown): Response {
  if (
    error instanceof GuestXlsxImportValidationError ||
    error instanceof GuestXlsxWorkbookError
  ) {
    return guestImportJson({ error: error.message }, 400);
  }
  if (error instanceof GuestXlsxImportPermissionError) {
    return guestImportJson({ error: error.message }, 403);
  }
  if (error instanceof GuestXlsxImportConflictError) {
    return guestImportJson({ error: error.message }, 409);
  }
  if (error instanceof GuestXlsxImportDataError) {
    return guestImportJson({ error: error.message }, 500);
  }
  return guestImportJson(
    { error: "目前無法處理賓客 Excel，請稍後再試。" },
    500,
  );
}

function uploadFile(value: FormDataEntryValue | null): UploadFile {
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("type" in value) ||
    typeof value.type !== "string" ||
    !("arrayBuffer" in value) ||
    typeof value.arrayBuffer !== "function" ||
    !/\.xlsx$/iu.test(value.name) ||
    Array.from(value.name).length > 180 ||
    !XLSX_MEDIA_TYPES.has(value.type)
  ) {
    throw new GuestXlsxImportValidationError("請選擇有效的 .xlsx Excel 檔案。");
  }
  return value as UploadFile;
}

async function uploadBytes(file: UploadFile): Promise<Uint8Array> {
  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new GuestXlsxImportValidationError("目前無法讀取選取的 Excel 檔案。");
  }
  if (data.byteLength < 1 || data.byteLength > MAX_GUEST_XLSX_FILE_BYTES) {
    throw new GuestXlsxImportValidationError("Excel 檔案不可超過 5 MiB。");
  }
  return data;
}

function optionalSheetName(value: FormDataEntryValue | null): string | undefined {
  if (value === null || value === "") return undefined;
  if (
    typeof value !== "string" ||
    Array.from(value).length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new GuestXlsxImportValidationError("工作表名稱格式無效。");
  }
  return value;
}

function optionalHeaderRow(value: FormDataEntryValue | null): number | undefined {
  if (value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^(?:[1-9]|1\d|20)$/u.test(value)) {
    throw new GuestXlsxImportValidationError("標題列必須介於第 1 到 20 列。");
  }
  return Number(value);
}

function requiredText(
  value: FormDataEntryValue | null,
  message: string,
  maximum = 2_000,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum
  ) {
    throw new GuestXlsxImportValidationError(message);
  }
  return value;
}

function columnMapping(value: FormDataEntryValue | null): GuestXlsxColumnMapping {
  const json = requiredText(value, "請先完成 Excel 欄位對應。", 2_000);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new GuestXlsxImportValidationError("Excel 欄位對應格式無效。");
  }
  return parsed as GuestXlsxColumnMapping;
}

function guestPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/guests`;
}

function tablesPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/tables`;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!isSameOriginMutationRequest(request)) {
    return guestImportJson({ error: "拒絕跨來源請求。" }, 403);
  }

  try {
    const currentUser = await getApiCurrentUser();
    if (!currentUser) {
      return guestImportJson({ error: "請先登入後再試。" }, 401);
    }
    if (!hasBoundedContentLength(request, MAX_MULTIPART_REQUEST_BYTES)) {
      return guestImportJson(
        { error: "上傳內容缺少有效大小，或已超過 5 MiB Excel 上限。" },
        413,
      );
    }

    const { workspaceId } = await context.params;
    await assertGuestXlsxImportAccess({
      workspaceId,
      currentUserId: currentUser.id,
    });

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new GuestXlsxImportValidationError("上傳表單格式無效。");
    }
    const operation = requiredText(
      formData.get("operation"),
      "匯入操作格式無效。",
      16,
    );
    const file = uploadFile(formData.get("file"));
    const data = await uploadBytes(file);
    const sheetName = optionalSheetName(formData.get("sheetName"));
    const headerRow = optionalHeaderRow(formData.get("headerRow"));

    if (operation === "INSPECT") {
      const inspection = await inspectGuestXlsxWorkbook(data, {
        sheetName,
        headerRow,
      });
      return guestImportJson({ inspection }, 200);
    }

    if (operation !== "PREVIEW" && operation !== "APPLY") {
      throw new GuestXlsxImportValidationError("匯入操作格式無效。");
    }
    if (!sheetName || headerRow === undefined) {
      throw new GuestXlsxImportValidationError("請先選擇工作表與標題列。");
    }
    const mapping = columnMapping(formData.get("mapping"));

    if (operation === "PREVIEW") {
      const preview = await previewGuestXlsxImport({
        workspaceId,
        currentUserId: currentUser.id,
        data,
        sheetName,
        headerRow,
        mapping,
      });
      return guestImportJson({ preview }, 200);
    }

    if (formData.get("preserveExisting") !== "PRESERVE") {
      throw new GuestXlsxImportValidationError(
        "請確認保留未出現在 Excel 裡的賓客與既有座位。",
      );
    }
    const previewToken = requiredText(
      formData.get("previewToken"),
      "匯入預覽已失效，請重新預覽後再試。",
    );
    const result = await applyGuestXlsxImport({
      workspaceId,
      currentUserId: currentUser.id,
      data,
      sheetName,
      headerRow,
      mapping,
      previewToken,
    });
    revalidatePath(guestPath(workspaceId));
    revalidatePath(tablesPath(workspaceId));
    return guestImportJson({ result }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
