import { describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { membership: { findMany } },
}));

import { listWorkspacesForUser } from "./workspace-list";

describe("listWorkspacesForUser", () => {
  it("only returns memberships belonging to the current internal user", async () => {
    findMany.mockResolvedValue([]);

    await listWorkspacesForUser("session_user");

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "session_user" },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    });
  });
});
