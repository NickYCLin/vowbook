import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  overrides?: Record<string, string | Record<string, string>>;
};

type PackageLock = {
  packages?: Record<string, { version?: string }>;
};

describe("dependency security overrides", () => {
  it("keeps deepmerge-ts on the patched 8.x line used by Prisma config", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as PackageManifest;
    const lock = JSON.parse(
      readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8"),
    ) as PackageLock;

    const override = manifest.overrides?.["deepmerge-ts"];
    const installed = lock.packages?.["node_modules/deepmerge-ts"]?.version;

    expect(typeof override).toBe("string");
    expect(installed).toBe(override);
    expect(Number(installed?.split(".")[0])).toBeGreaterThanOrEqual(8);
  });
});
