import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const integration = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "test",
    "postgres-workspace-invitations.integration.test.ts",
  ),
  "utf8",
);

describe("workspace invitation PostgreSQL integration source contract", () => {
  it("covers DB-clock proof boundaries, email reuse, immutable generations, replay, and terminal races", () => {
    for (const title of [
      "rejects a proof older than DB now minus five minutes",
      "does not let an app clock ahead accept an invitation created after proof",
      "accepts after a new DB-clock Google verification",
      "lets a new Google subject claim a reused email without letting the old subject claim",
      "replays the same operation key after revoke and accept without reopening",
      "keeps parallel different operation keys to at most one pending generation",
      "reinvite creates a new id and immutable lineage",
      "keeps a stale reinvite from creating a second generation",
      "allows a new create after an accepted generation",
      "does not create an invitation after OWNER access is concurrently revoked",
      "rejects accepted_at equal to or later than expires_at",
      "settles expiry, revoke, and claim races in legal terminal states",
    ]) {
      expect(integration).toContain(title);
    }
  });

  it("keeps every proof gate in PostgreSQL time and generation changes explicit", () => {
    const claimSource = readFileSync(
      path.join(process.cwd(), "src", "lib", "current-user-claim.ts"),
      "utf8",
    );
    expect(claimSource).toMatch(/"expires_at"\s*>\s*CURRENT_TIMESTAMP/u);
    expect(claimSource).toMatch(
      /\$\{verifiedAt\}::timestamptz\s*<=\s*CURRENT_TIMESTAMP[\s\S]*\$\{verifiedAt\}::timestamptz\s*>=\s*CURRENT_TIMESTAMP\s*-\s*INTERVAL '5 minutes'/u,
    );
    expect(claimSource).toMatch(
      /"created_at"\s*<=\s*\$\{verifiedAt\}::timestamptz/u,
    );
    expect(claimSource).toMatch(/"version"\s*=\s*"version"\s*\+\s*1/u);
    expect(claimSource).toMatch(
      /UPDATE "workspace_invitations"[\s\S]*RETURNING/u,
    );
    expect(claimSource).not.toContain("Date.now()");
  });
});
