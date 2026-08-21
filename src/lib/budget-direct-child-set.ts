import "server-only";

import { createHash } from "node:crypto";

export function fingerprintBudgetDirectChildIds(ids: Iterable<string>): string {
  return createHash("sha256")
    .update(JSON.stringify(Array.from(ids).sort()))
    .digest("hex");
}
