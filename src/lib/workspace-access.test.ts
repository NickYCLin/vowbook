import { describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { requireWorkspaceAccess } from "./workspace-access";

describe("requireWorkspaceAccess", () => {
  it.each([
    ["OWNER", "manageMembers"],
    ["PARTNER", "edit"],
    ["PLANNER", "edit"],
    ["VIEWER", "read"],
  ] as const)("allows %s to %s", async (role, permission) => {
    const membership = { role, workspace: { id: "workspace_1" } };
    const findUnique = vi.fn().mockResolvedValue(membership);

    await expect(
      requireWorkspaceAccess(
        "workspace_1",
        "user_1",
        permission,
        { membership: { findUnique } },
      ),
    ).resolves.toEqual(membership);
  });

  it("rejects a non-member without revealing whether a workspace exists", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);

    await expect(
      requireWorkspaceAccess("workspace_2", "user_1", "read", {
        membership: { findUnique },
      }),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
  });

  it("scopes the lookup by both workspace and current user", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_2" },
    });

    await requireWorkspaceAccess("workspace_2", "session_user", "read", {
      membership: { findUnique },
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_userId: {
          workspaceId: "workspace_2",
          userId: "session_user",
        },
      },
      include: { workspace: true },
    });
  });
});
