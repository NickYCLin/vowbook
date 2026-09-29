import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/workspace-overview", () => ({ listWorkspaceOverviewsForUser: mocks.list }));
vi.mock("@/lib/create-workspace", () => ({ createWorkspaceForUser: mocks.create }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { GET, POST } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";
const request = (body: unknown) => new Request("https://example.test/api/mobile/v1/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
describe("mobile workspace API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "server-user" }); });
  it("does not read workspace data when authentication fails", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await GET(new Request("https://example.test"))).status).toBe(401);
    expect((await POST(request({ name: "婚宴" }))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("derives scope exclusively from the verified user and disables caching", async () => {
    mocks.list.mockResolvedValue([]);
    const response = await GET(new Request("https://example.test?userId=other&workspaceId=other"));
    expect(mocks.list).toHaveBeenCalledWith("server-user");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ workspaces: [], systemAdmin: false });
  });
  it("rejects injected ownership, role and workspace fields", async () => {
    for (const field of ["userId", "createdById", "role", "workspaceId"]) {
      expect((await POST(request({ name: "我們的婚宴", [field]: "other" }))).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("creates using the shared website service and validated input", async () => {
    mocks.create.mockResolvedValue({ id: "new" });
    const response = await POST(request({ name: " 我們的婚宴 ", weddingDate: "2027-01-01" }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("server-user", { name: "我們的婚宴", weddingDate: new Date("2027-01-01"), timezone: "Asia/Taipei" });
  });
  it("rejects invalid dates, timezone and oversized streamed bodies", async () => {
    for (const fields of [{ weddingDate: "2027-02-30" }, { timezone: "Europe/London" }]) {
      expect((await POST(request({ name: "婚宴", ...fields }))).status).toBe(400);
    }
    expect((await POST(request({ name: "A".repeat(5000) }))).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not leak internal errors", async () => {
    mocks.list.mockRejectedValue(new Error("private database details"));
    const response = await GET(new Request("https://example.test"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private database");
  });
});
