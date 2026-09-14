import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  guestFindFirst: vi.fn(),
  checkInCreate: vi.fn(),
  checkInFindFirst: vi.fn(),
  checkInUpdateMany: vi.fn(),
  checkInDeleteMany: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

const transactionClient = {
  guest: { findFirst: mocks.guestFindFirst },
  guestCheckIn: {
    create: mocks.checkInCreate,
    findFirst: mocks.checkInFindFirst,
    updateMany: mocks.checkInUpdateMany,
    deleteMany: mocks.checkInDeleteMany,
  },
};

vi.mock("@/lib/current-user", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));
vi.mock("@/lib/workspace-access", () => ({
  requireWorkspaceAccess: mocks.requireWorkspaceAccess,
}));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess: mocks.requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  cancelGuestCheckInAction,
  checkInGuestAction,
  updateGuestCheckInAction,
} from "./guest-check-ins";

const idleState = { status: "idle" as const };

function checkInForm({
  headcount = "3",
  notes = "  臨時少一位  ",
  expectedVersion,
}: {
  headcount?: string;
  notes?: string;
  expectedVersion?: string;
} = {}) {
  const form = new FormData();
  form.set("headcount", headcount);
  form.set("notes", notes);
  if (expectedVersion !== undefined) {
    form.set("expectedVersion", expectedVersion);
  }
  return form;
}

describe("guest check-in actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ id: "session_user" });
    mocks.requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    mocks.requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    mocks.guestFindFirst.mockResolvedValue({ id: "guest_1" });
    mocks.checkInCreate.mockResolvedValue({
      id: "check_in_1",
      headcount: 3,
      notes: "臨時少一位",
      version: 0,
    });
    mocks.checkInUpdateMany.mockResolvedValue({ count: 1 });
    mocks.checkInFindFirst.mockResolvedValue({
      id: "check_in_1",
      headcount: 2,
      notes: null,
      version: 5,
    });
    mocks.checkInDeleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  it("authorizes before validation and refuses a viewer without opening a transaction", async () => {
    mocks.requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      checkInGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        checkInForm({ headcount: "forged" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    expect(mocks.requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when membership is revoked after preflight and before any tenant read or write", async () => {
    mocks.requireLockedWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      checkInGuestAction("workspace_1", "guest_1", idleState, checkInForm()),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    expect(mocks.requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    expect(mocks.guestFindFirst).not.toHaveBeenCalled();
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("checks a guest in with the normalized headcount and tenant-scoped guest proof", async () => {
    await expect(
      checkInGuestAction("workspace_1", "guest_1", idleState, checkInForm()),
    ).resolves.toEqual({
      status: "success",
      message: "已完成報到。",
      checkIn: {
        id: "check_in_1",
        headcount: 3,
        notes: "臨時少一位",
        version: 0,
      },
    });

    expect(mocks.guestFindFirst).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1" },
      select: { id: true },
    });
    expect(mocks.checkInCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        guestId: "guest_1",
        headcount: 3,
        notes: "臨時少一位",
      },
      select: { id: true, headcount: true, notes: true, version: true },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/check-in",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/overview",
    );
  });

  it("refuses to check in a guest that does not belong to the workspace", async () => {
    mocks.guestFindFirst.mockResolvedValueOnce(null);

    await expect(
      checkInGuestAction("workspace_1", "other_guest", idleState, checkInForm()),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("reports a duplicate check-in as stale instead of leaking the database error", async () => {
    mocks.checkInCreate.mockRejectedValueOnce({ code: "P2002" });

    await expect(
      checkInGuestAction("workspace_1", "guest_1", idleState, checkInForm()),
    ).resolves.toMatchObject({
      status: "error",
      code: "STALE",
      message: "報到資料已更新、已建立或不存在，請重新整理後再試。",
    });
  });

  it("rejects an invalid headcount before opening a transaction", async () => {
    await expect(
      checkInGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        checkInForm({ headcount: "0" }),
      ),
    ).resolves.toMatchObject({
      status: "error",
      code: "VALIDATION",
      message: "報到人數請輸入 1 到 20 的整數。",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("updates an arrival head count with an expected-version compare-and-swap", async () => {
    await expect(
      updateGuestCheckInAction(
        "workspace_1",
        "check_in_1",
        idleState,
        checkInForm({ headcount: "2", notes: "", expectedVersion: "4" }),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已更新報到人數。",
      checkIn: { id: "check_in_1", headcount: 2, notes: null, version: 5 },
    });

    expect(mocks.checkInUpdateMany).toHaveBeenCalledWith({
      where: { id: "check_in_1", workspaceId: "workspace_1", version: 4 },
      data: { headcount: 2, notes: null, version: { increment: 1 } },
    });
  });

  it("reports a losing compare-and-swap as stale and refreshes the board", async () => {
    mocks.checkInUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      updateGuestCheckInAction(
        "workspace_1",
        "check_in_1",
        idleState,
        checkInForm({ expectedVersion: "4" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    expect(mocks.checkInFindFirst).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/check-in",
    );
  });

  it("rejects a forged expected version without touching the database", async () => {
    await expect(
      updateGuestCheckInAction(
        "workspace_1",
        "check_in_1",
        idleState,
        checkInForm({ expectedVersion: "-1" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("cancels a check-in with the same tenant-scoped compare-and-swap", async () => {
    await expect(
      cancelGuestCheckInAction(
        "workspace_1",
        "check_in_1",
        idleState,
        checkInForm({ expectedVersion: "2" }),
      ),
    ).resolves.toEqual({ status: "success", message: "已取消報到。" });

    expect(mocks.checkInDeleteMany).toHaveBeenCalledWith({
      where: { id: "check_in_1", workspaceId: "workspace_1", version: 2 },
    });
  });

  it("reports a cancel that matched no row as stale", async () => {
    mocks.checkInDeleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      cancelGuestCheckInAction(
        "workspace_1",
        "check_in_1",
        idleState,
        checkInForm({ expectedVersion: "2" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
  });

  it("tells the operator to refresh when revalidation fails after a successful write", async () => {
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw new Error("revalidation unavailable");
    });

    await expect(
      checkInGuestAction("workspace_1", "guest_1", idleState, checkInForm()),
    ).resolves.toMatchObject({
      status: "success",
      message: "已完成報到；畫面未自動更新，請重新整理。",
    });
  });

  it("maps an unexpected database failure to a safe message", async () => {
    mocks.checkInCreate.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      checkInGuestAction("workspace_1", "guest_1", idleState, checkInForm()),
    ).resolves.toEqual({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法完成報到，請稍後再試。",
    });
  });
});
