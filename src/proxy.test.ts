import { describe, expect, it, vi } from "vitest";

const next = vi.hoisted(() => {
  const response = { headers: new Headers() };

  return {
    response,
    next: vi.fn(() => response),
  };
});

vi.mock("next/server", () => ({
  NextResponse: { next: next.next },
}));

import { config, proxy } from "./proxy";

describe("landing cache proxy", () => {
  it("matches only the app-relative landing path", () => {
    expect(config).toEqual({ matcher: "/" });
  });

  it("prevents edge caches from retaining landing HTML across asset revisions", () => {
    const response = proxy();

    expect(next.next).toHaveBeenCalledOnce();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
