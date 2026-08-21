import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireLockedWorkspaceAccess } from "./workspace-mutation-access";

function transactionWithRows(rows: Array<{ role: string }>) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  return {
    transaction: { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient,
    queryRaw,
  };
}

describe("requireLockedWorkspaceAccess", () => {
  it.each([
    ["OWNER", "manageMembers"],
    ["OWNER", "edit"],
    ["PARTNER", "edit"],
    ["PLANNER", "edit"],
    ["VIEWER", "read"],
  ] as const)("locks and allows %s to %s", async (role, permission) => {
    const { transaction, queryRaw } = transactionWithRows([{ role }]);

    await expect(
      requireLockedWorkspaceAccess(
        "workspace_1",
        "user_1",
        permission,
        transaction,
      ),
    ).resolves.toBe(role);

    const query = queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    expect(query.strings.join(" ")).toContain('FROM "memberships"');
    expect(query.strings.join(" ")).toContain("FOR SHARE");
    expect(query.values).toEqual(["workspace_1", "user_1"]);
  });

  it.each([
    [[], "edit"],
    [[{ role: "VIEWER" }], "edit"],
    [[{ role: "PARTNER" }], "manageMembers"],
    [[{ role: "INVALID" }], "read"],
    [[{ role: "OWNER" }, { role: "OWNER" }], "read"],
  ] as const)("denies missing, duplicated, invalid, or insufficient membership", async (rows, permission) => {
    const { transaction } = transactionWithRows([...rows]);

    await expect(
      requireLockedWorkspaceAccess(
        "workspace_1",
        "user_1",
        permission,
        transaction,
      ),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});
