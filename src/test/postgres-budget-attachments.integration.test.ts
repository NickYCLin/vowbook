import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_BUDGET_ATTACHMENT_BYTES,
  BudgetAttachmentValidationError,
} from "@/domain/budget-attachment";
import {
  BUDGET_TAXONOMY_NODES,
  type BudgetTaxonomyNodeKey,
} from "@/domain/budget-item";
import {
  BudgetAttachmentLimitError,
  BudgetAttachmentPermissionError,
  BudgetAttachmentTargetError,
  assertBudgetAttachmentReadAccess,
  createBudgetAttachment,
  deleteBudgetAttachment,
  getBudgetAttachmentDownload,
} from "@/lib/budget-attachments";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
let sequence = 0;

const pdf = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a,
]);
const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      googleSubject: `attachment-it-${label}-${sequence}`,
      email: `attachment-it-${label}-${sequence}@example.test`,
    },
  });
}

async function createWorkspace(userId: string, label: string) {
  const taxonomyNodeIds = Object.fromEntries(
    BUDGET_TAXONOMY_NODES.map((node) => [node.key, randomUUID()]),
  ) as Record<BudgetTaxonomyNodeKey, string>;
  return prisma.weddingWorkspace.create({
    data: {
      name: label,
      createdById: userId,
      memberships: { create: { userId, role: "OWNER" } },
      budgetItems: {
        create: BUDGET_TAXONOMY_NODES.map((node) => ({
          id: taxonomyNodeIds[node.key],
          parentId:
            node.parentKey === null
              ? null
              : taxonomyNodeIds[node.parentKey],
          sourceOrder: node.sourceOrder,
          name: node.label,
          kind: "GROUP" as const,
          category: null,
          systemTaxonomyKey: node.key,
          plannedAmount: 0,
        })),
      },
    },
  });
}

async function taxonomyItemId(workspaceId: string, systemTaxonomyKey: string) {
  const item = await prisma.budgetItem.findFirstOrThrow({
    where: { workspaceId, systemTaxonomyKey, kind: "GROUP" },
    select: { id: true },
  });
  return item.id;
}

async function createBudgetItem(
  workspaceId: string,
  kind: "GROUP" | "EXPENSE" = "EXPENSE",
) {
  const parentId = await taxonomyItemId(workspaceId, "ITEM_WEDDING_VENUE");
  return prisma.budgetItem.create({
    data: {
      workspaceId,
      parentId,
      name: kind === "EXPENSE" ? "場地費" : "方案群組",
      kind,
      category: kind === "EXPENSE" ? "VENUE_CATERING" : null,
      plannedAmount: kind === "EXPENSE" ? 1000 : 0,
    },
  });
}

function uploadInput(
  workspaceId: string,
  budgetItemId: string,
  currentUserId: string,
  data = pdf,
) {
  return {
    workspaceId,
    budgetItemId,
    currentUserId,
    originalName: "場地合約.pdf",
    mediaType: "application/pdf",
    data,
  };
}

async function waitForMembershipLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS "waiting"
      FROM "pg_stat_activity"
      WHERE "datname" = current_database()
        AND "state" = 'active'
        AND "wait_event_type" = 'Lock'
        AND "query" LIKE '%FROM "memberships"%'
        AND "query" LIKE '%FOR SHARE%'
    `;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the membership row-lock waiter.");
}

describeDatabase.sequential("PostgreSQL BudgetAttachment invariants", () => {
  beforeEach(async () => {
    await prisma.weddingWorkspace.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (runDatabaseIntegration) {
      await prisma.weddingWorkspace.deleteMany();
      await prisma.user.deleteMany();
    }
    await prisma.$disconnect();
  });

  it("enforces bytea, tenant/uploader FKs, signatures, hash, size, EXPENSE-only, and cascade", async () => {
    const owner = await createUser("constraints");
    const workspace = await createWorkspace(owner.id, "附件 constraint");
    const expense = await createBudgetItem(workspace.id);
    const group = await createBudgetItem(workspace.id, "GROUP");
    const sha256 = createHash("sha256").update(pdf).digest("hex");

    const [column] = await prisma.$queryRaw<
      Array<{ data_type: string; udt_name: string }>
    >`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'budget_attachments'
        AND column_name = 'data'
    `;
    expect(column).toEqual({ data_type: "bytea", udt_name: "bytea" });

    await expect(
      prisma.budgetAttachment.create({
        data: {
          workspaceId: workspace.id,
          budgetItemId: group.id,
          uploadedByUserId: owner.id,
          originalName: "group.pdf",
          mediaType: "application/pdf",
          byteSize: pdf.byteLength,
          sha256,
          data: Buffer.from(pdf),
        },
      }),
    ).rejects.toThrow();

    for (const invalid of [
      {
        byteSize: pdf.byteLength + 1,
        sha256,
        mediaType: "application/pdf",
        data: pdf,
      },
      {
        byteSize: pdf.byteLength,
        sha256: "0".repeat(64),
        mediaType: "application/pdf",
        data: pdf,
      },
      {
        byteSize: png.byteLength,
        sha256: createHash("sha256").update(png).digest("hex"),
        mediaType: "application/pdf",
        data: png,
      },
      {
        byteSize: MAX_BUDGET_ATTACHMENT_BYTES + 1,
        sha256,
        mediaType: "application/pdf",
        data: pdf,
      },
    ]) {
      await expect(
        prisma.budgetAttachment.create({
          data: {
            workspaceId: workspace.id,
            budgetItemId: expense.id,
            uploadedByUserId: owner.id,
            originalName: "invalid.pdf",
            mediaType: invalid.mediaType,
            byteSize: invalid.byteSize,
            sha256: invalid.sha256,
            data: Buffer.from(invalid.data),
          },
        }),
      ).rejects.toThrow();
    }

    const attachment = await prisma.budgetAttachment.create({
      data: {
        workspaceId: workspace.id,
        budgetItemId: expense.id,
        uploadedByUserId: owner.id,
        originalName: "場地合約.pdf",
        mediaType: "application/pdf",
        byteSize: pdf.byteLength,
        sha256,
        data: Buffer.from(pdf),
      },
    });
    const [stored] = await prisma.$queryRaw<
      Array<{ byte_size: number; data_length: number; stored_hash: string }>
    >`
      SELECT
        "byte_size",
        octet_length("data")::int AS "data_length",
        encode(sha256("data"), 'hex') AS "stored_hash"
      FROM "budget_attachments"
      WHERE "id" = ${attachment.id}
    `;
    expect(stored).toEqual({
      byte_size: pdf.byteLength,
      data_length: pdf.byteLength,
      stored_hash: sha256,
    });

    await prisma.budgetItem.delete({ where: { id: expense.id } });
    expect(await prisma.budgetAttachment.count()).toBe(0);
  });

  it("serializes attachment inserts against concurrent EXPENSE-to-GROUP changes in both lock orders", async () => {
    const owner = await createUser("kind-race");
    const workspace = await createWorkspace(owner.id, "附件 kind race");
    const firstExpense = await createBudgetItem(workspace.id);
    const secondExpense = await prisma.budgetItem.create({
      data: {
        workspaceId: workspace.id,
        parentId: await taxonomyItemId(
          workspace.id,
          "ITEM_WEDDING_PHOTOGRAPHY",
        ),
        name: "婚禮攝影",
        kind: "EXPENSE",
        category: "PHOTOGRAPHY_VIDEO",
        plannedAmount: 1000,
      },
    });
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    const groupData = {
      kind: "GROUP" as const,
      category: null,
      plannedAmount: 0,
      actualAmount: null,
      depositAmount: null,
      balanceAmount: null,
      additionalAmount: null,
      paidAt: null,
      dueDate: null,
      bookingStatus: "PLANNING" as const,
      paid: false,
      estimatedRange: null,
      candidateVendors: null,
      confirmedVendor: null,
      vendorContact: null,
      primaryContact: null,
      notes: null,
    };
    const attachmentData = (budgetItemId: string, name: string) => ({
      workspaceId: workspace.id,
      budgetItemId,
      uploadedByUserId: owner.id,
      originalName: name,
      mediaType: "application/pdf",
      byteSize: pdf.byteLength,
      sha256,
      data: Buffer.from(pdf),
    });

    let releaseInsert!: () => void;
    const insertRelease = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    let inserted!: () => void;
    const insertReady = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const heldInsert = prisma.$transaction(async (transaction) => {
      await transaction.budgetAttachment.create({
        data: attachmentData(firstExpense.id, "先上傳.pdf"),
      });
      inserted();
      await insertRelease;
    });
    await insertReady;

    let groupSettled = false;
    const blockedGroupChange = prisma.budgetItem
      .update({ where: { id: firstExpense.id }, data: groupData })
      .then(
        () => "fulfilled" as const,
        () => "rejected" as const,
      )
      .finally(() => {
        groupSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(groupSettled).toBe(false);
    releaseInsert();
    await heldInsert;
    expect(await blockedGroupChange).toBe("rejected");
    expect(
      await prisma.budgetItem.findUniqueOrThrow({
        where: { id: firstExpense.id },
        select: { kind: true },
      }),
    ).toEqual({ kind: "EXPENSE" });

    let releaseGroup!: () => void;
    const groupRelease = new Promise<void>((resolve) => {
      releaseGroup = resolve;
    });
    let groupUpdated!: () => void;
    const groupReady = new Promise<void>((resolve) => {
      groupUpdated = resolve;
    });
    const heldGroupChange = prisma.$transaction(async (transaction) => {
      await transaction.budgetItem.update({
        where: { id: secondExpense.id },
        data: groupData,
      });
      groupUpdated();
      await groupRelease;
    });
    await groupReady;

    let attachmentSettled = false;
    const blockedAttachment = prisma.budgetAttachment
      .create({ data: attachmentData(secondExpense.id, "後上傳.pdf") })
      .then(
        () => "fulfilled" as const,
        () => "rejected" as const,
      )
      .finally(() => {
        attachmentSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(attachmentSettled).toBe(false);
    releaseGroup();
    await heldGroupChange;
    expect(await blockedAttachment).toBe("rejected");
    expect(
      await prisma.budgetItem.findUniqueOrThrow({
        where: { id: secondExpense.id },
        select: { kind: true },
      }),
    ).toEqual({ kind: "GROUP" });
    expect(
      await prisma.budgetAttachment.count({
        where: { budgetItemId: secondExpense.id },
      }),
    ).toBe(0);
  });

  it("supports valid upload/download/delete, VIEWER read-only, and zero foreign-tenant access", async () => {
    const owner = await createUser("owner");
    const viewer = await createUser("viewer");
    const workspace = await createWorkspace(owner.id, "附件 lifecycle");
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
    });
    const expense = await createBudgetItem(workspace.id);

    const otherWorkspace = await createWorkspace(owner.id, "其他婚宴");
    const otherExpense = await createBudgetItem(otherWorkspace.id);

    const metadata = await createBudgetAttachment(
      uploadInput(workspace.id, expense.id, owner.id),
    );
    expect(metadata).toMatchObject({
      originalName: "場地合約.pdf",
      mediaType: "application/pdf",
      byteSize: pdf.byteLength,
    });

    await expect(
      assertBudgetAttachmentReadAccess({
        workspaceId: workspace.id,
        budgetItemId: expense.id,
        attachmentId: metadata.id,
        currentUserId: viewer.id,
      }),
    ).resolves.toBeUndefined();
    const download = await getBudgetAttachmentDownload({
      workspaceId: workspace.id,
      budgetItemId: expense.id,
      attachmentId: metadata.id,
      currentUserId: viewer.id,
    });
    expect(download.data).toEqual(Buffer.from(pdf));

    await expect(
      createBudgetAttachment(
        uploadInput(workspace.id, expense.id, viewer.id),
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentPermissionError);
    await expect(
      deleteBudgetAttachment({
        workspaceId: workspace.id,
        budgetItemId: expense.id,
        attachmentId: metadata.id,
        currentUserId: viewer.id,
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentPermissionError);
    await expect(
      assertBudgetAttachmentReadAccess({
        workspaceId: otherWorkspace.id,
        budgetItemId: otherExpense.id,
        attachmentId: metadata.id,
        currentUserId: owner.id,
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentTargetError);
    await expect(
      getBudgetAttachmentDownload({
        workspaceId: otherWorkspace.id,
        budgetItemId: otherExpense.id,
        attachmentId: metadata.id,
        currentUserId: owner.id,
      }),
    ).rejects.toBeInstanceOf(BudgetAttachmentTargetError);

    await deleteBudgetAttachment({
      workspaceId: workspace.id,
      budgetItemId: expense.id,
      attachmentId: metadata.id,
      currentUserId: owner.id,
    });
    expect(await prisma.budgetAttachment.count()).toBe(0);
  });

  it("does not create after an accepted editor membership is concurrently revoked", async () => {
    const owner = await createUser("create-revoke-owner");
    const editor = await createUser("create-revoke-editor");
    const workspace = await createWorkspace(owner.id, "附件 create revoke race");
    const expense = await createBudgetItem(workspace.id);
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: editor.id, role: "PLANNER" },
    });

    let releaseRevocation!: () => void;
    const revocationRelease = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    let revocationLocked!: () => void;
    const revocationReady = new Promise<void>((resolve) => {
      revocationLocked = resolve;
    });
    const heldRevocation = prisma.$transaction(async (transaction) => {
      await transaction.membership.delete({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: editor.id,
          },
        },
      });
      revocationLocked();
      await revocationRelease;
    });
    await revocationReady;

    let creationSettled = false;
    const creation = createBudgetAttachment(
      uploadInput(workspace.id, expense.id, editor.id),
    )
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      )
      .finally(() => {
        creationSettled = true;
      });

    try {
      await waitForMembershipLockWaiter();
      expect(creationSettled).toBe(false);
    } finally {
      releaseRevocation();
    }
    await heldRevocation;

    const result = await creation;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toBeInstanceOf(BudgetAttachmentTargetError);
    }
    expect(
      await prisma.budgetAttachment.count({
        where: { workspaceId: workspace.id, budgetItemId: expense.id },
      }),
    ).toBe(0);
  });

  it("does not delete after an accepted editor membership is concurrently downgraded", async () => {
    const owner = await createUser("delete-downgrade-owner");
    const editor = await createUser("delete-downgrade-editor");
    const workspace = await createWorkspace(owner.id, "附件 delete downgrade race");
    const expense = await createBudgetItem(workspace.id);
    const attachment = await createBudgetAttachment(
      uploadInput(workspace.id, expense.id, owner.id),
    );
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: editor.id, role: "PLANNER" },
    });

    let releaseDowngrade!: () => void;
    const downgradeRelease = new Promise<void>((resolve) => {
      releaseDowngrade = resolve;
    });
    let downgradeLocked!: () => void;
    const downgradeReady = new Promise<void>((resolve) => {
      downgradeLocked = resolve;
    });
    const heldDowngrade = prisma.$transaction(async (transaction) => {
      await transaction.membership.update({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: editor.id,
          },
        },
        data: { role: "VIEWER" },
      });
      downgradeLocked();
      await downgradeRelease;
    });
    await downgradeReady;

    let deletionSettled = false;
    const deletion = deleteBudgetAttachment({
      workspaceId: workspace.id,
      budgetItemId: expense.id,
      attachmentId: attachment.id,
      currentUserId: editor.id,
    })
      .then(
        () => ({ status: "fulfilled" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      )
      .finally(() => {
        deletionSettled = true;
      });

    try {
      await waitForMembershipLockWaiter();
      expect(deletionSettled).toBe(false);
    } finally {
      releaseDowngrade();
    }
    await heldDowngrade;

    const result = await deletion;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toBeInstanceOf(BudgetAttachmentPermissionError);
    }
    expect(
      await prisma.budgetAttachment.count({
        where: {
          id: attachment.id,
          workspaceId: workspace.id,
          budgetItemId: expense.id,
        },
      }),
    ).toBe(1);
  });

  it("rejects spoof, oversize, per-item count, workspace quota, and GROUP target", async () => {
    const owner = await createUser("limits");
    const workspace = await createWorkspace(owner.id, "附件 limits");
    const expense = await createBudgetItem(workspace.id);
    const secondExpense = await prisma.budgetItem.create({
      data: {
        workspaceId: workspace.id,
        parentId: await taxonomyItemId(
          workspace.id,
          "ITEM_WEDDING_PHOTOGRAPHY",
        ),
        name: "攝影費",
        kind: "EXPENSE",
        category: "PHOTOGRAPHY_VIDEO",
        plannedAmount: 1000,
      },
    });
    const group = await createBudgetItem(workspace.id, "GROUP");

    await expect(
      createBudgetAttachment(
        uploadInput(workspace.id, expense.id, owner.id, png),
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentValidationError);
    await expect(
      createBudgetAttachment(
        uploadInput(
          workspace.id,
          expense.id,
          owner.id,
          new Uint8Array(MAX_BUDGET_ATTACHMENT_BYTES + 1),
        ),
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentValidationError);
    await expect(
      createBudgetAttachment(
        uploadInput(workspace.id, group.id, owner.id),
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentTargetError);

    await createBudgetAttachment(
      uploadInput(workspace.id, expense.id, owner.id),
      { maxFilesPerItem: 1, maxWorkspaceBytes: 100 },
    );
    await expect(
      createBudgetAttachment(
        uploadInput(workspace.id, expense.id, owner.id),
        { maxFilesPerItem: 1, maxWorkspaceBytes: 100 },
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentLimitError);
    await expect(
      createBudgetAttachment(
        uploadInput(workspace.id, secondExpense.id, owner.id),
        {
          maxFilesPerItem: 20,
          maxWorkspaceBytes: pdf.byteLength,
        },
      ),
    ).rejects.toBeInstanceOf(BudgetAttachmentLimitError);
  });

  it("serializes parallel uploads so a small workspace quota is never exceeded", async () => {
    const owner = await createUser("parallel");
    const workspace = await createWorkspace(owner.id, "附件 parallel");
    const firstExpense = await createBudgetItem(workspace.id);
    const secondExpense = await prisma.budgetItem.create({
      data: {
        workspaceId: workspace.id,
        parentId: await taxonomyItemId(
          workspace.id,
          "ITEM_WEDDING_PHOTOGRAPHY",
        ),
        name: "婚禮攝影",
        kind: "EXPENSE",
        category: "PHOTOGRAPHY_VIDEO",
        plannedAmount: 1000,
      },
    });
    const limits = {
      maxFilesPerItem: 20,
      maxWorkspaceBytes: pdf.byteLength,
    };

    const results = await Promise.allSettled([
      createBudgetAttachment(
        uploadInput(workspace.id, firstExpense.id, owner.id),
        limits,
      ),
      createBudgetAttachment(
        uploadInput(workspace.id, secondExpense.id, owner.id),
        limits,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );

    const aggregate = await prisma.budgetAttachment.aggregate({
      where: { workspaceId: workspace.id },
      _count: true,
      _sum: { byteSize: true },
    });
    expect(aggregate._count).toBe(1);
    expect(aggregate._sum.byteSize).toBe(pdf.byteLength);
  });
});
