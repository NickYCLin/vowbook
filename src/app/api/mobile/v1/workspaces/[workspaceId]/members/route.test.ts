import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/workspace-invitations", () => ({ loadWorkspaceMembersForUser: mocks.load }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { GET } from "./route";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };
const request = () => new Request("https://example.test");

describe("手機協作者 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("擁有者看得到 Email 與等待中的邀請", async () => {
    mocks.load.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "婚宴" },
      members: [{ role: "OWNER", displayName: "阿倫", email: "a@example.test", management: { membershipId: "m1", updatedAt: "x" } }],
      pendingInvitations: [{ id: "i1", email: "b@example.test", role: "PLANNER", version: 0, createdAt: "c", expiresAt: "2026-10-01T00:00:00.000Z" }],
    });
    const body = await (await GET(request(), context)).json();
    expect(mocks.load).toHaveBeenCalledWith("workspace_1", "server-user");
    expect(body.members).toEqual([{ displayName: "阿倫", role: "OWNER", email: "a@example.test" }]);
    expect(body.pendingInvitations).toEqual([
      { id: "i1", email: "b@example.test", role: "PLANNER", expiresAt: "2026-10-01T00:00:00.000Z" },
    ]);
    expect(JSON.stringify(body)).not.toContain("m1");
  });

  it("不是擁有者就只有名字與角色", async () => {
    mocks.load.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "婚宴" },
      members: [{ role: "OWNER", displayName: "阿倫", email: "leak@example.test" }],
      pendingInvitations: [{ id: "i1", email: "leak2@example.test", role: "PLANNER", version: 0, createdAt: "c", expiresAt: "e" }],
    });
    const body = await (await GET(request(), context)).json();
    expect(body.members).toEqual([{ displayName: "阿倫", role: "OWNER", email: null }]);
    expect(body.pendingInvitations).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("leak");
  });

  it("沒有權限回 403，不說成伺服器壞了", async () => {
    mocks.load.mockRejectedValue(new WorkspaceAccessDeniedError());
    expect((await GET(request(), context)).status).toBe(403);
  });

  it("其他錯誤不外洩", async () => {
    mocks.load.mockRejectedValue(new Error("private database details"));
    const response = await GET(request(), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
