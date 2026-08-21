import { spawn } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const guardPath = path.join(scriptDirectory, "deny-env-file-access.mjs");
const subreaperPath = path.join(scriptDirectory, "secret-free-subreaper.py");
const SUBREAPER_MARKER = "VOWBOOK_SECRET_FREE_SUBREAPER";
const LOCK_NAME = ".vowbook-secret-free.lock";
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 30_000;

function usage() {
  throw new Error(
    "Usage: node scripts/secret-free-command.mjs [--root <directory>] -- <command> [args...]",
  );
}

function isRootEnvironmentName(name) {
  return name.startsWith(".env");
}

function parseArguments(argv) {
  let root = process.cwd();
  let index = 0;
  if (argv[index] === "--root") {
    const requestedRoot = argv[index + 1];
    if (!requestedRoot) usage();
    root = requestedRoot;
    index += 2;
  }
  if (argv[index] !== "--" || !argv[index + 1]) usage();
  return {
    root: path.resolve(root),
    command: argv[index + 1],
    args: argv.slice(index + 2),
  };
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireRootLock(root) {
  const lockPath = path.join(root, LOCK_NAME);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      return lockPath;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting for another secret-free command in this repository.",
        );
      }
      await pause(LOCK_RETRY_MS);
    }
  }
}

function hiddenDirectory(root) {
  // rename(2) is the only safe relocation primitive here: copy/delete would
  // duplicate sensitive bytes. Reserve the private hold beside the repo so it
  // is guaranteed to be on the same filesystem as root.
  const directory = mkdtempSync(
    path.join(path.dirname(root), ".vowbook-dotenv-hidden-"),
  );
  chmodSync(directory, 0o700);
  if (statSync(directory).dev !== statSync(root).dev) {
    rmdirSync(directory);
    throw new Error("Environment-file holding directory is not on root's filesystem.");
  }
  return directory;
}

function pathExists(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function rootEnvironmentEntries(root) {
  return readdirSync(root).filter((name) => {
    if (!isRootEnvironmentName(name)) return false;
    const entry = lstatSync(path.join(root, name));
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      throw new Error("Refusing to move a non-file root environment entry.");
    }
    return true;
  });
}

function restoreEnvironmentFiles(root, hold, moved) {
  let failure = null;
  for (const name of moved) {
    const source = path.join(hold, name);
    const destination = path.join(root, name);
    if (!pathExists(source)) continue;
    if (pathExists(destination)) {
      failure ??= new Error(
        "Refusing to overwrite an environment file while restoring it; the original remains in the private holding directory.",
      );
      continue;
    }
    renameSync(source, destination);
  }

  if (!failure) {
    const remaining = readdirSync(hold);
    if (remaining.length !== 0) {
      failure = new Error(
        "Environment-file restoration left unexpected entries in the private holding directory.",
      );
    }
  }
  if (!failure) rmdirSync(hold);
  if (failure) throw failure;
}

/**
 * npm 在 Windows 只把套件的 bin 裝成 node_modules/.bin/<name>.cmd，
 * spawn() 不加 shell 找不到它（ENOENT），而 Node 18.20 起又拒絕在沒有
 * shell 的情況下執行 .cmd（CVE-2024-27980 的防護，會得到 EINVAL）。
 *
 * 與其開 shell: true 讓引數得重新處理跳脫，不如直接找出套件宣告的 bin
 * 進入點，改用目前這支 node 執行。解析不到就原樣交給 spawn，由 PATH 決定。
 */
function resolveNodeBin(root, command, args) {
  if (process.platform !== "win32" || command.includes("/") || command.includes("\\")) {
    return { command, args };
  }
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(
        path.join(root, "node_modules", command, "package.json"),
        "utf8",
      ),
    );
  } catch {
    return { command, args };
  }
  const entry =
    typeof manifest.bin === "string"
      ? manifest.bin
      : manifest.bin?.[command];
  if (typeof entry !== "string") return { command, args };
  const binPath = path.join(root, "node_modules", command, entry);
  try {
    if (!statSync(binPath).isFile()) return { command, args };
  } catch {
    return { command, args };
  }
  return { command: process.execPath, args: [binPath, ...args] };
}

function signalExitCode(signal) {
  if (signal === "SIGHUP") return 129;
  if (signal === "SIGINT") return 130;
  return 143;
}

async function enterLinuxSubreaper() {
  if (process.platform !== "linux" || process.env[SUBREAPER_MARKER] === "1") {
    return false;
  }
  const child = spawn(
    "python3",
    [subreaperPath, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      detached: true,
      env: { ...process.env, [SUBREAPER_MARKER]: "1" },
      stdio: "inherit",
    },
  );
  let requestedSignal = null;
  const forwardSignal = (signal) => {
    requestedSignal ??= signal;
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ESRCH")) {
        throw error;
      }
    }
  };
  process.once("SIGHUP", () => forwardSignal("SIGHUP"));
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  process.exit(
    result.code ?? (requestedSignal ? signalExitCode(requestedSignal) : 1),
  );
}

if (await enterLinuxSubreaper()) process.exit(1);

const { root, command, args } = parseArguments(process.argv.slice(2));
const lock = await acquireRootLock(root);
let hold = null;
const moved = [];
let restored = false;
let requestedSignal = null;
let child = null;
let stopTimer = null;

function restoreOrThrow() {
  if (restored) return;
  restored = true;
  if (hold) restoreEnvironmentFiles(root, hold, moved);
}

function stopChild(signal) {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
      return;
    }
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ESRCH")) {
      throw error;
    }
    return;
  }
  child.kill(signal);
}

function processGroupExists(processGroupId) {
  if (process.platform === "linux") {
    // The wrapper is a PR_SET_CHILD_SUBREAPER, so an orphaned daemon is
    // reparented here even when it calls setsid() and leaves its original PGID.
    // Keep dotenv files isolated until every non-zombie descendant is gone.
    const processes = new Map();
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/u.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        const closingParenthesis = stat.lastIndexOf(")");
        if (closingParenthesis < 0) continue;
        const fields = stat.slice(closingParenthesis + 2).trim().split(/\s+/u);
        processes.set(Number(entry), {
          parentPid: Number(fields[1]),
          state: fields[0],
        });
      } catch {
        // A process may exit between listing /proc and reading stat.
      }
    }
    const descendants = [process.pid];
    for (let index = 0; index < descendants.length; index += 1) {
      const parentPid = descendants[index];
      for (const [pid, processInfo] of processes) {
        if (processInfo.parentPid !== parentPid) continue;
        descendants.push(pid);
        if (processInfo.state !== "Z" && processInfo.state !== "X") {
          return true;
        }
      }
    }
    return false;
  }
  if (process.platform === "win32") return false;
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitForProcessGroupExit(processGroupId) {
  while (processGroupExists(processGroupId)) {
    await pause(LOCK_RETRY_MS);
  }
}

function scheduleForceStop() {
  if (stopTimer || !child?.pid) return;
  stopTimer = setTimeout(() => stopChild("SIGKILL"), 5_000);
  stopTimer.unref();
}

function requestStop(signal) {
  if (requestedSignal) return;
  requestedSignal = signal;
  // Keep .env files isolated until the child has exited. Restoring first would
  // let a still-running framework process discover them after a signal.
  if (child?.pid) {
    stopChild(signal);
    scheduleForceStop();
  }
}

process.once("SIGHUP", () => requestStop("SIGHUP"));
process.once("SIGINT", () => requestStop("SIGINT"));
process.once("SIGTERM", () => requestStop("SIGTERM"));

function runChild(environment) {
  return new Promise((resolve, reject) => {
    const resolved = resolveNodeBin(root, command, args);
    child = spawn(resolved.command, resolved.args, {
      cwd: root,
      env: environment,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      if (requestedSignal) {
        stopChild(requestedSignal);
        scheduleForceStop();
      }
    });
    child.once("close", (code) => {
      const processGroupId = child?.pid;
      void (async () => {
        if (processGroupId) {
          await waitForProcessGroupExit(processGroupId);
        }
        if (stopTimer) clearTimeout(stopTimer);
        resolve(code);
      })().catch(reject);
    });
  });
}

let restoredSuccessfully = false;
try {
  hold = hiddenDirectory(root);
  for (const name of rootEnvironmentEntries(root)) {
    renameSync(path.join(root, name), path.join(hold, name));
    moved.push(name);
  }

  const inheritedNodeOptions = process.env.NODE_OPTIONS?.trim();
  const childEnvironment = { ...process.env };
  delete childEnvironment[SUBREAPER_MARKER];
  const environment = {
    ...childEnvironment,
    // --import 收的是 URL：Windows 的絕對路徑會被當成 "d:" scheme
    // （ERR_UNSUPPORTED_ESM_URL_SCHEME），而 NODE_OPTIONS 以空白分隔，
    // 路徑含空白也會被拆開。file:// URL 同時解掉這兩件事。
    NODE_OPTIONS: [
      inheritedNodeOptions,
      `--import=${pathToFileURL(guardPath).href}`,
    ]
      .filter(Boolean)
      .join(" "),
  };
  const result = await runChild(environment);
  process.exitCode = requestedSignal
    ? signalExitCode(requestedSignal)
    : (result ?? 1);
} finally {
  try {
    restoreOrThrow();
    restoredSuccessfully = true;
  } finally {
    // If restoration failed, keep the lock in place: a later runner must not
    // execute while an original environment file remains in its private hold.
    if (restoredSuccessfully) rmdirSync(lock);
  }
}
