import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({ mobileTaskList: mocks.list, mobileCreateTask: mocks.create }));

import { POST } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };
const post = (value: unknown) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
const task = { title: "訂喜餅", description: null, dueDate: "2026-10-01", side: "SHARED" };

describe("手機新增任務 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.create.mockResolvedValue({ id: "task_1", title: "訂喜餅", version: 0 });
  });

  it("新增成功回 201", async () => {
    expect((await POST(post(task), context)).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("workspace_1", "server-user", task);
  });

  it("不能直接指定狀態、版本或歸屬", async () => {
    for (const field of ["status", "completedAt", "version", "workspaceId", "userId"]) {
      expect((await POST(post({ ...task, [field]: "x" }), context)).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("認證失敗不寫入", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await POST(post(task), context)).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
