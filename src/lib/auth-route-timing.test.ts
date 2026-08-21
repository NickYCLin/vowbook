import { describe, expect, it, vi } from "vitest";
import { createTimedAuthHandler } from "./auth-route-timing";

describe("createTimedAuthHandler", () => {
  it("reports only an allowlisted auth phase and rounded duration", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302 }));
    const logger = vi.fn();
    const now = vi
      .fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(142.345);
    const timed = createTimedAuthHandler(handler, { logger, now });

    const response = await timed(
      new Request(
        "https://example.test/VowBook/api/auth/callback/google?code=secret&email=private",
      ),
      { params: Promise.resolve({ nextauth: ["callback", "google"] }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("server-timing")).toBe(
      'vowbook_auth;dur=42.3;desc="callback_google"',
    );
    expect(logger).toHaveBeenCalledWith("auth_timing", {
      durationMs: 42.3,
      method: "GET",
      phase: "callback_google",
      status: 302,
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("private");
  });

  it("adds timing to immutable redirects without losing headers or cookies", async () => {
    const redirect = Response.redirect(
      "https://example.test/VowBook/dashboard",
      302,
    );
    const sourceHeaders = new Headers(redirect.headers);
    sourceHeaders.append("Server-Timing", 'upstream;dur=1;desc="nextauth"');
    sourceHeaders.append(
      "Set-Cookie",
      "__Secure-vowbook.session-token=one; Path=/VowBook; HttpOnly",
    );
    sourceHeaders.append(
      "Set-Cookie",
      "__Secure-vowbook.callback-url=two; Path=/VowBook; HttpOnly",
    );
    const immutableRedirect = new Response(null, {
      headers: sourceHeaders,
      status: redirect.status,
      statusText: redirect.statusText,
    });
    const immutableHeaders = new Proxy(immutableRedirect.headers, {
      get(target, property) {
        if (property === "append") {
          return () => {
            throw new TypeError("immutable");
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    Object.defineProperty(immutableRedirect, "headers", {
      value: immutableHeaders,
    });

    const response = await createTimedAuthHandler(
      vi.fn().mockResolvedValue(immutableRedirect),
      { now: () => 10 },
    )(
      new Request(
        "https://example.test/VowBook/api/auth/callback/google",
      ),
      { params: { nextauth: ["callback", "google"] } },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://example.test/VowBook/dashboard",
    );
    expect(response.headers.get("server-timing")).toContain(
      'upstream;dur=1;desc="nextauth"',
    );
    expect(response.headers.get("server-timing")).toContain(
      'vowbook_auth;dur=0;desc="callback_google"',
    );
    const cookies = response.headers.get("set-cookie");
    expect(cookies).toContain("__Secure-vowbook.session-token=one");
    expect(cookies).toContain("__Secure-vowbook.callback-url=two");
    const setCookies = (
      response.headers as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie?.();
    expect(setCookies).toEqual([
      "__Secure-vowbook.session-token=one; Path=/VowBook; HttpOnly",
      "__Secure-vowbook.callback-url=two; Path=/VowBook; HttpOnly",
    ]);
  });

  it("uses a generic label for unknown paths and logs failures without error details", async () => {
    const logger = vi.fn();
    const now = vi
      .fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(22.04);
    const timed = createTimedAuthHandler(
      vi.fn().mockRejectedValue(new Error("token cookie email")),
      { logger, now },
    );

    await expect(
      timed(new Request("https://example.test/private"), {
        params: Promise.resolve({ nextauth: ["unexpected", "private"] }),
      }),
    ).rejects.toThrow("token cookie email");
    expect(logger).toHaveBeenCalledWith("auth_timing", {
      durationMs: 12,
      method: "GET",
      phase: "other",
      status: 500,
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("token cookie email");
  });
});
