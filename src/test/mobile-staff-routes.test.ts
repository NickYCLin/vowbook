import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileRequestError } from "@/lib/mobile/protocol";
const mocks = vi.hoisted(() => ({ user: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), list: vi.fn(), sent: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/wedding-staff", () => ({ mobileCreateStaff: mocks.create, mobileUpdateStaff: mocks.update, mobileDeleteStaff: mocks.remove }));
vi.mock("@/lib/mobile/workspace-data", () => ({ mobileStaffList: mocks.list, mobileSetRedEnvelopeSent: mocks.sent }));
import { POST } from "@/app/api/mobile/v1/workspaces/[workspaceId]/staff/route";
import { PUT, DELETE } from "@/app/api/mobile/v1/workspaces/[workspaceId]/staff/[staffId]/route";

const context = { params: Promise.resolve({ workspaceId: "workspace", staffId: "staff" }) };
const request = (method: string) => new Request("https://example.test", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: 2 }) });
describe("staff mutation routes", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "authenticated" });
    mocks.create.mockResolvedValue({ id: "staff", version: 0 });
    mocks.update.mockResolvedValue({ id: "staff", version: 3 });
    mocks.remove.mockResolvedValue({ deleted: true });
  });
  it("uses authenticated identity and route workspace for create, edit and removal", async () => {
    expect((await POST(request("POST"), context)).status).toBe(201);
    expect((await PUT(request("PUT"), context)).status).toBe(200);
    expect((await DELETE(request("DELETE"), context)).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith("workspace", "authenticated", { expectedVersion: 2 });
    expect(mocks.update).toHaveBeenCalledWith("workspace", "authenticated", "staff", { expectedVersion: 2 });
    expect(mocks.remove).toHaveBeenCalledWith("workspace", "authenticated", "staff", { expectedVersion: 2 });
  });
  it.each([[POST, "POST"], [PUT, "PUT"], [DELETE, "DELETE"]] as const)("requires authentication: %s", async (handler, method) => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "請重新登入。"));
    expect((await handler(request(method), context)).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not expose internal failures", async () => {
    mocks.update.mockRejectedValue(new Error("private connection information"));
    const response = await PUT(request("PUT"), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private connection information");
  });
});
