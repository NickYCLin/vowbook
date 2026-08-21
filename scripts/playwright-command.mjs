import { spawnSync } from "node:child_process";
import path from "node:path";

const command = process.argv[2];
const playwrightCli = path.join(
  process.cwd(),
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const browsersPath = path.join(process.cwd(), ".playwright-browsers");

const args =
  command === "install"
    ? [playwrightCli, "install", "chromium"]
    : command === "test"
      ? [playwrightCli, "test"]
      : null;

if (!args) {
  throw new Error("Only Playwright install and test are supported.");
}

const result = spawnSync(process.execPath, args, {
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
