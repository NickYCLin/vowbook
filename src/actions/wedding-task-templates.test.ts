import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
const mocks = vi.hoisted(() => ({ user: vi.fn(), apply: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireCurrentUser: mocks.user }));
vi.mock("@/lib/wedding-task-templates", () => ({ applyWeddingTaskTemplate: mocks.apply }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { applyWeddingTaskTemplateAction } from "./wedding-task-templates";
const form = () => { const data = new FormData(); data.set("templateKey", "ENGAGEMENT"); data.set("userId", "forged"); return data; };
describe("web task template action", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "authenticated" }); mocks.apply.mockResolvedValue({ createdCount: 8, skippedCount: 0 }); });
  it("takes identity from the server and refreshes scoped task and overview pages", async () => {
    expect(await applyWeddingTaskTemplateAction("workspace", { status: "idle" }, form())).toEqual({ status: "success", message: "已加入 8 項任務，略過 0 項既有任務。" });
    expect(mocks.apply).toHaveBeenCalledWith("workspace", "authenticated", { templateKey: "ENGAGEMENT" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/workspaces/workspace/tasks");
  });
  it("reports committed success when refresh fails instead of inviting another write", async () => {
    mocks.revalidate.mockImplementation(() => { throw new Error("refresh failure"); });
    expect(await applyWeddingTaskTemplateAction("workspace", { status: "idle" }, form())).toEqual({ status: "success", message: "已加入 8 項任務，略過 0 項既有任務。請手動重新整理。" });
  });
  it("denies read-only users and sanitizes unexpected errors", async () => {
    mocks.apply.mockRejectedValueOnce(new WorkspaceAccessDeniedError());
    expect(await applyWeddingTaskTemplateAction("workspace", { status: "idle" }, form())).toMatchObject({ status: "error", message: "沒有這場婚宴的編輯權限。" });
    mocks.apply.mockRejectedValueOnce(new Error("private database details"));
    expect(await applyWeddingTaskTemplateAction("workspace", { status: "idle" }, form())).toMatchObject({ status: "error", message: "目前無法加入任務範本，請稍後再試。" });
  });
});
