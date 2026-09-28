import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/workspace-data", () => ({ mobileGuestList: mocks.list, mobileCreateGuest: mocks.create }));

import { POST } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1" }) };
const post = (value: unknown) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
const guest = { name: "王小明", side: "PARTNER_A", attendanceStatus: "ATTENDING", partySize: 2 };

describe("手機新增賓客 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.create.mockResolvedValue({ id: "guest_1", name: "王小明", version: 0 });
  });

  it("新增成功回 201，婚宴與身分只取自路徑和登入", async () => {
    const response = await POST(post(guest), context);
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("workspace_1", "server-user", guest);
  });

  it("拒絕白名單以外的欄位", async () => {
    for (const field of ["userId", "workspaceId", "role", "seatingTableId", "version"]) {
      expect((await POST(post({ ...guest, [field]: "x" }), context)).status).toBe(400);
    }
    expect((await POST(post([guest]), context)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("認證失敗不寫入", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await POST(post(guest), context)).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("不外洩內部錯誤", async () => {
    mocks.create.mockRejectedValue(new Error("private database details"));
    const response = await POST(post(guest), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
