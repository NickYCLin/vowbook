import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDocumentMetadata } from "@/domain/workspace-document";
import { WorkspaceDocuments } from "./workspace-documents";

const invitation: WorkspaceDocumentMetadata = {
  id: "document_1",
  category: "INVITATION",
  title: "電子喜帖定稿",
  notes: "LINE 群組用這張",
  originalName: "喜帖.png",
  mediaType: "image/png",
  byteSize: 2 * 1024 * 1024,
  createdAt: "2026-09-30T01:00:00.000Z",
  uploadedByName: "合成新人",
};
const contract: WorkspaceDocumentMetadata = {
  ...invitation,
  id: "document_2",
  category: "VENDOR_CONTRACT",
  title: "婚攝合約",
  notes: null,
  originalName: "婚攝合約.docx",
  mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  byteSize: 1536,
  uploadedByName: null,
};

describe("WorkspaceDocuments", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("依分類列出文件；唯讀成員只能開啟與下載", () => {
    render(<WorkspaceDocuments workspaceId="ws_1" initialDocuments={[invitation, contract]} canEdit={false} />);

    expect(screen.queryByRole("form", { name: "上傳喜帖或廠商文件" })).toBeNull();
    const invitations = screen.getByRole("region", { name: /電子喜帖/u });
    expect(within(invitations).getByText("電子喜帖定稿")).toBeInTheDocument();
    expect(within(invitations).getByText("LINE 群組用這張")).toBeInTheDocument();
    expect(within(invitations).getByRole("link", { name: "開啟（新分頁）：電子喜帖定稿" })).toHaveAttribute(
      "href",
      "/VowBook/api/workspaces/ws_1/documents/document_1?disposition=inline",
    );

    const contracts = screen.getByRole("region", { name: /廠商合約/u });
    expect(within(contracts).queryByRole("link", { name: /開啟/u })).toBeNull();
    expect(within(contracts).getByRole("link", { name: "下載：婚攝合約" })).toHaveAttribute(
      "href",
      "/VowBook/api/workspaces/ws_1/documents/document_2",
    );
    expect(screen.queryByRole("button", { name: /刪除/u })).toBeNull();
    expect(within(screen.getByRole("region", { name: /廠商行程表/u })).getByText("還沒有檔案。")).toBeInTheDocument();
  });

  it("編輯者上傳後，新文件出現在對應分類", async () => {
    const created = { ...contract, id: "document_3", category: "VENDOR_SCHEDULE", title: "當日行程" };
    const fetchMock = vi.fn(async () => Response.json({ document: created }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceDocuments workspaceId="ws_1" initialDocuments={[]} canEdit />);

    const form = screen.getByRole("form", { name: "上傳喜帖或廠商文件" });
    fireEvent.change(within(form).getByLabelText("分類"), { target: { value: "VENDOR_SCHEDULE" } });
    fireEvent.change(within(form).getByLabelText("檔案"), {
      target: { files: [new File(["x"], "行程.xlsx")] },
    });
    fireEvent.submit(form);

    expect(await screen.findByRole("status")).toHaveTextContent("已存好「當日行程」。");
    expect(fetchMock).toHaveBeenCalledWith(
      "/VowBook/api/workspaces/ws_1/documents",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(body.get("category")).toBe("VENDOR_SCHEDULE");
    expect(within(screen.getByRole("region", { name: /廠商行程表/u })).getByText("當日行程")).toBeInTheDocument();
  });

  it("上傳失敗時顯示伺服器訊息", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "單一檔案不可超過 25 MiB。" }, { status: 400 })));
    render(<WorkspaceDocuments workspaceId="ws_1" initialDocuments={[]} canEdit />);
    const form = screen.getByRole("form", { name: "上傳喜帖或廠商文件" });
    fireEvent.change(within(form).getByLabelText("檔案"), { target: { files: [new File(["x"], "a.pdf")] } });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("單一檔案不可超過 25 MiB。");
  });

  it("確認後刪除文件", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceDocuments workspaceId="ws_1" initialDocuments={[invitation]} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "刪除：電子喜帖定稿" }));
    await waitFor(() => expect(screen.queryByText("LINE 群組用這張")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/VowBook/api/workspaces/ws_1/documents/document_1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
