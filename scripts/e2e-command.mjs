import { spawnSync } from "node:child_process";
import path from "node:path";

const commands = new Map([
  ["build", ["node_modules/next/dist/bin/next", "build"]],
  ["test", ["scripts/playwright-command.mjs", "test"]],
  ["crud", ["scripts/crud-browser-command.mjs"]],
  ["attachments", ["scripts/budget-attachment-browser-command.mjs"]],
]);
const command = commands.get(process.argv[2]);
if (!command) {
  console.error("Unsupported E2E command.");
  process.exit(1);
}

// 由 Node 傳遞環境變數，讓 Windows 與 Linux 使用相同的正式子路徑。
const [script, ...args] = command;
const result = spawnSync(process.execPath, [
  path.resolve("scripts/secret-free-command.mjs"),
  "--",
  process.execPath,
  path.resolve(script),
  ...args,
], {
  env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "/VowBook" },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
