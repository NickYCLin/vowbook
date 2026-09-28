import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), timeline: vi.fn(), create: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({ mobileTimeline: mocks.timeline }));
vi.mock("@/lib/mobile/wedding-timeline", async (original) => ({
  ...(await original<typeof import("@/lib/mobile/wedding-timeline")>()),
  mobileCreateTimelineItem: mocks.create,
}));

import { GET, POST } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };

describe("手機婚禮總流程 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不讀取流程", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await GET(new Request("https://example.test"), context)).status).toBe(401);
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it("身分只取自已驗證的工作階段，且不快取", async () => {
    mocks.timeline.mockResolvedValue({ items: [], games: { BOUQUET: [], BROCCOLI: [] } });
    const response = await GET(new Request("https://example.test?userId=other"), context);
    expect(mocks.timeline).toHaveBeenCalledWith("workspace_1", "server-user");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("不外洩內部錯誤細節", async () => {
    mocks.timeline.mockRejectedValue(new Error("private database details"));
    const response = await GET(new Request("https://example.test"), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });

  it("新增流程只收白名單欄位，不收工作人員或工作區", async () => {
    const post = (value: unknown) => new Request("https://example.test", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
    });
    const item = { startTime: "12:00", phase: "進場", title: "第一次進場" };
    for (const field of ["workspaceId", "staffIds", "userId", "version"]) {
      expect((await POST(post({ ...item, [field]: "x" }), context)).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.create.mockResolvedValue({ id: "item_1", title: "第一次進場", version: 0 });
    const response = await POST(post(item), context);
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("workspace_1", "server-user", item);
  });
});
