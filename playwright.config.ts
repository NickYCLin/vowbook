import { defineConfig, devices } from "@playwright/test";
import { normalizeBasePath } from "./src/lib/base-path";

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
const serverOrigin = "http://127.0.0.1:3100";
const applicationUrl = `${serverOrigin}${basePath}/`;
const healthUrl = `${serverOrigin}${basePath}/api/health`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: applicationUrl,
    headless: process.env.VOWBOOK_E2E_HEADED !== "1",
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "PORT=3100 npm run start",
    url: healthUrl,
    env: {
      ...process.env,
      AUTH_SECRET: "vowbook-e2e-local-secret-not-for-production",
      GOOGLE_CLIENT_ID: "vowbook-e2e-client",
      GOOGLE_CLIENT_SECRET: "vowbook-e2e-client-secret",
      NEXTAUTH_URL: `${serverOrigin}${basePath}/api/auth`,
      NEXTAUTH_URL_INTERNAL: `${serverOrigin}${basePath}/api/auth`,
      NEXT_PUBLIC_BASE_PATH: basePath,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
