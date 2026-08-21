import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  membership: { findUnique: vi.fn() },
  budgetItem: { findUnique: vi.fn() },
  budgetAttachment: {
    aggregate: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(
      async (operation: (transaction: typeof tx) => unknown) => operation(tx),
    ),
  },
}));

vi.mock("@/lib/serializable-transaction", () => ({
  runSerializableTransaction: vi.fn(
    async (operation: (transaction: typeof tx) => unknown) => operation(tx),
  ),
}));

import {
  BudgetAttachmentLimitError,
  BudgetAttachmentPermissionError,
  BudgetAttachmentTargetError,
  assertBudgetAttachmentUploadAccess,
  createBudgetAttachment,
  deleteBudgetAttachment,
  getBudgetAttachmentMetadata,
  getBudgetAttachmentDownload,
} from "./budget-attachments";

const pdf = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a,
]);
const createdAt = new Date("2026-07-27T08:00:00.000Z");

function membership(role = "OWNER") {
  return { role, workspace: { id: "workspace_1" } };
}

describe("budget attachment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ role: "OWNER" }]);
    tx.membership.findUnique.mockResolvedValue(membership());
    tx.budgetItem.findUnique.mockResolvedValue({
      id: "expense_1",
      kind: "EXPENSE",
    });
    tx.budgetAttachment.count.mockResolvedValue(0);
    tx.budgetAttachment.aggregate.mockResolvedValue({
      _sum: { byteSize: null },
    });
    tx.budgetAttachment.create.mockResolvedValue({
      id: "attachment_1",
      originalName: "場地合約.pdf",
      mediaType: "application/pdf",
      byteSize: pdf.byteLength,
      createdAt,
    });
  });

  it("preflights editor membership and the composite EXPENSE target before multipart parsing", async () => {
    await assertBudgetAttachmentUploadAccess({
      workspaceId: "workspace_1",
      budgetItemId: "expense_1",
      currentUserId: "user_1",
    });

    expect(tx.membership.findUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_userId: {
          workspaceId: "workspace_1",
          userId: "user_1",
        },
      },
      include: { workspace: true },
    });
    expect(tx.budgetItem.findUnique).toHaveBeenCalledWith({
      where: {
        id_workspaceId: {
          id: "expense_1",
          workspaceId: "workspace_1",
        },
      },
      select: { id: true, kind: true },
    });
    expect(tx.budgetAttachment.create).not.toHaveBeenCalled();
  });

  it("locks the accepted editor membership before the EXPENSE target inside the Serializable transaction", async () => {
    const result = await createBudgetAttachment({
      workspaceId: "workspace_1",
      budgetItemId: "expense_1",
      currentUserId: "user_1",
      originalName: "場地合約.pdf",
      mediaType: "application/pdf",
      data: pdf,
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const membershipQuery = tx.$queryRaw.mock.calls[0]?.[0] as {
      strings: readonly string[];
      values: unknown[];
    };
    expect(membershipQuery.strings.join(" ")).toContain('FROM "memberships"');
    expect(membershipQuery.strings.join(" ")).toContain("FOR SHARE");
    expect(membershipQuery.values).toEqual(["workspace_1", "user_1"]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.budgetItem.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.membership.findUnique).not.toHaveBeenCalled();
    expect(tx.budgetAttachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        budgetItemId: "expense_1",
        uploadedByUserId: "user_1",
        originalName: "場地合約.pdf",
        mediaType: "application/pdf",
        byteSize: pdf.byteLength,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        data: Buffer.from(pdf),
      }),
      select: {
        id: true,
        originalName: true,
        mediaType: true,
        byteSize: true,
        createdAt: true,
      },
    });
    expect(result.createdAt).toBe(createdAt.toISOString());
  });

  it("denies a VIEWER before looking up or inserting the target", async () => {
    tx.$queryRaw.mockResolvedValue([{ role: "VIEWER" }]);

    await expect(
      createBudgetAttachment({
        workspaceId: "workspace_1",
        budgetItemId: "expense_1",
        currentUserId: "viewer_1",
        originalName: "場地合約.pdf",
        mediaType: "application/pdf",
        data: pdf,
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentPermissionError);
    expect(tx.budgetItem.findUnique).not.toHaveBeenCalled();
    expect(tx.budgetAttachment.create).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign workspace", null],
    ["GROUP target", { id: "group_1", kind: "GROUP" }],
  ])("returns the same target error for %s", async (_label, target) => {
    if (target === null) {
      tx.$queryRaw.mockResolvedValue([]);
    } else {
      tx.budgetItem.findUnique.mockResolvedValue(target);
    }

    await expect(
      createBudgetAttachment({
        workspaceId: "workspace_1",
        budgetItemId: "forged",
        currentUserId: "user_1",
        originalName: "場地合約.pdf",
        mediaType: "application/pdf",
        data: pdf,
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentTargetError);
  });

  it("rejects the per-item count and workspace-byte quota without inserting", async () => {
    tx.budgetAttachment.count.mockResolvedValueOnce(2);
    await expect(
      createBudgetAttachment(
        {
          workspaceId: "workspace_1",
          budgetItemId: "expense_1",
          currentUserId: "user_1",
          originalName: "場地合約.pdf",
          mediaType: "application/pdf",
          data: pdf,
        },
        { maxFilesPerItem: 2, maxWorkspaceBytes: 100 },
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentLimitError);

    tx.budgetAttachment.count.mockResolvedValueOnce(0);
    tx.budgetAttachment.aggregate.mockResolvedValueOnce({
      _sum: { byteSize: 95 },
    });
    await expect(
      createBudgetAttachment(
        {
          workspaceId: "workspace_1",
          budgetItemId: "expense_1",
          currentUserId: "user_1",
          originalName: "場地合約.pdf",
          mediaType: "application/pdf",
          data: pdf,
        },
        { maxFilesPerItem: 20, maxWorkspaceBytes: 100 },
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentLimitError);

    expect(tx.budgetAttachment.create).not.toHaveBeenCalled();
  });

  it("lets a VIEWER download an exact tenant-scoped attachment and verifies blob integrity", async () => {
    tx.membership.findUnique.mockResolvedValue(membership("VIEWER"));
    tx.budgetAttachment.findFirst.mockResolvedValue({
      originalName: "場地合約.pdf",
      mediaType: "application/pdf",
      byteSize: pdf.byteLength,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      data: Buffer.from(pdf),
    });

    const result = await getBudgetAttachmentDownload({
      workspaceId: "workspace_1",
      budgetItemId: "expense_1",
      attachmentId: "attachment_1",
      currentUserId: "viewer_1",
    });

    expect(tx.budgetAttachment.findFirst).toHaveBeenCalledWith({
      where: {
        id: "attachment_1",
        workspaceId: "workspace_1",
        budgetItemId: "expense_1",
        budgetItem: { kind: "EXPENSE" },
      },
      select: {
        originalName: true,
        mediaType: true,
        byteSize: true,
        sha256: true,
        data: true,
      },
    });
    expect(result.data).toEqual(Buffer.from(pdf));
  });

  it("lets a VIEWER authorize exact metadata without selecting the BLOB", async () => {
    tx.membership.findUnique.mockResolvedValue(membership("VIEWER"));
    tx.budgetAttachment.findFirst.mockResolvedValue({
      id: "attachment_1",
      originalName: "場地合約.pdf",
      mediaType: "application/pdf",
      byteSize: pdf.byteLength,
      createdAt,
      workspace: { name: "我們的婚宴" },
    });

    await expect(
      getBudgetAttachmentMetadata({
        workspaceId: "workspace_1",
        budgetItemId: "expense_1",
        attachmentId: "attachment_1",
        currentUserId: "viewer_1",
      }),
    ).resolves.toEqual({
      id: "attachment_1",
      originalName: "場地合約.pdf",
      mediaType: "application/pdf",
      byteSize: pdf.byteLength,
      createdAt: createdAt.toISOString(),
      workspaceName: "我們的婚宴",
    });
    expect(tx.budgetAttachment.findFirst).toHaveBeenCalledWith({
      where: {
        id: "attachment_1",
        workspaceId: "workspace_1",
        budgetItemId: "expense_1",
        budgetItem: { kind: "EXPENSE" },
      },
      select: {
        id: true,
        originalName: true,
        mediaType: true,
        byteSize: true,
        createdAt: true,
        workspace: { select: { name: true } },
      },
    });
    expect(tx.budgetAttachment.findFirst.mock.calls.at(-1)?.[0].select).not.toHaveProperty(
      "data",
    );
  });

  it("locks the accepted editor membership and keeps exact tenant keys before deleting", async () => {
    tx.budgetAttachment.deleteMany.mockResolvedValue({ count: 1 });

    await deleteBudgetAttachment({
      workspaceId: "workspace_1",
      budgetItemId: "expense_1",
      attachmentId: "attachment_1",
      currentUserId: "user_1",
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const membershipQuery = tx.$queryRaw.mock.calls[0]?.[0] as {
      strings: readonly string[];
      values: unknown[];
    };
    expect(membershipQuery.strings.join(" ")).toContain('FROM "memberships"');
    expect(membershipQuery.strings.join(" ")).toContain("FOR SHARE");
    expect(membershipQuery.values).toEqual(["workspace_1", "user_1"]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.budgetItem.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.membership.findUnique).not.toHaveBeenCalled();
    expect(tx.budgetAttachment.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "attachment_1",
        workspaceId: "workspace_1",
        budgetItemId: "expense_1",
      },
    });
  });
});
