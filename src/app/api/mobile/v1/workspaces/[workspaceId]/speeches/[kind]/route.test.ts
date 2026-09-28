import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/mobile/wedding-timeline", () => ({ mobileSaveWeddingSpeech: mocks.save }));

import { PUT } from "./route";
import { MobileRequestError } from "@/lib/mobile/protocol";

const context = { params: Promise.resolve({ workspaceId: "workspace_1", kind: "GROOM_PARENTS" }) };
const put = (value: unknown) =>
  new Request("https://example.test", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });

describe("手機謝親恩 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
  });

  it("認證失敗時不寫入", async () => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "重新登入"));
    expect((await PUT(put({ content: "爸、媽", expectedVersion: null }), context)).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("類型取自路徑，身分取自工作階段", async () => {
    mocks.save.mockResolvedValue({ kind: "GROOM_PARENTS", content: "爸、媽", version: 0 });
    expect((await PUT(put({ content: "爸、媽", expectedVersion: null }), context)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("workspace_1", "server-user", "GROOM_PARENTS", "爸、媽", null);
  });

  it("一定要帶版本，也不收其他欄位", async () => {
    expect((await PUT(put({ content: "爸、媽" }), context)).status).toBe(400);
    expect((await PUT(put({ content: "爸、媽", expectedVersion: 1, kind: "BRIDE_PARENTS" }), context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
