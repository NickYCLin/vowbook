import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  guestFindMany,
  seatingTableFindMany,
  transaction,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  guestFindMany: vi.fn(),
  seatingTableFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    guest: { findMany: guestFindMany },
    seatingTable: { findMany: seatingTableFindMany },
  },
}));

const transactionClient = {
  membership: { findUnique: vi.fn() },
  guest: { findMany: guestFindMany },
  seatingTable: { findMany: seatingTableFindMany },
};

import {
  getGuestCheckInBoard,
  GuestCheckInBoardDataError,
} from "./guest-check-in-board";

function guestRecord(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "guest_1",
    name: "王小明",
    category: "GUEST",
    side: "PARTNER_A",
    attendanceStatus: "ATTENDING",
    partySize: 2,
    notes: null,
    seatingTableId: null,
    checkIn: null,
    ...overrides,
  };
}

describe("getGuestCheckInBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
    });
    guestFindMany.mockResolvedValue([]);
    seatingTableFindMany.mockResolvedValue([]);
    transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  it("authorizes with the transaction client before any tenant-scoped read", async () => {
    await expect(getGuestCheckInBoard("workspace_1")).resolves.toMatchObject({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "合成婚宴" },
      guests: [],
      tables: [],
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
    for (const call of [
      guestFindMany.mock.calls[0]?.[0],
      seatingTableFindMany.mock.calls[0]?.[0],
    ]) {
      expect(call).toMatchObject({ where: { workspaceId: "workspace_1" } });
    }
  });

  it("never selects internal seating or tenant identifiers the board does not render", async () => {
    await getGuestCheckInBoard("workspace_1");
    const select = guestFindMany.mock.calls[0]?.[0]?.select;
    expect(select).toBeDefined();
    expect(select.workspaceId).toBeUndefined();
    expect(select.checkIn.select.workspaceId).toBeUndefined();
    expect(select.checkIn.select.guestId).toBeUndefined();
  });

  it("resolves seat numbers from table position and orders unseated guests last", async () => {
    seatingTableFindMany.mockResolvedValue([
      { id: "table_a", name: "主桌", capacity: 10 },
      { id: "table_b", name: "同學桌", capacity: 10 },
    ]);
    guestFindMany.mockResolvedValue([
      guestRecord({ id: "guest_unseated", name: "陳小美" }),
      guestRecord({ id: "guest_b", name: "李大同", seatingTableId: "table_b" }),
      guestRecord({ id: "guest_a", name: "張三", seatingTableId: "table_a" }),
    ]);

    const board = await getGuestCheckInBoard("workspace_1");

    expect(board.guests.map((guest) => guest.id)).toEqual([
      "guest_a",
      "guest_b",
      "guest_unseated",
    ]);
    expect(board.guests[0]?.seatingTable).toEqual({ number: 1, name: "主桌" });
    expect(board.guests[2]?.seatingTable).toBeNull();
  });

  it("rolls up expected and arrived headcount per table and for the whole workspace", async () => {
    seatingTableFindMany.mockResolvedValue([
      { id: "table_a", name: "主桌", capacity: 10 },
    ]);
    guestFindMany.mockResolvedValue([
      guestRecord({
        id: "guest_arrived",
        name: "張三",
        partySize: 4,
        seatingTableId: "table_a",
        checkIn: {
          id: "check_in_1",
          headcount: 3,
          notes: "少一位",
          checkedInAt: new Date("2026-08-31T02:00:00.000Z"),
          version: 0,
        },
      }),
      guestRecord({
        id: "guest_pending",
        name: "李四",
        partySize: 2,
        seatingTableId: "table_a",
      }),
      guestRecord({
        id: "guest_walk_in",
        name: "王五",
        attendanceStatus: "DECLINED",
        partySize: 1,
        checkIn: {
          id: "check_in_2",
          headcount: 1,
          notes: null,
          checkedInAt: new Date("2026-08-31T02:05:00.000Z"),
          version: 0,
        },
      }),
    ]);

    const board = await getGuestCheckInBoard("workspace_1");

    expect(board.tables).toEqual([
      {
        id: "table_a",
        number: 1,
        name: "主桌",
        capacity: 10,
        expectedHeadcount: 6,
        arrivedHeadcount: 3,
        pendingGroups: 1,
      },
    ]);
    expect(board.summary).toEqual({
      expectedGroups: 2,
      expectedHeadcount: 6,
      arrivedGroups: 2,
      arrivedHeadcount: 4,
      pendingGroups: 1,
      pendingHeadcount: 2,
      unexpectedGroups: 1,
    });
  });

  it("re-throws workspace access denial instead of masking it as a data error", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(getGuestCheckInBoard("workspace_1")).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    );
  });

  it("maps an unexpected database failure to a safe message", async () => {
    guestFindMany.mockRejectedValue(new Error("connection reset by peer"));
    await expect(getGuestCheckInBoard("workspace_1")).rejects.toBeInstanceOf(
      GuestCheckInBoardDataError,
    );
    await expect(getGuestCheckInBoard("workspace_1")).rejects.toThrow(
      "目前無法載入報到名單，請稍後再試。",
    );
  });
});
