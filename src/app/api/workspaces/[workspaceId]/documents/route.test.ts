import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiCurrentUser = vi.hoisted(() => vi.fn());
const createWorkspaceDocument = vi.hoisted(() => vi.fn());
const assertWorkspaceDocumentUploadAccess = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-current-user", () => ({ getApiCurrentUser }));
vi.mock("@/lib/workspace-documents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-documents")>(
    "@/lib/workspace-documents",
  );
  return { ...actual, assertWorkspaceDocumentUploadAccess, createWorkspaceDocument };
});

import {
  WorkspaceDocumentLimitError,
  WorkspaceDocumentPermissionError,
} from "@/lib/workspace-documents";
import { POST } from "./route";

const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };

function request(origin = "https://example.test", contentLength: string | null = "1024") {
  const data = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const fields: Record<string, unknown> = {
    file: { name: "電子喜帖.pdf", type: "application/pdf", arrayBuffer: async () => data.buffer },
    category: "INVITATION",
    title: "電子喜帖定稿",
    notes: "",
  };
  const headers: Record<string, string> = { origin, host: "example.test" };
  if (contentLength !== null) headers["content-length"] = contentLength;
  const upload = new Request("https://example.test/VowBook/api/workspaces/workspace_1/documents", {
    method: "POST",
    headers,
  });
  Object.defineProperty(upload, "formData", {
    configurable: true,
    value: vi.fn(async () => ({ get: (key: string) => fields[key] ?? null })),
  });
  return upload;
}

describe("POST workspace documents route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiCurrentUser.mockResolvedValue({ id: "user_1" });
    assertWorkspaceDocumentUploadAccess.mockResolvedValue(undefined);
    createWorkspaceDocument.mockResolvedValue({ id: "document_1", title: "電子喜帖定稿" });
  });

  it("跨來源請求在驗證身分前就拒絕", async () => {
    const response = await POST(request("https://evil.test"), context);
    expect(response.status).toBe(403);
    expect(getApiCurrentUser).not.toHaveBeenCalled();
  });

  it("未登入回 401", async () => {
    getApiCurrentUser.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(401);
    expect(createWorkspaceDocument).not.toHaveBeenCalled();
  });

  it("缺少或超過大小時不解析內容", async () => {
    expect((await POST(request(undefined, null), context)).status).toBe(413);
    expect((await POST(request(undefined, String(27 * 1024 * 1024)), context)).status).toBe(413);
    expect(assertWorkspaceDocumentUploadAccess).not.toHaveBeenCalled();
  });

  it("先確認可編輯的成員身分，再以伺服器端使用者建立文件", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(assertWorkspaceDocumentUploadAccess).toHaveBeenCalledWith("workspace_1", "user_1");
    expect(createWorkspaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        currentUserId: "user_1",
        originalName: "電子喜帖.pdf",
        category: "INVITATION",
        title: "電子喜帖定稿",
      }),
    );
  });

  it("唯讀成員回 403，容量上限回 409", async () => {
    assertWorkspaceDocumentUploadAccess.mockRejectedValueOnce(new WorkspaceDocumentPermissionError());
    expect((await POST(request(), context)).status).toBe(403);
    createWorkspaceDocument.mockRejectedValueOnce(new WorkspaceDocumentLimitError("滿了"));
    expect((await POST(request(), context)).status).toBe(409);
  });
});
