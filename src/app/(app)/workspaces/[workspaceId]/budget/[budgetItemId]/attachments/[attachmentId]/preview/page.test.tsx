import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCurrentUser,
  getBudgetAttachmentMetadata,
  notFound,
  BudgetAttachmentTargetError,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  getBudgetAttachmentMetadata: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  BudgetAttachmentTargetError: class BudgetAttachmentTargetError extends Error {},
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/budget-attachments", () => ({
  getBudgetAttachmentMetadata,
  BudgetAttachmentTargetError,
}));
vi.mock("next/navigation", () => ({ notFound }));

import AttachmentPreviewPage, { dynamic, metadata } from "./page";

const params = Promise.resolve({
  workspaceId: "workspace_1",
  budgetItemId: "expense_1",
  attachmentId: "attachment_1",
});

describe("AttachmentPreviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");
    requireCurrentUser.mockResolvedValue({ id: "viewer_1" });
    getBudgetAttachmentMetadata.mockResolvedValue({
      id: "attachment_1",
      originalName: "場地配置圖.png",
      mediaType: "image/png",
      byteSize: 2048,
      createdAt: "2026-07-31T08:00:00.000Z",
      workspaceName: "我們的婚宴",
    });
  });

  it("authenticates and authorizes the exact composite attachment before rendering the branded shell", async () => {
    render(await AttachmentPreviewPage({ params }));

    expect(metadata.title).toBe("附件預覽");
    expect(dynamic).toBe("force-dynamic");
    expect(requireCurrentUser).toHaveBeenCalledWith();
    expect(getBudgetAttachmentMetadata).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      budgetItemId: "expense_1",
      attachmentId: "attachment_1",
      currentUserId: "viewer_1",
    });
    expect(
      screen.getByRole("heading", { name: "VowBook 安全附件預覽" }),
    ).toBeInTheDocument();
    expect(screen.getByText("場地配置圖.png")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下載原始檔" })).toHaveAttribute(
      "href",
      "/VowBook/api/workspaces/workspace_1/budget/expense_1/attachments/attachment_1",
    );
    expect(screen.getByTitle("場地配置圖.png 的安全預覽")).toHaveAttribute(
      "src",
      "/VowBook/api/workspaces/workspace_1/budget/expense_1/attachments/attachment_1?disposition=inline",
    );
  });

  it("maps missing and cross-tenant attachments to the same generic not found", async () => {
    getBudgetAttachmentMetadata.mockRejectedValue(
      new BudgetAttachmentTargetError(),
    );

    await expect(AttachmentPreviewPage({ params })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFound).toHaveBeenCalledOnce();
  });
});
