import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BUDGET_ATTACHMENT_BYTES } from "@/domain/budget-attachment";

const getApiCurrentUser = vi.hoisted(() => vi.fn());
const createBudgetAttachment = vi.hoisted(() => vi.fn());
const assertBudgetAttachmentUploadAccess = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-current-user", () => ({ getApiCurrentUser }));
vi.mock("@/lib/budget-attachments", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/budget-attachments")
  >("@/lib/budget-attachments");
  return {
    ...actual,
    assertBudgetAttachmentUploadAccess,
    createBudgetAttachment,
  };
});

import {
  BudgetAttachmentLimitError,
  BudgetAttachmentPermissionError,
  BudgetAttachmentTargetError,
} from "@/lib/budget-attachments";
import { SerializationConflictError } from "@/lib/serializable-transaction";
import { POST } from "./route";

const context = {
  params: Promise.resolve({
    workspaceId: "workspace_1",
    budgetItemId: "expense_1",
  }),
};

function request(
  origin = "https://example.test",
  contentLength: string | null = "1024",
) {
  const data = Uint8Array.from([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a,
  ]);
  const parsedFormData = {
    get: () => ({
      name: "場地合約.pdf",
      type: "application/pdf",
      arrayBuffer: async () => data.buffer,
    }),
  };
  const headers: Record<string, string> = {
    origin,
    host: "example.test",
  };
  if (contentLength !== null) headers["content-length"] = contentLength;
  const uploadRequest = new Request(
    "https://example.test/VowBook/api/workspaces/workspace_1/budget/expense_1/attachments",
    {
      method: "POST",
      headers,
    },
  );
  Object.defineProperty(uploadRequest, "formData", {
    configurable: true,
    value: vi.fn(async () => parsedFormData),
  });
  return uploadRequest;
}

describe("POST budget attachments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiCurrentUser.mockResolvedValue({ id: "user_1" });
    assertBudgetAttachmentUploadAccess.mockResolvedValue(undefined);
    createBudgetAttachment.mockResolvedValue({
      id: "attachment_1",
      originalName: "場地合約.pdf",
      mediaType: "application/pdf",
      byteSize: 9,
      createdAt: "2026-07-27T08:00:00.000Z",
    });
  });

  it("rejects cross-origin before authentication or parsing", async () => {
    const response = await POST(request("https://evil.test"), context);

    expect(response.status).toBe(403);
    expect(getApiCurrentUser).not.toHaveBeenCalled();
    expect(createBudgetAttachment).not.toHaveBeenCalled();
  });

  it("returns 401 when the session is missing", async () => {
    getApiCurrentUser.mockResolvedValue(null);

    const response = await POST(request(), context);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "請先登入後再試。" });
    expect(createBudgetAttachment).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["malformed", "not-a-number"],
    ["negative", "-1"],
    ["oversized", String(MAX_BUDGET_ATTACHMENT_BYTES + 1024 * 1024 + 1)],
  ])(
    "rejects %s Content-Length before multipart parsing",
    async (_label, contentLength) => {
      const uploadRequest = request("https://example.test", contentLength);
      const formData = vi.mocked(uploadRequest.formData);

      const response = await POST(uploadRequest, context);

      expect(response.status).toBe(413);
      expect(formData).not.toHaveBeenCalled();
      expect(createBudgetAttachment).not.toHaveBeenCalled();
    },
  );

  it("rejects a VIEWER before multipart parsing and returns a generic permission response", async () => {
    assertBudgetAttachmentUploadAccess.mockRejectedValueOnce(
      new BudgetAttachmentPermissionError(),
    );
    const uploadRequest = request();
    const formData = vi.mocked(uploadRequest.formData);

    const response = await POST(uploadRequest, context);

    expect(response.status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
    expect(createBudgetAttachment).not.toHaveBeenCalled();
  });

  it.each([
    [new BudgetAttachmentPermissionError(), 403],
    [new BudgetAttachmentTargetError(), 404],
    [new BudgetAttachmentLimitError("已達附件數量上限。"), 409],
    [new SerializationConflictError(), 409],
  ])("maps safe service errors without exposing resource details", async (error, status) => {
    createBudgetAttachment.mockRejectedValueOnce(error);

    const response = await POST(request(), context);

    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).not.toMatch(
      /workspace_1|expense_1|attachment_1/,
    );
    if (error instanceof SerializationConflictError) {
      expect(body).toEqual({
        error: "同時有其他附件變更，請重新確認後再試。",
      });
    }
  });

  it("returns only created metadata and never the blob", async () => {
    const response = await POST(request(), context);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.attachment).toEqual({
      id: "attachment_1",
      originalName: "場地合約.pdf",
      mediaType: "application/pdf",
      byteSize: 9,
      createdAt: "2026-07-27T08:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("data");
    expect(createBudgetAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        budgetItemId: "expense_1",
        currentUserId: "user_1",
        originalName: "場地合約.pdf",
        mediaType: "application/pdf",
        data: expect.any(Uint8Array),
      }),
    );
    expect(assertBudgetAttachmentUploadAccess).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      budgetItemId: "expense_1",
      currentUserId: "user_1",
    });
  });
});
