import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const { requireCurrentUser, requireWorkspaceAccess, findMany } = vi.hoisted(
  () => ({
    requireCurrentUser: vi.fn(),
    requireWorkspaceAccess: vi.fn(),
    findMany: vi.fn(),
  }),
);

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: { weddingStaffAssignment: { findMany } },
}));

import {
  getWeddingStaffList,
  WeddingStaffDataError,
} from "./wedding-staff-list";

describe("getWeddingStaffList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    findMany.mockResolvedValue([]);
  });

  it("authorizes before a tenant-scoped deterministic read", async () => {
    await expect(getWeddingStaffList("workspace_1")).resolves.toEqual({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      staff: [],
    });
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "read",
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
      orderBy: [
        { roleName: "asc" },
        { personName: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        roleName: true,
        personName: true,
        contactPhone: true,
        notes: true,
        version: true,
      },
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      findMany.mock.invocationCallOrder[0],
    );
  });

  it("returns a serializable tenant-neutral DTO", async () => {
    findMany.mockResolvedValue([
      {
        id: "staff_1",
        roleName: "主持",
        personName: "林小美",
        contactPhone: "0912 345 678",
        notes: "熟悉流程",
        version: 3,
      },
    ]);
    const data = await getWeddingStaffList("workspace_1");
    expect(data.staff).toEqual([
      {
        id: "staff_1",
        roleName: "主持",
        personName: "林小美",
        contactPhone: "0912 345 678",
        notes: "熟悉流程",
        version: 3,
      },
    ]);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("preserves outsider denial and sanitizes database failures", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      getWeddingStaffList("workspace_secret"),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(findMany).not.toHaveBeenCalled();

    requireWorkspaceAccess.mockResolvedValueOnce({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    findMany.mockRejectedValueOnce(new Error("postgres://secret"));
    await expect(getWeddingStaffList("workspace_1")).rejects.toEqual(
      new WeddingStaffDataError("目前無法載入婚禮工作人員，請稍後再試。"),
    );
  });
});
