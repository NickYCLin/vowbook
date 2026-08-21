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
    "coverage/**",
    "node_modules/**",
    "playwright-report/**",
    "src/generated/**",
    "test-results/**",
  ]),
]);
