import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".npm-cache/**",
    ".playwright-browsers/**",
    ".rwd-audit/**",
    // 測試結束會移除此鎖目錄，lint 不應在走訪途中進入它。
    ".vowbook-secret-free.lock/",
    "coverage/**",
    "node_modules/**",
    "playwright-report/**",
    "src/generated/**",
    "test-results/**",
  ]),
]);
