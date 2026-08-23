import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  findMany,
  tableFindMany,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  findMany: vi.fn(),
  tableFindMany: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: { guest: { findMany }, seatingTable: { findMany: tableFindMany } },
}));

import { GuestDataError, listGuestsForWorkspace } from "./guest-list";

describe("listGuestsForWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    findMany.mockResolvedValue([]);
    tableFindMany.mockResolvedValue([]);
  });

  it("authorizes before querying and gives VIEWER only non-PII provenance markers", async () => {
    findMany.mockResolvedValue([
      {
        id: "guest_1",
        version: 0,
        name: "唯讀賓客",
        category: "GUEST",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: 2,
        notes: null,
        seatingTable: null,
        importRecords: [
          {
            id: "viewer_record_formstack",
            source: "FORMSTACK",
            sourceLabel: "合成表單",
            sourceManaged: false,
          },
          {
            id: "viewer_record_linein",
            source: "LINEIN",
            sourceLabel: "拍拍印",
            sourceManaged: true,
          },
        ],
      },
    ]);

    await expect(listGuestsForWorkspace("workspace_1")).resolves.toEqual({
      role: "VIEWER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
      guests: [
        {
          id: "guest_1",
          version: 0,
          name: "唯讀賓客",
          category: "GUEST",
          side: "PARTNER_A",
          attendanceStatus: "ATTENDING",
          partySize: 2,
          notes: null,
          seatingTable: null,
          details: null,
          importRecords: [
            {
              provenanceKey: "viewer_record_formstack",
              source: "FORMSTACK",
              sourceLabel: "合成表單",
              sourceManaged: false,
              managedFields: [],
              details: null,
            },
            {
              provenanceKey: "viewer_record_linein",
              source: "LINEIN",
              sourceLabel: "拍拍印",
              sourceManaged: true,
              managedFields: [],
              details: null,
            },
          ],
        },
      ],
    });

    expect(requireCurrentUser).toHaveBeenCalledWith();
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "read",
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        version: true,
        name: true,
        category: true,
        side: true,
        attendanceStatus: true,
        partySize: true,
        notes: true,
        // id 是拿來對照桌號的：桌號由整份桌次清單的順位推導，不在這一列裡。
        seatingTable: { select: { id: true, name: true } },
        importRecords: {
          orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
          select: {
            id: true,
            source: true,
            sourceLabel: true,
            sourceManaged: true,
          },
        },
      },
    });
    const viewerSelect = findMany.mock.calls[0][0].select.importRecords.select;
    expect(viewerSelect).not.toHaveProperty("externalId");
    expect(viewerSelect).not.toHaveProperty("contactPhone");
    expect(viewerSelect).not.toHaveProperty("contactEmail");
    expect(viewerSelect).not.toHaveProperty("mailingAddress");
    expect(viewerSelect).not.toHaveProperty("guestMessage");
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(requireWorkspaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      findMany.mock.invocationCallOrder[0],
    );
  });

  it("maps multiple editor-visible import records once per Guest and preserves nullable details", async () => {
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    const sourceSubmittedAt = new Date("2026-07-22T08:30:00.000Z");
    findMany.mockResolvedValue([
      {
        id: "guest_1",
        version: 0,
        name: "可編輯賓客",
        category: "GUEST",
        side: "PARTNER_B",
        attendanceStatus: "DECLINED",
        partySize: 1,
        notes: "人工備註",
        seatingTable: { name: "主桌" },
        importRecords: [
          {
            id: "editor_record_formstack",
            source: "FORMSTACK",
            sourceLabel: "合成表單",
            sourceManaged: false,
            managedFields: [],
            sourcePartySize: null,
            relationshipLabel: null,
            contactPhone: null,
            contactEmail: null,
            ceremonyAttendance: null,
            childSeatCount: null,
            vegetarianCount: null,
            invitationDelivery: null,
            mailingAddress: null,
            guestMessage: null,
            attendanceReply: null,
            invitationReply: null,
            sourceSubmittedAt: null,
          },
          {
            id: "editor_record_linein",
            source: "LINEIN",
            sourceLabel: "拍拍印",
            sourceManaged: true,
            managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
            sourcePartySize: 3,
            relationshipLabel: "PII_RELATIONSHIP_SENTINEL",
            contactPhone: "PII_PHONE_SENTINEL",
            contactEmail: "PII_EMAIL_SENTINEL",
            ceremonyAttendance: false,
            childSeatCount: 0,
            vegetarianCount: 0,
            invitationDelivery: "UNKNOWN",
            mailingAddress: null,
            guestMessage: "PII_MESSAGE_SENTINEL",
            attendanceReply: "PII_ATTENDANCE_SENTINEL",
            invitationReply: null,
            sourceSubmittedAt,
          },
        ],
      },
    ]);

    const result = await listGuestsForWorkspace("workspace_1");
    expect(result.guests).toHaveLength(1);
    expect(result.guests[0].details).toEqual({
      relationshipLabel: "PII_RELATIONSHIP_SENTINEL",
      contactPhone: "PII_PHONE_SENTINEL",
      contactEmail: "PII_EMAIL_SENTINEL",
      ceremonyAttendance: false,
      childSeatCount: 0,
      vegetarianCount: 0,
      invitationDelivery: "UNKNOWN",
      mailingAddress: null,
      guestMessage: "PII_MESSAGE_SENTINEL",
      attendanceReply: "PII_ATTENDANCE_SENTINEL",
      invitationReply: null,
    });
    expect(result.guests[0].importRecords).toEqual([
      {
        provenanceKey: "editor_record_formstack",
        source: "FORMSTACK",
        sourceLabel: "合成表單",
        sourceManaged: false,
        managedFields: [],
        details: {
          sourcePartySize: null,
          relationshipLabel: null,
          contactPhone: null,
          contactEmail: null,
          ceremonyAttendance: null,
          childSeatCount: null,
          vegetarianCount: null,
          invitationDelivery: null,
          mailingAddress: null,
          guestMessage: null,
          attendanceReply: null,
          invitationReply: null,
          sourceSubmittedAt: null,
        },
      },
      {
        provenanceKey: "editor_record_linein",
        source: "LINEIN",
        sourceLabel: "拍拍印",
        sourceManaged: true,
        managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
        details: {
          sourcePartySize: 3,
          relationshipLabel: "PII_RELATIONSHIP_SENTINEL",
          contactPhone: "PII_PHONE_SENTINEL",
          contactEmail: "PII_EMAIL_SENTINEL",
          ceremonyAttendance: false,
          childSeatCount: 0,
          vegetarianCount: 0,
          invitationDelivery: "UNKNOWN",
          mailingAddress: null,
          guestMessage: "PII_MESSAGE_SENTINEL",
          attendanceReply: "PII_ATTENDANCE_SENTINEL",
          invitationReply: null,
          sourceSubmittedAt,
        },
      },
    ]);

    const query = findMany.mock.calls[0][0];
    expect(query.where).toEqual({ workspaceId: "workspace_1" });
    expect(query.select.importRecords).toEqual({
      orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
      select: {
        id: true,
        source: true,
        sourceInstance: true,
        sourceLabel: true,
        sourceManaged: true,
        managedFields: true,
        sourcePartySize: true,
        relationshipLabel: true,
        contactPhone: true,
        contactEmail: true,
        ceremonyAttendance: true,
        childSeatCount: true,
        vegetarianCount: true,
        invitationDelivery: true,
        mailingAddress: true,
        guestMessage: true,
        attendanceReply: true,
        invitationReply: true,
        sourceSubmittedAt: true,
      },
    });
    expect(query.select.importRecords.select).not.toHaveProperty("externalId");
    expect(query.select.importRecords.select).not.toHaveProperty("guestId");
    expect(query.select.importRecords.select).not.toHaveProperty("workspaceId");
    expect(query.select.importRecords.select).not.toHaveProperty("createdAt");
    expect(query.select.importRecords.select).not.toHaveProperty("updatedAt");
  });

  it("uses manually edited details ahead of imported provenance", async () => {
    requireWorkspaceAccess.mockResolvedValue({
      role: "OWNER",
      workspace: { id: "workspace_1", name: "我們的婚宴" },
    });
    findMany.mockResolvedValue([
      {
        id: "guest_1",
        version: 2,
        name: "已人工修正",
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: 2,
        notes: null,
        seatingTable: null,
        importRecords: [
          {
            id: "linein_record",
            source: "LINEIN",
            sourceInstance: "default",
            sourceLabel: "拍拍印",
            sourceManaged: true,
            managedFields: ["NAME"],
            sourcePartySize: 2,
            relationshipLabel: "舊關係",
            contactPhone: "0900-000-000",
            contactEmail: null,
            ceremonyAttendance: true,
            childSeatCount: null,
            vegetarianCount: null,
            invitationDelivery: null,
            mailingAddress: null,
            guestMessage: null,
            attendanceReply: null,
            invitationReply: null,
            sourceSubmittedAt: null,
          },
          {
            id: "manual_record",
            source: "MANUAL",
            sourceInstance: "guest-details",
            sourceLabel: "自行填寫",
            sourceManaged: false,
            managedFields: [],
            sourcePartySize: null,
            relationshipLabel: "目前關係",
            contactPhone: null,
            contactEmail: "new@example.test",
            ceremonyAttendance: false,
            childSeatCount: 0,
            vegetarianCount: 1,
            invitationDelivery: "DIGITAL",
            mailingAddress: null,
            guestMessage: "目前留言",
            attendanceReply: "目前回覆",
            invitationReply: "已傳送",
            sourceSubmittedAt: null,
          },
        ],
      },
    ]);

    const result = await listGuestsForWorkspace("workspace_1");

    expect(result.guests[0].details).toEqual({
      relationshipLabel: "目前關係",
      contactPhone: null,
      contactEmail: "new@example.test",
      ceremonyAttendance: false,
      childSeatCount: 0,
      vegetarianCount: 1,
      invitationDelivery: "DIGITAL",
      mailingAddress: null,
      guestMessage: "目前留言",
      attendanceReply: "目前回覆",
      invitationReply: "已傳送",
    });
  });

  it("resolves each guest's table number from the workspace seating order", async () => {
    // 第四順位是 5 號桌，不是 4 號。桌名可以重複，號碼才是賓客要看的身分。
    tableFindMany.mockResolvedValue([
      { id: "table_1" },
      { id: "table_2" },
      { id: "table_3" },
      { id: "table_4" },
    ]);
    findMany.mockResolvedValue([
      {
        id: "guest_seated",
        version: 0,
        name: "已入席賓客",
        category: "GUEST",
        side: "PARTNER_A",
        attendanceStatus: "ATTENDING",
        partySize: 2,
        notes: null,
        seatingTable: { id: "table_4", name: "同事桌" },
        importRecords: [],
      },
      {
        id: "guest_orphaned",
        version: 0,
        name: "指到不存在桌次的賓客",
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: 1,
        notes: null,
        seatingTable: { id: "table_removed", name: "已移除的桌" },
        importRecords: [],
      },
    ]);

    const result = await listGuestsForWorkspace("workspace_1");

    expect(result.guests[0]?.seatingTable).toEqual({
      number: 5,
      name: "同事桌",
    });
    // 查不到號碼就當作沒安排，而不是印一個錯的桌號讓賓客走到別桌去。
    expect(result.guests[1]?.seatingTable).toBeNull();
    expect(tableFindMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
      orderBy: [{ position: "asc" }],
      select: { id: true },
    });
  });

  it("loads table numbers and the guest rows concurrently after authorization", async () => {
    let resolveTables!: (rows: { id: string }[]) => void;
    let resolveGuests!: (rows: never[]) => void;
    tableFindMany.mockReturnValue(
      new Promise((resolve) => {
        resolveTables = resolve;
      }),
    );
    findMany.mockReturnValue(
      new Promise((resolve) => {
        resolveGuests = resolve;
      }),
    );

    const result = listGuestsForWorkspace("workspace_1");

    await vi.waitFor(() => {
      expect(tableFindMany).toHaveBeenCalledOnce();
      expect(findMany).toHaveBeenCalledOnce();
    });

    resolveTables([]);
    resolveGuests([]);
    await expect(result).resolves.toMatchObject({ guests: [] });
  });

  it("does not query guests when membership authorization fails", async () => {
    requireWorkspaceAccess.mockRejectedValue(new Error("denied"));

    await expect(listGuestsForWorkspace("workspace_1")).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("sanitizes guest database failures", async () => {
    findMany.mockRejectedValue(new Error("postgres://secret@database"));

    await expect(listGuestsForWorkspace("workspace_1")).rejects.toEqual(
      new GuestDataError("目前無法載入賓客名單，請稍後再試。"),
    );
  });
});
