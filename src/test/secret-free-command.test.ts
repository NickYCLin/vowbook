import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const sandboxRoots: string[] = [];
const runner = path.join(
  process.cwd(),
  "scripts",
  "secret-free-command.mjs",
);

function sandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vowbook-secret-free-test-"));
  sandboxRoots.push(root);
  writeFileSync(path.join(root, ".env"), "test-only-env-one\n", "utf8");
  writeFileSync(path.join(root, ".env.local"), "test-only-env-two\n", "utf8");
  writeFileSync(path.join(root, ".envrc"), "test-only-env-three\n", "utf8");
  writeFileSync(
    path.join(root, ".envrc.local"),
    "test-only-env-four\n",
    "utf8",
  );
  return root;
}

function run(root: string, source: string) {
  return spawnSync(
    process.execPath,
    [runner, "--root", root, "--", process.execPath, "-e", source],
    { encoding: "utf8" },
  );
}

afterEach(() => {
  for (const root of sandboxRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("secret-free command runner", () => {
  it("hides root environment files from the child then restores every file on success", () => {
    const root = sandbox();

    const result = run(
      root,
      'const fs = require("node:fs"); const names = fs.readdirSync("."); process.exit([".env", ".env.local", ".envrc", ".envrc.local"].some((name) => names.includes(name)) ? 1 : 0);',
    );

    expect(result.status).toBe(0);
    expect(readdirSync(root)).toContain(".env");
    expect(readdirSync(root)).toContain(".env.local");
    expect(
      readdirSync(path.dirname(root)).filter((name) =>
        name.startsWith(".vowbook-dotenv-hidden-"),
      ),
    ).toEqual([]);
  });

  it("keeps files isolated until a SIGTERM-stopped child has exited, then restores them", async () => {
    const root = sandbox();
    const child = spawn(
      process.execPath,
      [
        runner,
        "--root",
        root,
        "--",
        process.execPath,
        "-e",
        'const fs = require("node:fs"); fs.writeFileSync("child-ready", "ready"); setInterval(() => {}, 1000);',
      ],
      { stdio: "ignore" },
    );

    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("secret-free child did not become ready")),
        2_000,
      );
      const poll = () => {
        if (readdirSync(root).includes("child-ready")) {
          clearTimeout(deadline);
          resolve();
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });

    expect(readdirSync(root)).not.toContain(".env");
    expect(readdirSync(root)).not.toContain(".env.local");
    child.kill("SIGTERM");
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    });

    expect(result).toEqual({ code: 143, signal: null });
    expect(readdirSync(root)).toContain(".env");
    expect(readdirSync(root)).toContain(".env.local");
    expect(
      readdirSync(path.dirname(root)).filter((name) =>
        name.startsWith(".vowbook-dotenv-hidden-"),
      ),
    ).toEqual([]);
  });

  it("keeps root environment files hidden until SIGTERM-ignoring group descendants are gone", async () => {
    const root = sandbox();
    const descendantPidPath = path.join(root, "descendant.pid");
    const descendantSource =
      'const fs = require("node:fs"); process.on("SIGTERM", () => {}); fs.writeFileSync("descendant-ready", "ready"); setInterval(() => {}, 1000);';
    const parentSource = [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      `const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}], { stdio: "ignore" });`,
      'fs.writeFileSync("descendant.pid", String(descendant.pid));',
      'fs.writeFileSync("child-ready", "ready");',
      'process.on("SIGTERM", () => process.exit(0));',
      'setInterval(() => {}, 1000);',
    ].join(" ");
    const runnerProcess = spawn(
      process.execPath,
      [
        runner,
        "--root",
        root,
        "--",
        process.execPath,
        "-e",
        parentSource,
      ],
      { stdio: "ignore" },
    );

    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("descendant fixture did not become ready")),
        2_000,
      );
      const poll = () => {
        const entries = readdirSync(root);
        if (
          entries.includes("child-ready") &&
          entries.includes("descendant-ready")
        ) {
          clearTimeout(deadline);
          resolve();
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });

    runnerProcess.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(readdirSync(root)).not.toContain(".env");
    expect(readdirSync(root)).not.toContain(".envrc");

    try {
      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        runnerProcess.once("close", (code, signal) => resolve({ code, signal }));
      });
      expect(result).toEqual({ code: 143, signal: null });
      expect(readdirSync(root)).toContain(".env");
      expect(readdirSync(root)).toContain(".envrc");
    } finally {
      const descendantPid = Number.parseInt(
        readFileSync(descendantPidPath, "utf8"),
        10,
      );
      if (Number.isInteger(descendantPid)) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {
          // The fixed runner already stopped it.
        }
      }
    }
  }, 8_000);

  it("keeps root environment files hidden until normal-exit group descendants are gone", async () => {
    const root = sandbox();
    const descendantSource = [
      'const fs = require("node:fs");',
      'fs.writeFileSync("normal-descendant-ready", "ready");',
      'setTimeout(() => fs.writeFileSync("normal-descendant-visible", String(fs.readdirSync(".").includes(".env"))), 150);',
    ].join(" ");
    const parentSource = [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}], { stdio: "ignore" });`,
      'const poll = setInterval(() => { if (fs.existsSync("normal-descendant-ready")) { clearInterval(poll); process.exit(0); } }, 5);',
    ].join(" ");
    const runnerProcess = spawn(
      process.execPath,
      [
        runner,
        "--root",
        root,
        "--",
        process.execPath,
        "-e",
        parentSource,
      ],
      { stdio: "ignore" },
    );

    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("normal-exit descendant did not become ready")),
        2_000,
      );
      const poll = () => {
        if (readdirSync(root).includes("normal-descendant-ready")) {
          clearTimeout(deadline);
          resolve();
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });

    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      runnerProcess.once("close", (code, signal) => resolve({ code, signal }));
    });
    expect(result).toEqual({ code: 0, signal: null });
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("normal-exit descendant did not record visibility")),
        2_000,
      );
      const poll = () => {
        if (readdirSync(root).includes("normal-descendant-visible")) {
          clearTimeout(deadline);
          resolve();
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });
    expect(readFileSync(path.join(root, "normal-descendant-visible"), "utf8")).toBe(
      "false",
    );
    expect(readdirSync(root)).toContain(".env");
    expect(readdirSync(root)).toContain(".envrc");
  });

  it.skipIf(process.platform !== "linux")(
    "keeps root environment files hidden for a setsid daemon after its parent exits",
    async () => {
      const root = sandbox();
      const daemonSource = [
        'const fs = require("node:fs");',
        'fs.writeFileSync("daemon-ready", "ready");',
        'setTimeout(() => fs.writeFileSync("daemon-visible", String(fs.existsSync(".env") || fs.existsSync(".envrc"))), 150);',
      ].join(" ");
      const parentSource = [
        'const { spawn } = require("node:child_process");',
        `const daemon = spawn(process.execPath, ["-e", ${JSON.stringify(daemonSource)}], { detached: true, stdio: "ignore" });`,
        'daemon.unref();',
        'process.exit(0);',
      ].join(" ");
      const runnerProcess = spawn(
        process.execPath,
        [
          runner,
          "--root",
          root,
          "--",
          process.execPath,
          "-e",
          parentSource,
        ],
        { stdio: "ignore" },
      );

      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        runnerProcess.once("close", (code, signal) => resolve({ code, signal }));
      });
      expect(result).toEqual({ code: 0, signal: null });
      expect(readFileSync(path.join(root, "daemon-visible"), "utf8")).toBe(
        "false",
      );
      expect(readdirSync(root)).toContain(".env");
      expect(readdirSync(root)).toContain(".envrc");
    },
    4_000,
  );

  it("serializes concurrent commands in one root until the first child has restored files", async () => {
    const root = sandbox();
    const first = spawn(
      process.execPath,
      [
        runner,
        "--root",
        root,
        "--",
        process.execPath,
        "-e",
        'const fs = require("node:fs"); fs.writeFileSync("first-ready", "ready"); setInterval(() => {}, 1000);',
      ],
      { stdio: "ignore" },
    );
    let second: ReturnType<typeof spawn> | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(new Error("first secret-free command did not become ready")),
          2_000,
        );
        const poll = () => {
          if (readdirSync(root).includes("first-ready")) {
            clearTimeout(deadline);
            resolve();
            return;
          }
          setTimeout(poll, 10);
        };
        poll();
      });

      second = spawn(
        process.execPath,
        [
          runner,
          "--root",
          root,
          "--",
          process.execPath,
          "-e",
          'const fs = require("node:fs"); const visible = fs.existsSync(".env") || fs.existsSync(".envrc"); fs.writeFileSync("second-ran", "ran"); process.exit(visible ? 1 : 0);',
        ],
        { stdio: "ignore" },
      );
      const secondProcess = second;

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(readdirSync(root)).not.toContain("second-ran");
      expect(readdirSync(root)).not.toContain(".env");
      expect(readdirSync(root)).not.toContain(".envrc");

      const firstExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        first.once("close", (code, signal) => resolve({ code, signal }));
      });
      const secondExit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        secondProcess.once("close", (code, signal) => resolve({ code, signal }));
      });
      first.kill("SIGTERM");

      expect(await firstExit).toEqual({ code: 143, signal: null });
      expect(await secondExit).toEqual({ code: 0, signal: null });
      expect(readdirSync(root)).toContain("second-ran");
      expect(readdirSync(root)).toContain(".env");
      expect(readdirSync(root)).toContain(".envrc");
    } finally {
      first.kill("SIGKILL");
      second?.kill("SIGKILL");
    }
  });

  it("restores root environment files after a child failure", () => {
    const root = sandbox();

    const result = run(root, "process.exit(7);");

    expect(result.status).toBe(7);
    expect(readdirSync(root)).toContain(".env");
    expect(readdirSync(root)).toContain(".env.local");
    expect(
      readdirSync(path.dirname(root)).filter((name) =>
        name.startsWith(".vowbook-dotenv-hidden-"),
      ),
    ).toEqual([]);
  });
});
