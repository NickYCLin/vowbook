import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireCurrentUser: async () => ({ id: auth.id }) }));
import { submitProductFeedbackAction } from "@/actions/product-feedback";

const enabled = process.env.VOWBOOK_DB_INTEGRATION === "1";
const db = new PrismaClient();
const requestId = "00000000-0000-4000-8000-000000000001";
function submit(workspaceId: string, id = requestId) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ requestId: id, section: "timeline", category: "suggestion", message: "希望可以依照操作習慣調整流程顯示。" })) form.set(key, value);
  return submitProductFeedbackAction(workspaceId, { status: "idle" }, form);
}
(enabled ? describe : describe.skip).sequential("PostgreSQL 意見回饋", () => {
  beforeEach(async () => {
    await db.weddingWorkspace.deleteMany();
    await db.user.deleteMany();
  });
  afterAll(async () => {
    if (enabled) { await db.weddingWorkspace.deleteMany(); await db.user.deleteMany(); }
    await db.$disconnect();
  });
  async function seed() {
    const user = await db.user.create({ data: { email: "feedback@example.test", googleSubject: "feedback-synthetic" } });
    auth.id = user.id;
    return db.weddingWorkspace.create({ data: { name: "回饋測試", createdById: user.id, memberships: { create: { userId: user.id, role: "VIEWER" } } } });
  }
  it("唯讀成員可保存且重送不重複建立", async () => {
    const workspace = await seed();
    expect((await submit(workspace.id)).status).toBe("success");
    expect((await submit(workspace.id)).status).toBe("success");
    expect(await db.productFeedback.count()).toBe(1);
    expect(await db.productFeedback.findUnique({ where: { id: requestId } })).toMatchObject({ authorId: auth.id, workspaceId: workspace.id, contact: null });
  });
  it("移除成員後不能重送或讀取既有回饋結果", async () => {
    const workspace = await seed();
    await submit(workspace.id);
    await db.membership.deleteMany();
    expect((await submit(workspace.id)).status).toBe("error");
    expect(await db.productFeedback.count()).toBe(1);
  });
  it("其他工作區不可借用回饋編號", async () => {
    const workspace = await seed();
    await submit(workspace.id);
    expect((await submit("nonexistent-workspace")).status).toBe("error");
  });
  it("超出每小時上限不寫入，刪除工作區會清除回饋", async () => {
    const workspace = await seed();
    await db.productFeedback.createMany({ data: Array.from({ length: 10 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`, workspaceId: workspace.id, authorId: auth.id, section: "timeline", category: "suggestion", message: "合成回饋測試內容" })) });
    expect((await submit(workspace.id)).status).toBe("error");
    await db.weddingWorkspace.delete({ where: { id: workspace.id } });
    expect(await db.productFeedback.count()).toBe(0);
  });
});
