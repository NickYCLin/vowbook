import path from "node:path";
import process from "node:process";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    environment: "jsdom",
    maxWorkers: process.platform === "win32" ? 6 : undefined,
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: process.platform === "win32" ? 25_000 : 5_000,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
