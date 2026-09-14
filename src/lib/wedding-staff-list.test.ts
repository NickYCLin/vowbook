import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { weddingStaffTimelineAssignmentFingerprint } from "@/domain/wedding-staff-timeline-snapshot";

const { requireCurrentUser, requireWorkspaceAccess, findMany, transaction } = vi.hoisted(
  () => ({
    requireCurrentUser: vi.fn(),
    requireWorkspaceAccess: vi.fn(),
    findMany: vi.fn(),
    transaction: vi.fn(),
  }),
);

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    weddingStaffAssignment: { findMany },
  },
}));

const transactionClient = {
  membership: { findUnique: vi.fn() },
  weddingStaffAssignment: { findMany },
};

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
    transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
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
      transactionClient,
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
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
        mealCount: true,
        vegetarianMealCount: true,
        redEnvelopeAmount: true,
        redEnvelopeSentAt: true,
        version: true,
        timelineAssignments: {
          orderBy: [{ timelineItemId: "asc" }],
          select: { timelineItemId: true },
        },
      },
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0],
    );
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
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
        timelineAssignments: [
          { timelineItemId: "timeline_2" },
          { timelineItemId: "timeline_1" },
        ],
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
        timelineAssignmentFingerprint:
          weddingStaffTimelineAssignmentFingerprint([
            "timeline_2",
            "timeline_1",
          ]),
      },
    ]);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("denies a membership revoked at the transaction boundary before staff PII is read", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    await expect(
      getWeddingStaffList("workspace_secret"),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(findMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("sanitizes membership infrastructure and database failures", async () => {
    requireWorkspaceAccess.mockRejectedValueOnce(
      new Error("membership database secret"),
    );
    await expect(getWeddingStaffList("workspace_1")).rejects.toEqual(
      new WeddingStaffDataError("目前無法載入婚禮工作人員，請稍後再試。"),
    );
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
