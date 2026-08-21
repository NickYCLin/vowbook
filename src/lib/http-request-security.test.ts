import { describe, expect, it } from "vitest";
import {
  hasBoundedContentLength,
  isSameOriginMutationRequest,
} from "./http-request-security";

const invalidHeaders: Array<Record<string, string>> = [
  {},
  { origin: "null", host: "example.test" },
  { origin: "https://evil.test", host: "example.test" },
  { origin: "http://example.test", host: "example.test" },
  { origin: "https://example.test", host: "other.test" },
];

describe("same-origin mutation request contract", () => {
  it("accepts an exact same-origin request", () => {
    const request = new Request(
      "https://example.test/VowBook/api/workspaces/ws/budget/item/attachments",
      {
        method: "POST",
        headers: {
          host: "example.test",
          origin: "https://example.test",
        },
      },
    );

    expect(isSameOriginMutationRequest(request)).toBe(true);
  });

  it("accepts the trusted proxy scheme when Origin and Host still match", () => {
    const request = new Request(
      "http://127.0.0.1:3000/VowBook/api/workspaces/ws/budget/item/attachments",
      {
        method: "POST",
        headers: {
          host: "example.test",
          origin: "https://example.test",
          "x-forwarded-proto": "https",
        },
      },
    );

    expect(isSameOriginMutationRequest(request)).toBe(true);
  });

  it.each(invalidHeaders)(
    "rejects missing, opaque, cross-host, and cross-scheme origins",
    (headers) => {
      const request = new Request(
        "https://example.test/VowBook/api/workspaces/ws/budget/item/attachments",
        { method: "DELETE", headers },
      );

      expect(isSameOriginMutationRequest(request)).toBe(false);
    },
  );
});

describe("bounded request body contract", () => {
  it.each([undefined, "", "abc", "-1", "0", "1.5", "9007199254740992"])(
    "rejects a missing or invalid Content-Length: %s",
    (contentLength) => {
      const headers = new Headers();
      if (contentLength !== undefined) {
        headers.set("content-length", contentLength);
      }
      const request = new Request("https://example.test/upload", { headers });

      expect(hasBoundedContentLength(request, 100)).toBe(false);
    },
  );

  it("accepts only a positive integer not exceeding the configured bound", () => {
    expect(
      hasBoundedContentLength(
        new Request("https://example.test/upload", {
          headers: { "content-length": "100" },
        }),
        100,
      ),
    ).toBe(true);
    expect(
      hasBoundedContentLength(
        new Request("https://example.test/upload", {
          headers: { "content-length": "101" },
        }),
        100,
      ),
    ).toBe(false);
  });
});
