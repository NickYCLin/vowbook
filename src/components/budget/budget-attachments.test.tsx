import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetAttachmentMetadata } from "@/domain/budget-attachment";
import { BudgetAttachments } from "./budget-attachments";

const attachment = {
  id: "attachment_1",
  originalName: "場地 合約.pdf",
  mediaType: "application/pdf",
  byteSize: 2048,
  createdAt: "2026-07-27T08:00:00.000Z",
} satisfies BudgetAttachmentMetadata;

describe("BudgetAttachments", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders an empty VIEWER state without upload or delete controls", () => {
    render(
      <BudgetAttachments
        workspaceId="workspace_1"
        budgetItemId="expense_1"
        initialAttachments={[]}
        canEdit={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "附件" })).toBeInTheDocument();
    expect(screen.getByText("尚未上傳附件。")).toBeInTheDocument();
    expect(screen.queryByLabelText("選擇附件")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /刪除/ })).not.toBeInTheDocument();
  });

  it("gives a VIEWER base-path-safe online-view and download links", () => {
    render(
      <BudgetAttachments
        workspaceId="workspace_1"
        budgetItemId="expense_1"
        initialAttachments={[attachment]}
        canEdit={false}
      />,
    );

    const onlineViewLink = screen.getByRole("link", {
      name: "線上查看（新分頁）：場地 合約.pdf",
    });
    expect(onlineViewLink).toHaveTextContent("線上查看（新分頁）");
    expect(onlineViewLink).toHaveAttribute(
      "href",
      "/VowBook/workspaces/workspace_1/budget/expense_1/attachments/attachment_1/preview",
    );
    expect(onlineViewLink).toHaveAttribute("target", "_blank");
    expect(onlineViewLink).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );

    const downloadLink = screen.getByRole("link", {
      name: "下載 場地 合約.pdf",
    });
    expect(downloadLink).toHaveAttribute(
      "href",
      "/VowBook/api/workspaces/workspace_1/budget/expense_1/attachments/attachment_1",
    );
    expect(downloadLink).toHaveAttribute("download");
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.queryByLabelText("選擇附件")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /刪除/ })).not.toBeInTheDocument();
  });

  it("shows editor controls and long-filename mobile-safe DOM classes", () => {
    const longFilename = `${"婚宴場地合約".repeat(24)}.pdf`;
    const { container } = render(
      <BudgetAttachments
        workspaceId="workspace_1"
        budgetItemId="expense_1"
        initialAttachments={[
          { ...attachment, originalName: longFilename },
        ]}
        canEdit
      />,
    );

    expect(screen.getByLabelText("選擇附件")).toHaveAttribute(
      "accept",
      "application/pdf,image/jpeg,image/png,image/webp",
    );
    expect(
      screen.getByText(/PDF、JPEG、PNG、WEBP，單檔最多 10 MiB/),
    ).toBeInTheDocument();
    const row = container.querySelector(
      '[data-attachment-layout="mobile-stacked"]',
    );
    expect(row).toHaveClass("grid", "grid-cols-1", "min-w-0");
    expect(within(row as HTMLElement).getByText(longFilename)).toHaveClass(
      "break-all",
    );
    const controls = container.querySelector(
      '[data-attachment-controls="true"]',
    );
    expect(controls).toHaveClass("flex", "flex-wrap", "min-w-0");
    expect(
      within(controls as HTMLElement).getByRole("link", {
        name: `線上查看（新分頁）：${longFilename}`,
      }),
    ).toBeInTheDocument();
    expect(
      within(controls as HTMLElement).getByRole("link", {
        name: `下載 ${longFilename}`,
      }),
    ).toHaveAttribute("download");
    expect(
      within(controls as HTMLElement).getByRole("button", {
        name: `刪除附件：${longFilename}`,
      }),
    ).toBeInTheDocument();
  });

  it("uploads with same-origin credentials, reports pending, and shows success", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          attachment: {
            ...attachment,
            id: "attachment_2",
            originalName: "對話.png",
            mediaType: "image/png",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const onPendingChange = vi.fn();
    const onAttachmentCountChange = vi.fn();
    render(
      <BudgetAttachments
        workspaceId="workspace_1"
        budgetItemId="expense_1"
        initialAttachments={[]}
        canEdit
        onPendingChange={onPendingChange}
        onAttachmentCountChange={onAttachmentCountChange}
      />,
    );

    const file = new File(
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47])],
      "對話.png",
      { type: "image/png" },
    );
    fireEvent.change(screen.getByLabelText("選擇附件"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "上傳附件" }));

    expect(onPendingChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/VowBook/api/workspaces/workspace_1/budget/expense_1/attachments",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: expect.any(FormData),
      }),
    );
    const uploadStatus = await screen.findByRole("status");
    expect(uploadStatus).toHaveTextContent("已上傳附件「對話.png」。");
    await waitFor(() => expect(uploadStatus).toHaveFocus());
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
    expect(onAttachmentCountChange).toHaveBeenCalledWith(1);
  });

  it("keeps a failed upload visible and requires confirmation before deletion", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "附件格式與內容不符。" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const onAttachmentCountChange = vi.fn();
    render(
      <BudgetAttachments
        workspaceId="workspace_1"
        budgetItemId="expense_1"
        initialAttachments={[attachment]}
        canEdit
        onAttachmentCountChange={onAttachmentCountChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("選擇附件"), {
      target: {
        files: [
          new File([Uint8Array.from([0x00])], "fake.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "上傳附件" }));
    const uploadError = await screen.findByRole("alert");
    expect(uploadError).toHaveTextContent("附件格式與內容不符。");
    await waitFor(() => expect(uploadError).toHaveFocus());

    fireEvent.click(
      screen.getByRole("button", { name: "刪除附件：場地 合約.pdf" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      "確定刪除附件「場地 合約.pdf」？刪除後無法復原。",
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/VowBook/api/workspaces/workspace_1/budget/expense_1/attachments/attachment_1",
        { method: "DELETE", credentials: "same-origin" },
      ),
    );
    expect(screen.queryByText("場地 合約.pdf")).not.toBeInTheDocument();
    expect(onAttachmentCountChange).toHaveBeenCalledWith(0);
  });
});
