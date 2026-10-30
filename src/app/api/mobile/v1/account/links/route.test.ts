import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileRequestError } from "@/lib/mobile/protocol";

const mocks = vi.hoisted(() => ({ user: vi.fn(), hash: vi.fn(), prepare: vi.fn(), inspect: vi.fn(), apple: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user, mobileSessionHash: mocks.hash }));
vi.mock("@/lib/mobile/account-links", () => ({ prepareAccountLink: mocks.prepare, inspectAccountLink: mocks.inspect,
  stageAppleAccountLink: mocks.apple, confirmAccountLink: mocks.confirm }));
import { GET, POST, PATCH, PUT } from "./route";

const send = (method: string, body?: unknown) => new Request("https://example.test", {
  method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});

describe("authenticated account link API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: "authenticated-owner", email: "owner@example.test", appleSubject: "apple" });
    mocks.hash.mockReturnValue("authenticated-session");
    mocks.prepare.mockResolvedValue({ nonce: "n".repeat(43) });
    mocks.inspect.mockResolvedValue({ provider: "GOOGLE", email: "linked@example.test" });
    mocks.confirm.mockResolvedValue({ linked: true });
  });

  it("shows only the current user's linked methods, not provider subjects", async () => {
    const response = await GET(send("GET"));
    expect(await response.json()).toEqual({ email: "owner@example.test", apple: true, google: false });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("binds preparation to the authenticated user and device", async () => {
    expect((await POST(send("POST", { provider: "GOOGLE" }))).status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith("authenticated-owner", "authenticated-session", "GOOGLE");
  });

  it("cannot choose the target user, subject or email", async () => {
    for (const field of ["userId", "subject", "email", "sessionHash"]) {
      expect((await POST(send("POST", { provider: "GOOGLE", [field]: "forged" }))).status).toBe(400);
      expect((await PUT(send("PUT", { nonce: "nonce", [field]: "forged" }))).status).toBe(400);
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("requires Apple verification before displaying its confirmation", async () => {
    expect((await PATCH(send("PATCH", { nonce: "nonce", identityToken: "signed" }))).status).toBe(200);
    expect(mocks.apple).toHaveBeenCalledWith("authenticated-owner", "authenticated-session", "nonce", "signed");
    expect(mocks.inspect).toHaveBeenCalledWith("authenticated-owner", "authenticated-session", "nonce");
  });

  it("confirms only through the original authenticated device", async () => {
    expect((await PUT(send("PUT", { nonce: "nonce" }))).status).toBe(200);
    expect(mocks.confirm).toHaveBeenCalledWith("authenticated-owner", "authenticated-session", "nonce");
  });

  it.each([[GET, "GET"], [POST, "POST"], [PATCH, "PATCH"], [PUT, "PUT"]] as const)("requires a session for %s", async (handler, method) => {
    mocks.user.mockRejectedValue(new MobileRequestError(401, "UNAUTHORIZED", "請重新登入。"));
    expect((await handler(send(method, method === "GET" ? undefined : {}))).status).toBe(401);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.apple).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
