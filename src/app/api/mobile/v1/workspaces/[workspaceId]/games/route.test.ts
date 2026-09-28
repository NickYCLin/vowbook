import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), add: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/wedding-games", () => ({ mobileAddGameParticipants: mocks.add }));

import { POST } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };
const post = (value: unknown) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

describe("手機遊戲名單新增 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不寫入", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await POST(post({ game: "BOUQUET", names: "小美" }), context)).status).toBe(401);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("工作區與身分只取自路徑和工作階段", async () => {
    mocks.add.mockResolvedValue({ added: 2 });
    const response = await POST(post({ game: "BOUQUET", names: "小美、阿華" }), context);
    expect(response.status).toBe(201);
    expect(mocks.add).toHaveBeenCalledWith("workspace_1", "server-user", "BOUQUET", "小美、阿華");
  });

  it("拒絕多餘欄位", async () => {
    for (const field of ["workspaceId", "userId", "sortOrder", "role"]) {
      const response = await POST(post({ game: "BOUQUET", names: "小美", [field]: "x" }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
