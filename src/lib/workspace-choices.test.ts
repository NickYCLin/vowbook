import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/prisma", () => ({ prisma: { membership: { findMany: mocks.findMany } } }));
import { listWorkspaceChoicesForUser } from "./workspace-choices";
it("derives the workspace list from the current account's memberships without loading domain records", async () => {
  await listWorkspaceChoicesForUser("session-user");
  expect(mocks.findMany).toHaveBeenCalledWith({
    where: { userId: "session-user" },
    select: { id: true, role: true, workspace: { select: { id: true, name: true, weddingDate: true, timezone: true, updatedAt: true } } },
    orderBy: { createdAt: "asc" },
  });
});
