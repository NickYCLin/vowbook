import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), issue: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireCurrentUser: mocks.user }));
vi.mock("@/lib/mobile/session", () => ({ issueLoginGrant: mocks.issue }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { authorizeMobile } from "./actions";
function form() { const data = new FormData(); data.set("challenge", "C".repeat(43)); data.set("state", "S".repeat(43)); return data; }
describe("mobile consent", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); }); });
  it("never issues a code without a verified browser identity", async () => {
    mocks.user.mockRejectedValue(new Error("signin required"));
    await expect(authorizeMobile(form())).rejects.toThrow("signin required");
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("derives identity from the session and ignores injected callbacks and ownership", async () => {
    mocks.user.mockResolvedValue({ id: "verified" }); mocks.issue.mockResolvedValue("G".repeat(43));
    const data = form(); data.set("userId", "attacker"); data.set("redirect_uri", "https://evil.test");
    await expect(authorizeMobile(data)).rejects.toThrow("redirect:vowbook://oauth/callback");
    expect(mocks.issue).toHaveBeenCalledWith("verified", "C".repeat(43));
    expect(mocks.redirect).toHaveBeenCalledWith(`vowbook://oauth/callback?code=${"G".repeat(43)}&state=${"S".repeat(43)}`);
  });
  it("does not issue a grant for a malformed challenge", async () => {
    const data = form(); data.set("challenge", "weak");
    await expect(authorizeMobile(data)).rejects.toThrow();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
