import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(fileName: string) {
  return fs.readFileSync(path.join(process.cwd(), fileName), "utf8");
}

describe("production container contract", () => {
  it("builds a Node 22 Alpine standalone image and runs as non-root", () => {
    const dockerfile = readProjectFile("Dockerfile");

    expect(dockerfile).toMatch(/^FROM node:22-alpine AS deps/m);
    expect(dockerfile).toMatch(/^FROM node:22-alpine AS builder/m);
    expect(dockerfile).toMatch(/^FROM node:22-alpine AS migrator/m);
    expect(dockerfile).toMatch(/^FROM node:22-alpine AS runner/m);
    expect(dockerfile).toContain("npm run db:generate");
    expect(dockerfile).toContain(".next/standalone");
    expect(dockerfile).toContain(".next/static");
    expect(dockerfile).toMatch(/apk add --no-cache[^\n]*openssl/);
    expect(dockerfile).toMatch(/^USER nextjs/m);
    expect(dockerfile).toMatch(/^EXPOSE 3000/m);
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
    expect(dockerfile).toContain("COPY prisma ./prisma");
    expect(dockerfile).toContain(
      'CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]',
    );

    const migratorStart = dockerfile.indexOf("FROM node:22-alpine AS migrator");
    const runnerStart = dockerfile.indexOf("FROM node:22-alpine AS runner");
    const migrator = dockerfile.slice(migratorStart, runnerStart);
    expect(migrator).toContain(
      "COPY scripts/prisma-command.mjs scripts/budget-hierarchy-operator.mjs ./scripts/",
    );
    expect(migrator).toContain("RUN npm run db:generate");
    expect(migrator).toMatch(/^USER node$/m);
  });

  it("keeps secrets and local build output outside the Docker context", () => {
    const dockerignore = readProjectFile(".dockerignore");

    expect(dockerignore).toMatch(/^node_modules\/$/m);
    expect(dockerignore).toMatch(/^\.next\/$/m);
    expect(dockerignore).toMatch(/^\.env\*$/m);
    expect(dockerignore).toMatch(/^\.git\/$/m);
    expect(dockerignore).toMatch(/^test-results\/$/m);
    expect(dockerignore).toMatch(/^playwright-report\/$/m);
  });

  it("mirrors the production NextAuth base path in Playwright", () => {
    const playwright = readProjectFile("playwright.config.ts");

    expect(playwright).toContain(
      "NEXTAUTH_URL: `${serverOrigin}${basePath}/api/auth`",
    );
    expect(playwright).toContain(
      "NEXTAUTH_URL_INTERNAL: `${serverOrigin}${basePath}/api/auth`",
    );
  });

  it("connects the app safely to PostgreSQL for local self-hosting", () => {
    const compose = readProjectFile("compose.yaml");
    const appStart = compose.indexOf("  app:\n");
    const postgresStart = compose.indexOf("\n  postgres:\n") + 1;
    const appService = compose.slice(appStart, postgresStart);
    const postgresService = compose.slice(postgresStart, compose.indexOf("\nvolumes:"));

    expect(appStart).toBeGreaterThan(-1);
    expect(postgresStart).toBeGreaterThan(appStart);
    expect(appService).toContain("image: vowbook:local");
    expect(appService).toContain("container_name: vowbook-app");
    expect(appService).toContain(
      "env_file:\n      - path: .env.admin\n        required: false",
    );
    expect(appService).toContain(
      'ports:\n      - "127.0.0.1:${VOWBOOK_PORT:-3000}:3000"',
    );
    expect(appService).toContain("condition: service_healthy");
    expect(appService).toContain(
      "DATABASE_URL: ${VOWBOOK_DATABASE_URL:",
    );
    expect(appService).toContain("condition: service_completed_successfully");
    expect(appService).toContain("NEXT_PUBLIC_BASE_PATH: ${VOWBOOK_BASE_PATH:-}");
    expect(appService).toContain("NEXTAUTH_URL: ${VOWBOOK_NEXTAUTH_URL:");
    expect(appService).toContain(
      "NEXTAUTH_URL_INTERNAL: http://127.0.0.1:3000${VOWBOOK_BASE_PATH:-}/api/auth",
    );
    expect(appService).toContain("${VOWBOOK_BASE_PATH:-}/api/health");
    expect(postgresService).toContain(
      'ports:\n      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"',
    );
    expect(postgresService).toContain(
      "vowbook_postgres_data:/var/lib/postgresql/data",
    );
    expect(compose).not.toContain("ycspace_apps");

    const migrateStart = compose.indexOf("\n  migrate:\n") + 1;
    const migrateService = compose.slice(migrateStart, compose.indexOf("\nvolumes:"));
    expect(migrateStart).toBeGreaterThan(postgresStart);
    expect(migrateService).toContain("target: migrator");
    expect(migrateService).toContain("image: vowbook-migrate:local");
    expect(migrateService).toContain("restart: \"no\"");
    expect(migrateService).toContain(
      "DATABASE_URL: ${VOWBOOK_DATABASE_URL:",
    );
  });
});
