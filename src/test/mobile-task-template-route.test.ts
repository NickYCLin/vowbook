import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileRequestError } from "@/lib/mobile/protocol";
const mocks = vi.hoisted(() => ({ user: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/wedding-task-templates", () => ({ applyWeddingTaskTemplate: mocks.apply }));
import { POST } from "@/app/api/mobile/v1/workspaces/[workspaceId]/tasks/templates/route";
const context = { params: Promise.resolve({ workspaceId: "workspace" }) };
const request = () => new Request("https://example.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateKey: "RECEPTION" }) });
describe("mobile template route", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "authenticated" }); mocks.apply.mockResolvedValue({ createdCount: 10, skippedCount: 0 }); });
  it("uses only authenticated identity and route ownership", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith("workspace", "authenticated", { templateKey: "RECEPTION" });
  });
  it("requires a valid mobile session before any template mutation", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "請重新登入。"));
    expect((await POST(request(), context)).status).toBe(401);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
