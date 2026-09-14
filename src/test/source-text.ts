import { readFileSync } from "node:fs";

export function readSourceText(filePath: string): string {
  return readFileSync(filePath, "utf8").replace(/\r\n?/gu, "\n");
}
