import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("allows only same-origin embedding for the six authenticated print pages", async () => {
    const config = await loadNextConfig("/VowBook");
    const rules = (await config.headers?.()) ?? [];
    const embedded = rules.filter(rule => rule.headers.some(header => header.value === "frame-ancestors 'self'"));
    expect(embedded.map(rule => rule.source)).toEqual([
      "/workspaces/:workspaceId/tables/print",
      "/workspaces/:workspaceId/tables/chart",
      "/workspaces/:workspaceId/staff/print",
      "/workspaces/:workspaceId/gifts/print",
      "/workspaces/:workspaceId/budget/print",
      "/workspaces/:workspaceId/timeline/print",
    ]);
    for (const rule of embedded) expect(rule.headers).toContainEqual({ key: "X-Frame-Options", value: "SAMEORIGIN" });
  });

  it("lets every in-app print preview embed its target page", async () => {
    const config = await loadNextConfig("/VowBook");
    const rules = (await config.headers?.()) ?? [];
    const embeddable = new Set(rules.filter(rule => rule.headers.some(header => header.value === "frame-ancestors 'self'")).map(rule => rule.source));
    const sources = (readdirSync("src", { recursive: true }) as string[]).filter(file => file.endsWith(".tsx") && !file.includes(".test."));
    const targets = sources.flatMap(file => [...readFileSync(join("src", file), "utf8").matchAll(/<PrintPreviewLink\s+href=\{`\/workspaces\/\$\{workspaceId\}\/([^`]+)`\}/gu)].map(match => `/workspaces/:workspaceId/${match[1]}`));
    expect(targets.length).toBeGreaterThanOrEqual(6);
    for (const target of targets) expect(embeddable).toContain(target);
  });

  it("fails the build config for an invalid base path", async () => {
    await expect(loadNextConfig("/VowBook/")).rejects.toThrow(
      /NEXT_PUBLIC_BASE_PATH/,
    );
  });
});
