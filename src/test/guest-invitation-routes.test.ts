import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ webUser: vi.fn(), mobileUser: vi.fn(), read: vi.fn(), submit: vi.fn(), manage: vi.fn(), scan: vi.fn(), image: vi.fn() }));
vi.mock("@/lib/api-current-user", () => ({ getApiCurrentUser: mocks.webUser }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.mobileUser }));
vi.mock("@/lib/guest-invitations", () => ({ readGuestInvitation: mocks.read, submitGuestInvitationReply: mocks.submit,
  loadGuestInvitationManagement: mocks.manage, issueGuestInvitation: vi.fn(), revokeGuestInvitation: vi.fn(), saveGuestInvitationSettings: vi.fn(), saveGuestVenueMap: vi.fn(), resolveGuestCheckInCode: mocks.scan, readGuestVenueMap: mocks.image }));
import { POST as view } from "@/app/api/guest-invitations/view/route";
import { POST as submit } from "@/app/api/guest-invitations/reply/route";
import { POST as map } from "@/app/api/guest-invitations/venue-map/route";
import { GET as webGet, POST as webPost } from "@/app/api/workspaces/[workspaceId]/guest-invitations/route";
import { POST as mobilePost } from "@/app/api/mobile/v1/workspaces/[workspaceId]/guest-invitations/route";
import { POST as scan } from "@/app/api/mobile/v1/workspaces/[workspaceId]/check-in/scan/route";
import { MobileRequestError } from "@/lib/mobile/protocol";
const context = { params: Promise.resolve({ workspaceId: "workspace" }) }, token = "a".repeat(43);
const guestRequest = (body?: unknown, bearer = token) => new Request("https://example.test/api/guest-invitations", { method: "POST", headers: { authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
describe("受限邀請 HTTP 邊界", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.webUser.mockResolvedValue({ id: "web" }); mocks.mobileUser.mockResolvedValue({ id: "mobile" }); mocks.read.mockResolvedValue({ guest: { name: "合成受邀組" } }); });
  it("只接受 Authorization 能力碼，不使用 query、Cookie 或 client 身分", async () => {
    expect((await view(new Request(`https://example.test/?token=${token}`, { method: "POST" }))).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
    const response = await view(guestRequest());
    expect(response.status).toBe(200); expect(mocks.read).toHaveBeenCalledWith(token);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("回覆資料有界且只交給能力碼對應的服務", async () => {
    mocks.submit.mockResolvedValue({ saved: true });
    const body = { formVersion: 0, responseVersion: 0, reply: {} };
    expect((await submit(guestRequest(body))).status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith(token, body);
    expect((await submit(guestRequest({ huge: "x".repeat(17000) }))).status).toBe(413);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("所有管理與掃碼操作都需要有效登入，不因存在訪客入口而繞過", async () => {
    mocks.webUser.mockResolvedValue(null);
    expect((await webGet(new Request("https://example.test"), context)).status).toBe(401);
    expect(mocks.manage).not.toHaveBeenCalled();
    mocks.mobileUser.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "請登入。"));
    expect((await mobilePost(guestRequest({ operation: "settings" }), context)).status).toBe(401);
    expect((await scan(guestRequest({ code: "other" }), context)).status).toBe(401);
    expect(mocks.scan).not.toHaveBeenCalled();
  });
  it("Cookie 管理寫入拒絕跨來源，且不輸出服務端錯誤", async () => {
    expect((await webPost(new Request("https://example.test", { method: "POST", headers: { host: "example.test", origin: "https://other.test" } }), context)).status).toBe(403);
    mocks.read.mockRejectedValue(new Error("private database details"));
    const response = await view(guestRequest()); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database details");
  });
  it("會館圖不可快取，僅傳回經驗證邀請的圖片", async () => {
    mocks.image.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const response = await map(guestRequest()); expect(response.status).toBe(200);
    expect(mocks.image).toHaveBeenCalledWith(token); expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
