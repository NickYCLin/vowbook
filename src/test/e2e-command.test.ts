// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const projectRoot = process.cwd();

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(mode: string, exitCode = 0) {
  const root = mkdtempSync(path.join(tmpdir(), "vowbook e2e command "));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"));
  cpSync(
    path.join(projectRoot, "scripts/e2e-command.mjs"),
    path.join(root, "scripts/e2e-command.mjs"),
  );
  // Record the guard boundary: the runner must enter it before launching any tool.
  writeFileSync(path.join(root, "scripts/secret-free-command.mjs"), `
    console.log(JSON.stringify({ args: process.argv.slice(2), basePath: process.env.NEXT_PUBLIC_BASE_PATH }));
    process.exit(${exitCode});
  `);
  return spawnSync(process.execPath, [path.join(root, "scripts/e2e-command.mjs"), mode], {
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "/wrong-path" },
    encoding: "utf8",
  });
}

describe("cross-platform browser commands", () => {
  it.each([
    ["build", "node_modules/next/dist/bin/next", ["build"]],
    ["test", "scripts/playwright-command.mjs", ["test"]],
    ["crud", "scripts/crud-browser-command.mjs", []],
    ["attachments", "scripts/budget-attachment-browser-command.mjs", []],
  ] as const)("runs %s through the secret guard with the production subpath", (mode, script, args) => {
    const result = run(mode);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.basePath).toBe("/VowBook");
    expect(output.args).toEqual([
      "--",
      process.execPath,
      path.join(roots.at(-1)!, script),
      ...args,
    ]);
  });

  it("propagates a failed check instead of reporting success", () => {
    expect(run("test", 23).status).toBe(23);
  });

  it("rejects unknown commands before starting a tool", () => {
    const result = run("unknown");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unsupported E2E command.");
  });

  it("keeps npm browser scripts free of POSIX environment assignments", () => {
    const { scripts } = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    );
    for (const [name, command] of Object.entries(scripts)) {
      if (name.includes("test:e2e")) {
        expect(command).not.toMatch(/\b[A-Z_]+=\S+ /u);
      }
    }
  });
});
