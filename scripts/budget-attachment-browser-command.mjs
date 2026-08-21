import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createBudgetTaxonomyFixture } from "./budget-taxonomy-fixture.mjs";

const rawTestDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!rawTestDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required. Use a disposable localhost PostgreSQL database whose name contains 'test'.",
  );
}

const parsedUrl = new URL(rawTestDatabaseUrl);
const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//u, ""));
if (!allowedHosts.has(parsedUrl.hostname) || !/test/iu.test(databaseName)) {
  throw new Error(
    "Refusing to run: TEST_DATABASE_URL must target localhost and a database whose name contains 'test'.",
  );
}

const runId = `${process.pid}_${Date.now()}`;
const schemaName = `vowbook_attachment_e2e_${runId}`;
const databaseUrl = databaseUrlFor(schemaName);
const authSecret = "vowbook-e2e-local-secret-not-for-production";
const userId = `attachment_e2e_user_${runId}`;
const workspaceId = `attachment_e2e_workspace_${runId}`;
const groupId = `attachment_e2e_group_${runId}`;
const expenseId = `attachment_e2e_expense_${runId}`;
const googleSubject = `attachment-e2e-subject-${runId}`;
const email = `attachment-e2e-${runId}@example.test`;
const prismaCli = path.join(
  process.cwd(),
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
const playwrightCli = path.join(
  process.cwd(),
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const browsersPath = path.join(process.cwd(), ".playwright-browsers");

function databaseUrlFor(schema) {
  const url = new URL(rawTestDatabaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function run(command, args, environment) {
  return (
    spawnSync(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    }).status ?? 1
  );
}

async function seedFixture() {
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    await client.user.create({
      data: {
        id: userId,
        googleSubject,
        email,
        name: "附件 E2E 使用者",
      },
    });
    await client.weddingWorkspace.create({
      data: {
        id: workspaceId,
        name: "附件 E2E 婚宴",
        createdById: userId,
        memberships: {
          create: { userId, role: "OWNER" },
        },
      },
    });
    const taxonomyNodeIds = await createBudgetTaxonomyFixture(
      client,
      workspaceId,
    );
    const venueItemId = taxonomyNodeIds.get("ITEM_WEDDING_VENUE");
    if (!venueItemId) {
      throw new Error("Budget attachment taxonomy fixture is incomplete.");
    }
    await client.budgetItem.create({
      data: {
        id: groupId,
        workspaceId,
        parentId: venueItemId,
        name: "E2E 附件群組",
        kind: "GROUP",
        category: null,
        plannedAmount: 0,
      },
    });
    await client.budgetItem.create({
      data: {
        id: expenseId,
        workspaceId,
        parentId: groupId,
        name: "E2E 場地費用",
        kind: "EXPENSE",
        category: "VENUE_CATERING",
        legacyCategory: "場地與餐飲",
        plannedAmount: 200000,
      },
    });
  } finally {
    await client.$disconnect();
  }
}

async function dropSchema() {
  const cleanupClient = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    await cleanupClient.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
  } finally {
    await cleanupClient.$disconnect();
  }
}

const environment = {
  ...process.env,
  AUTH_SECRET: authSecret,
  DATABASE_URL: databaseUrl,
  NEXT_PUBLIC_BASE_PATH: "/VowBook",
  PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  VOWBOOK_ATTACHMENT_E2E: "1",
  VOWBOOK_ATTACHMENT_E2E_EMAIL: email,
  VOWBOOK_ATTACHMENT_E2E_EXPENSE_ID: expenseId,
  VOWBOOK_ATTACHMENT_E2E_GOOGLE_SUBJECT: googleSubject,
  VOWBOOK_ATTACHMENT_E2E_WORKSPACE_ID: workspaceId,
  VOWBOOK_E2E_HEADED: "1",
};

let status = 1;
try {
  status = run(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    environment,
  );
  if (status === 0) {
    await seedFixture();
    const playwrightArgs = [
      playwrightCli,
      "test",
      "e2e/budget-attachments.spec.ts",
      "--workers=1",
    ];
    status = process.env.DISPLAY
      ? run(process.execPath, playwrightArgs, environment)
      : run(
          "xvfb-run",
          ["-a", process.execPath, ...playwrightArgs],
          environment,
        );
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Budget attachment browser runner failed.",
  );
  status = 1;
} finally {
  await dropSchema();
}

process.exit(status);
