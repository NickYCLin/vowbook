import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiCurrentUser = vi.hoisted(() => vi.fn());
const getWorkspaceDocumentContent = vi.hoisted(() => vi.fn());
const deleteWorkspaceDocument = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-current-user", () => ({ getApiCurrentUser }));
vi.mock("@/lib/workspace-documents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-documents")>(
    "@/lib/workspace-documents",
  );
  return { ...actual, getWorkspaceDocumentContent, deleteWorkspaceDocument };
});

import { WorkspaceDocumentTargetError } from "@/lib/workspace-documents";
import { DELETE, GET } from "./route";

const context = {
  params: Promise.resolve({ workspaceId: "workspace_1", documentId: "document_1" }),
};
const data = Buffer.from("0123456789");
const sha256 = createHash("sha256").update(data).digest("hex");

function content(mediaType: string, originalName: string) {
  return { originalName, mediaType, byteSize: data.byteLength, sha256, data };
}

describe("GET workspace document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiCurrentUser.mockResolvedValue({ id: "user_1" });
  });

  it("未登入不讀取文件", async () => {
    getApiCurrentUser.mockResolvedValue(null);
    const response = await GET(new Request("https://example.test/doc"), context);
    expect(response.status).toBe(401);
    expect(getWorkspaceDocumentContent).not.toHaveBeenCalled();
  });

  it("非成員或不存在回 404", async () => {
    getWorkspaceDocumentContent.mockRejectedValue(new WorkspaceDocumentTargetError());
    expect((await GET(new Request("https://example.test/doc"), context)).status).toBe(404);
  });

  it("圖片可在沙箱內直接開啟", async () => {
    getWorkspaceDocumentContent.mockResolvedValue(content("image/png", "喜帖.png"));
    const response = await GET(new Request("https://example.test/doc?disposition=inline"), context);
    expect(getWorkspaceDocumentContent).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      documentId: "document_1",
      currentUserId: "user_1",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/u);
    expect(response.headers.get("content-security-policy")).toMatch(/^sandbox;/u);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("Word 合約即使要求直接開啟也只提供下載", async () => {
    getWorkspaceDocumentContent.mockResolvedValue(
      content("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "合約.docx"),
    );
    const response = await GET(new Request("https://example.test/doc?disposition=inline"), context);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/u);
  });

  it("影片支援分段讀取", async () => {
    getWorkspaceDocumentContent.mockResolvedValue(content("video/mp4", "喜帖.mp4"));
    const response = await GET(
      new Request("https://example.test/doc?disposition=inline", { headers: { range: "bytes=2-5" } }),
      context,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });
});

describe("DELETE workspace document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiCurrentUser.mockResolvedValue({ id: "user_1" });
    deleteWorkspaceDocument.mockResolvedValue(undefined);
  });

  const deleteRequest = (origin: string) =>
    new Request("https://example.test/VowBook/api/workspaces/workspace_1/documents/document_1", {
      method: "DELETE",
      headers: { origin, host: "example.test" },
    });

  it("拒絕跨來源刪除", async () => {
    expect((await DELETE(deleteRequest("https://evil.test"), context)).status).toBe(403);
    expect(deleteWorkspaceDocument).not.toHaveBeenCalled();
  });

  it("以伺服器端使用者刪除", async () => {
    expect((await DELETE(deleteRequest("https://example.test"), context)).status).toBe(204);
    expect(deleteWorkspaceDocument).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      documentId: "document_1",
      currentUserId: "user_1",
    });
  });
});
