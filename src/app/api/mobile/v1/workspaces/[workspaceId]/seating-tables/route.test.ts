import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/seating-tables", async (original) => ({
  ...(await original<typeof import("@/lib/mobile/seating-tables")>()),
  mobileCreateSeatingTable: mocks.create,
  mobileUpdateSeatingTable: mocks.update,
  mobileDeleteSeatingTable: mocks.remove,
}));
vi.mock("server-only", () => ({}));

import { POST } from "./route";
import { DELETE, PATCH } from "./[tableId]/route";

const send = (method: string, value: unknown) =>
  new Request("https://example.test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

describe("手機桌次 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.create.mockResolvedValue({ id: "t1" });
    mocks.update.mockResolvedValue({ id: "t1" });
    mocks.remove.mockResolvedValue({ deleted: true });
  });

  it("新增只收桌名、座位數、備註", async () => {
    const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };
    expect((await POST(send("POST", { name: "主桌", capacity: 10 }), context)).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("workspace_1", "server-user", { name: "主桌", capacity: 10 });
    for (const field of ["position", "layoutX", "workspaceId", "userId"]) {
      expect((await POST(send("POST", { name: "主桌", capacity: 10, [field]: 1 }), context)).status).toBe(400);
    }
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("修改的桌次 id 只看路徑", async () => {
    const context = { params: Promise.resolve({ workspaceId: "workspace_1", tableId: "t1" }) };
    const body = { name: "主桌", capacity: 12, notes: "", expectedVersion: 2 };
    expect((await PATCH(send("PATCH", body), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("workspace_1", "server-user", "t1", body);
    expect((await PATCH(send("PATCH", { ...body, id: "t9" }), context)).status).toBe(400);
  });

  it("刪除只收版本，其他欄位一概不理", async () => {
    const context = { params: Promise.resolve({ workspaceId: "workspace_1", tableId: "t1" }) };
    expect((await DELETE(send("DELETE", { expectedVersion: 2 }), context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("workspace_1", "server-user", "t1", { expectedVersion: 2 });
    for (const field of ["tableId", "workspaceId", "userId", "name"]) {
      expect((await DELETE(send("DELETE", { expectedVersion: 2, [field]: "x" }), context)).status).toBe(400);
    }
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});