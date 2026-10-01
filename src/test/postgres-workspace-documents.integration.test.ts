import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  getWorkspaceDocumentContent,
  listWorkspaceDocumentsForUser,
  WorkspaceDocumentPermissionError,
  WorkspaceDocumentTargetError,
} from "@/lib/workspace-documents";

const enabled = process.env.VOWBOOK_DB_INTEGRATION === "1";
const db = new PrismaClient();
const pdf = new TextEncoder().encode("%PDF-1.7\n合成喜帖");

async function user(label: string) {
  return db.user.create({
    data: { googleSubject: `document-${label}`, email: `document-${label}@example.test`, name: label },
  });
}

(enabled ? describe : describe.skip).sequential("PostgreSQL workspace documents", () => {
  beforeEach(async () => {
    await db.weddingWorkspace.deleteMany();
    await db.user.deleteMany();
  });
  afterAll(async () => {
    if (enabled) {
      await db.weddingWorkspace.deleteMany();
      await db.user.deleteMany();
    }
    await db.$disconnect();
  });

  it("成員可存取、唯讀成員不能上傳、外人看不到", async () => {
    const [owner, viewer, outsider] = await Promise.all([user("owner"), user("viewer"), user("outsider")]);
    const workspace = await db.weddingWorkspace.create({
      data: {
        name: "文件測試",
        createdById: owner.id,
        memberships: { create: [{ userId: owner.id, role: "OWNER" }, { userId: viewer.id, role: "VIEWER" }] },
      },
    });

    const created = await createWorkspaceDocument({
      workspaceId: workspace.id,
      currentUserId: owner.id,
      originalName: "喜帖.pdf",
      data: pdf,
      category: "INVITATION",
      title: "",
      notes: "",
    });
    expect(created).toMatchObject({ title: "喜帖", category: "INVITATION", notes: null, uploadedByName: "owner" });

    const viewerList = await listWorkspaceDocumentsForUser(workspace.id, viewer.id);
    expect(viewerList.documents.map((document) => document.id)).toEqual([created.id]);
    const content = await getWorkspaceDocumentContent({
      workspaceId: workspace.id,
      documentId: created.id,
      currentUserId: viewer.id,
    });
    expect(Buffer.compare(content.data, Buffer.from(pdf))).toBe(0);

    await expect(
      createWorkspaceDocument({
        workspaceId: workspace.id,
        currentUserId: viewer.id,
        originalName: "偷傳.pdf",
        data: pdf,
        category: "OTHER",
        title: "",
        notes: "",
      }),
    ).rejects.toBeInstanceOf(WorkspaceDocumentPermissionError);
    await expect(
      deleteWorkspaceDocument({ workspaceId: workspace.id, documentId: created.id, currentUserId: viewer.id }),
    ).rejects.toBeInstanceOf(WorkspaceDocumentPermissionError);
    await expect(listWorkspaceDocumentsForUser(workspace.id, outsider.id)).rejects.toBeInstanceOf(
      WorkspaceDocumentTargetError,
    );
    await expect(
      getWorkspaceDocumentContent({ workspaceId: workspace.id, documentId: created.id, currentUserId: outsider.id }),
    ).rejects.toBeInstanceOf(WorkspaceDocumentTargetError);

    await deleteWorkspaceDocument({ workspaceId: workspace.id, documentId: created.id, currentUserId: owner.id });
    expect(await db.workspaceDocument.count()).toBe(0);
  });

  it("資料庫拒絕大小與內容不符的列，上傳者刪除帳號後保留文件", async () => {
    const [owner, partner] = await Promise.all([user("owner2"), user("partner2")]);
    const workspace = await db.weddingWorkspace.create({
      data: {
        name: "文件測試二",
        createdById: owner.id,
        memberships: { create: [{ userId: owner.id, role: "OWNER" }, { userId: partner.id, role: "PARTNER" }] },
      },
    });
    await expect(
      db.workspaceDocument.create({
        data: {
          workspaceId: workspace.id,
          category: "OTHER",
          title: "壞資料",
          originalName: "a.pdf",
          mediaType: "application/pdf",
          byteSize: 999,
          sha256: "0".repeat(64),
          data: Buffer.from(pdf),
        },
      }),
    ).rejects.toThrow();

    const created = await createWorkspaceDocument({
      workspaceId: workspace.id,
      currentUserId: partner.id,
      originalName: "行程.pdf",
      data: pdf,
      category: "VENDOR_SCHEDULE",
      title: "當日行程",
      notes: "",
    });
    await db.membership.delete({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: partner.id } } });
    await db.user.delete({ where: { id: partner.id } });
    const list = await listWorkspaceDocumentsForUser(workspace.id, owner.id);
    expect(list.documents).toEqual([expect.objectContaining({ id: created.id, uploadedByName: null })]);
  });
});
