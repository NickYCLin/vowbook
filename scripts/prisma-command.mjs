import { spawnSync } from "node:child_process";
import path from "node:path";

const command = process.argv[2];

if (command !== "validate" && command !== "generate") {
  throw new Error("Only Prisma validate and generate are supported.");
}

const prismaCli = path.join(
  process.cwd(),
  "node_modules",
  "prisma",
  "build",
  "index.js",
);

const environment = {
  ...process.env,
  // These schema-only commands require a syntactically valid URL but never connect.
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://localhost/vowbook",
};

const result = spawnSync(process.execPath, [prismaCli, command], {
  env: environment,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
