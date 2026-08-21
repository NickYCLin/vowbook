import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadNextConfig(basePath: string) {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
  vi.resetModules();

  return (await import("../../next.config")).default;
}

describe("Next.js deployment config", () => {
  it("uses an empty base path by default without assetPrefix", async () => {
    const config = await loadNextConfig("");

    expect(config.basePath).toBe("");
    expect(config.output).toBe("standalone");
    expect(config).not.toHaveProperty("assetPrefix");
  });

  it("uses the validated /VowBook deployment base path", async () => {
    const config = await loadNextConfig("/VowBook");

    expect(config.basePath).toBe("/VowBook");
    expect(config).not.toHaveProperty("assetPrefix");
  });

  it("prevents the authenticated attachment preview shell from being framed", async () => {
    const config = await loadNextConfig("/VowBook");
    const headers = await config.headers?.();

    expect(headers).toContainEqual({
      source:
        "/workspaces/:workspaceId/budget/:budgetItemId/attachments/:attachmentId/preview",
      headers: expect.arrayContaining([
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors 'none'",
        },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cache-Control", value: "private, no-store" },
      ]),
    });
  });

  it("fails the build config for an invalid base path", async () => {
    await expect(loadNextConfig("/VowBook/")).rejects.toThrow(
      /NEXT_PUBLIC_BASE_PATH/,
    );
  });
});
