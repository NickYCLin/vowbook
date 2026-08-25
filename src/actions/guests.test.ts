import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const {
  requireCurrentUser,
  requireWorkspaceAccess,
  requireLockedWorkspaceAccess,
  create,
  update,
  remove,
  findUnique,
  aggregate,
  tableFindUnique,
  detailsUpsert,
  transaction,
  revalidatePath,
} = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findUnique: vi.fn(),
  aggregate: vi.fn(),
  tableFindUnique: vi.fn(),
  detailsUpsert: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireCurrentUser }));
vi.mock("@/lib/workspace-access", () => ({ requireWorkspaceAccess }));
vi.mock("@/lib/workspace-mutation-access", () => ({
  requireLockedWorkspaceAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guest: { create, findUnique, aggregate, updateMany: update, deleteMany: remove },
    guestImportRecord: { upsert: detailsUpsert },
    seatingTable: { findUnique: tableFindUnique },
    $transaction: transaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createGuestAction,
  deleteGuestAction,
  updateGuestAction,
} from "./guests";

const idleState = { status: "idle" as const };

function validGuestFormData() {
  const formData = new FormData();
  formData.set("name", "  王小明   與家人  ");
  formData.set("category", "GUEST");
  formData.set("side", "SHARED");
  formData.set("attendanceStatus", "ATTENDING");
  formData.set("partySize", "3");
  formData.set("notes", "  需要兒童椅  ");
  formData.set("expectedVersion", "0");
  return formData;
}

function validDeleteFormData() {
  const formData = new FormData();
  formData.set("expectedVersion", "0");
  return formData;
}

describe("guest server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCurrentUser.mockResolvedValue({ id: "session_user" });
    requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    requireLockedWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    create.mockResolvedValue({ id: "guest_1" });
    update.mockResolvedValue({ count: 1 });
    remove.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 0,
      name: "王小明 與家人",
      category: "GUEST",
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize: 1,
      seatingTableId: null,
      importRecords: [],
    });
    aggregate.mockResolvedValue({ _sum: { partySize: 0 } });
    tableFindUnique.mockResolvedValue({ id: "table_1", capacity: 10 });
    transaction.mockImplementation(async (operation) =>
      operation({
        guest: { create, findUnique, aggregate, updateMany: update, deleteMany: remove },
        guestImportRecord: { upsert: detailsUpsert },
        seatingTable: { findUnique: tableFindUnique },
      }),
    );
  });

  it("creates only after session edit access and ignores forged identity fields", async () => {
    const formData = validGuestFormData();
    formData.set("workspaceId", "workspace_attacker");
    formData.set("userId", "attacker_user");
    formData.set("role", "OWNER");

    await expect(
      createGuestAction("workspace_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已新增賓客。" });

    expect(requireCurrentUser).toHaveBeenCalledWith();
    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        name: "王小明 與家人",
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: 3,
        notes: "需要兒童椅",
      },
    });
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/guests",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("persists an explicitly selected seniority for sorting", async () => {
    const formData = validGuestFormData();
    formData.set("seniority", "ELDER");

    await expect(
      createGuestAction("workspace_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已新增賓客。" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ seniority: "ELDER" }),
    });
  });

  it("returns a clear conflict when the same newlywed role already exists", async () => {
    const formData = validGuestFormData();
    formData.set("name", "另一位新郎");
    formData.set("category", "COUPLE");
    formData.set("side", "PARTNER_A");
    formData.set("partySize", "1");
    create.mockRejectedValue({ code: "P2002" });

    await expect(
      createGuestAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: "此工作區已經有新郎，請直接編輯原有資料。",
    });
  });

  it("stores optional details for a manually created guest without an import label", async () => {
    const formData = validGuestFormData();
    formData.set("relationshipLabel", "大學同學");
    formData.set("contactPhone", "0900-000-000");
    formData.set("contactEmail", "guest@example.test");
    formData.set("ceremonyAttendance", "ATTENDING");
    formData.set("childSeatCount", "1");
    formData.set("vegetarianCount", "0");
    formData.set("invitationDelivery", "DIGITAL");
    formData.set("attendanceReply", "會出席");
    formData.set("invitationReply", "已傳送");
    formData.set("guestMessage", "祝福新人");

    await expect(
      createGuestAction("workspace_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已新增賓客。" });

    expect(detailsUpsert).toHaveBeenCalledWith({
      where: {
        workspaceId_source_sourceInstance_externalId: {
          workspaceId: "workspace_1",
          source: "MANUAL",
          sourceInstance: "guest-details",
          externalId: "guest_1",
        },
      },
      create: expect.objectContaining({
        guestId: "guest_1",
        workspaceId: "workspace_1",
        source: "MANUAL",
        sourceInstance: "guest-details",
        sourceLabel: "自行填寫",
        sourceManaged: false,
        managedFields: [],
        externalId: "guest_1",
        relationshipLabel: "大學同學",
        contactPhone: "0900-000-000",
        contactEmail: "guest@example.test",
        ceremonyAttendance: true,
        childSeatCount: 1,
        vegetarianCount: 0,
        invitationDelivery: "DIGITAL",
        attendanceReply: "會出席",
        invitationReply: "已傳送",
        guestMessage: "祝福新人",
      }),
      update: expect.objectContaining({
        relationshipLabel: "大學同學",
        contactPhone: "0900-000-000",
      }),
    });
  });

  it("denies VIEWER mutations before validation or database access", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());
    const invalidFormData = new FormData();

    await expect(
      createGuestAction("workspace_1", idleState, invalidFormData),
    ).resolves.toEqual({
      status: "error",
      message: "無權存取此婚宴工作區。",
    });

    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("denies VIEWER updates and deletes before validation or database access", async () => {
    requireWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());

    await expect(
      updateGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "無權存取此婚宴工作區。",
    });
    await expect(
      deleteGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "無權存取此婚宴工作區。",
    });

    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("updates by guest id and workspace id together", async () => {
    const formData = validGuestFormData();
    formData.set("userId", "attacker_user");
    formData.set("role", "OWNER");

    await expect(
      updateGuestAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已更新賓客。" });

    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 0 },
      data: {
        name: "王小明 與家人",
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: 3,
        notes: "需要兒童椅",
        version: { increment: 1 },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/guests",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects stale Guest updates before overwriting a collaborator", async () => {
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 1,
      name: "較新的姓名",
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize: 2,
      seatingTableId: null,
      importRecords: [],
    });

    await expect(
      updateGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        validGuestFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "賓客資料已被更新或不存在，請重新整理後再試。",
    });
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a Guest update that loses the version CAS race", async () => {
    update.mockResolvedValue({ count: 0 });

    await expect(
      updateGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        validGuestFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "賓客資料已被更新或不存在，請重新整理後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("allows imported guest details to change and unseats a new decline", async () => {
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 0,
      name: "來源姓名",
      category: "GUEST",
      side: "PARTNER_A",
      attendanceStatus: "ATTENDING",
      partySize: 2,
      seatingTableId: "table_1",
      importRecords: [
        {
          sourceManaged: true,
          sourceLabel: "合成來源",
          managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS", "PARTY_SIZE"],
        },
      ],
    });
    const formData = validGuestFormData();
    formData.set("name", "臨時更正姓名");
    formData.set("side", "PARTNER_B");
    formData.set("attendanceStatus", "DECLINED");
    formData.set("partySize", "4");

    await expect(
      updateGuestAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({
      status: "success",
      message: "已更新賓客；已從桌次移除不出席者。",
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id_workspaceId: { id: "guest_1", workspaceId: "workspace_1" } },
      select: {
        id: true,
        version: true,
        seatingTableId: true,
      },
    });
    expect(tableFindUnique).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 0 },
      data: {
        name: "臨時更正姓名",
        category: "GUEST",
        side: "PARTNER_B",
        attendanceStatus: "DECLINED",
        partySize: 4,
        notes: "需要兒童椅",
        seatingTableId: null,
        version: { increment: 1 },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
  });

  it("saves editable details as a manual overlay without changing import provenance", async () => {
    const formData = validGuestFormData();
    formData.set("contactPhone", "0911-111-111");
    formData.set("ceremonyAttendance", "DECLINED");
    formData.set("invitationDelivery", "NONE");
    formData.set("invitationReply", "不需要喜帖");

    await expect(
      updateGuestAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已更新賓客。" });

    expect(detailsUpsert).toHaveBeenCalledWith({
      where: {
        workspaceId_source_sourceInstance_externalId: {
          workspaceId: "workspace_1",
          source: "MANUAL",
          sourceInstance: "guest-details",
          externalId: "guest_1",
        },
      },
      create: expect.objectContaining({
        guestId: "guest_1",
        contactPhone: "0911-111-111",
        ceremonyAttendance: false,
        invitationDelivery: "NONE",
        invitationReply: "不需要喜帖",
      }),
      update: expect.objectContaining({
        contactPhone: "0911-111-111",
        ceremonyAttendance: false,
        invitationDelivery: "NONE",
        invitationReply: "不需要喜帖",
      }),
    });
  });

  it("preserves existing details when a quick edit only sends core fields", async () => {
    await expect(
      updateGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        validGuestFormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新賓客。" });

    expect(detailsUpsert).not.toHaveBeenCalled();
  });

  it("allows core edits when every import record is an editable copy", async () => {
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 0,
      name: "來源姓名",
      side: "PARTNER_A",
      attendanceStatus: "ATTENDING",
      partySize: 2,
      seatingTableId: null,
      importRecords: [
        { sourceManaged: false, sourceLabel: "可編輯匯入", managedFields: [] },
        { sourceManaged: false, sourceLabel: "另一份副本", managedFields: [] },
      ],
    });

    await expect(
      updateGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        validGuestFormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新賓客。" });

    expect(update).toHaveBeenCalledOnce();
  });

  it("allows a notes-only edit when a managed source owns only the core fields", async () => {
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 0,
      name: "王小明 與家人",
      category: "GUEST",
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize: 3,
      seatingTableId: null,
      importRecords: [
        {
          sourceManaged: true,
          sourceLabel: "合成來源",
          managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS", "PARTY_SIZE"],
        },
      ],
    });

    await expect(
      updateGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        validGuestFormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "已更新賓客。" });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: "需要兒童椅" }),
      }),
    );
  });

  it("saves changes even when an import source previously managed a field", async () => {
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 0,
      name: "來源姓名",
      side: "PARTNER_A",
      attendanceStatus: "UNDECIDED",
      partySize: 1,
      seatingTableId: null,
      importRecords: [
        {
          sourceManaged: true,
          sourceLabel: "部分管理來源",
          managedFields: ["NAME"],
        },
      ],
    });
    const formData = validGuestFormData();
    formData.set("name", "來源姓名");
    formData.set("side", "PARTNER_B");
    formData.set("attendanceStatus", "ATTENDING");
    formData.set("partySize", "4");
    formData.set("notes", "人工補充仍可編輯");

    await expect(
      updateGuestAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已更新賓客。" });

    expect(update).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 0 },
      data: {
        name: "來源姓名",
        category: "GUEST",
        side: "PARTNER_B",
        attendanceStatus: "ATTENDING",
        partySize: 4,
        notes: "人工補充仍可編輯",
        version: { increment: 1 },
      },
    });
  });

  it("allows a LINEIN guest to update party size when LINEIN no longer manages it", async () => {
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 0,
      name: "王小明 與家人",
      category: "GUEST",
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize: 2,
      seatingTableId: null,
      importRecords: [
        {
          source: "LINEIN",
          sourceManaged: true,
          sourceLabel: "拍拍印",
          managedFields: ["NAME", "SIDE", "ATTENDANCE_STATUS"],
        },
      ],
    });
    const formData = validGuestFormData();
    formData.set("partySize", "4");

    await expect(
      updateGuestAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已更新賓客。" });

    expect(update).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 0 },
      data: {
        name: "王小明 與家人",
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: 4,
        notes: "需要兒童椅",
        version: { increment: 1 },
      },
    });
  });

  it("allows party-size edits for a generic imported source", async () => {
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 0,
      name: "王小明 與家人",
      category: "GUEST",
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize: 2,
      seatingTableId: null,
      importRecords: [
        {
          source: "FUTURE_RSVP",
          sourceManaged: true,
          sourceLabel: "未來來源",
          managedFields: ["PARTY_SIZE"],
        },
      ],
    });
    const formData = validGuestFormData();
    formData.set("partySize", "4");

    await expect(
      updateGuestAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({ status: "success", message: "已更新賓客。" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 0 },
      data: {
        name: "王小明 與家人",
        category: "GUEST",
        side: "SHARED",
        attendanceStatus: "ATTENDING",
        partySize: 4,
        notes: "需要兒童椅",
        version: { increment: 1 },
      },
    });
  });

  it("blocks a cross-workspace guest id and sanitizes the database error", async () => {
    update.mockRejectedValue(
      new Error("Record guest_2 belongs to workspace_secret"),
    );

    await expect(
      updateGuestAction(
        "workspace_1",
        "guest_from_workspace_2",
        idleState,
        validGuestFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "目前無法更新賓客，請稍後再試。",
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "guest_from_workspace_2",
          workspaceId: "workspace_1",
          version: 0,
        },
      }),
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes by guest id and workspace id together", async () => {
    await expect(
      deleteGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        validDeleteFormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "已刪除賓客。" });

    expect(requireWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
    );
    expect(requireCurrentUser.mock.invocationCallOrder[0]).toBeLessThan(
      requireWorkspaceAccess.mock.invocationCallOrder[0],
    );
    expect(remove).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 0 },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/guests",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/tables",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects a stale Guest delete without removing newer data", async () => {
    remove.mockResolvedValue({ count: 0 });

    await expect(
      deleteGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        validDeleteFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "賓客資料已被更新或不存在，請重新整理後再試。",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("prevents an assigned guest party-size edit from exceeding table capacity", async () => {
    findUnique.mockResolvedValue({
      id: "guest_1",
      version: 0,
      name: "王小明 與家人",
      category: "GUEST",
      side: "SHARED",
      attendanceStatus: "ATTENDING",
      partySize: 2,
      seatingTableId: "table_1",
      importRecords: [],
    });
    tableFindUnique.mockResolvedValue({ id: "table_1", capacity: 10 });
    aggregate.mockResolvedValue({ _sum: { partySize: 8 } });
    const formData = validGuestFormData();
    formData.set("partySize", "3");

    await expect(
      updateGuestAction("workspace_1", "guest_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: "調整人數後會超過桌次容量，請先重新安排座位。",
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        seatingTableId: "table_1",
        NOT: { id: "guest_1" },
      },
      _sum: { partySize: true },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("returns readable validation errors without leaking or querying", async () => {
    const formData = validGuestFormData();
    formData.set("partySize", "21");

    await expect(
      createGuestAction("workspace_1", idleState, formData),
    ).resolves.toEqual({
      status: "error",
      message: "邀請人數需為 1 到 20 的整數。",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("sanitizes create and delete database errors", async () => {
    create.mockRejectedValue(new Error("database secret"));
    remove.mockRejectedValue(new Error("database secret"));

    await expect(
      createGuestAction("workspace_1", idleState, validGuestFormData()),
    ).resolves.toEqual({
      status: "error",
      message: "目前無法新增賓客，請稍後再試。",
    });
    await expect(
      deleteGuestAction(
        "workspace_1",
        "guest_1",
        idleState,
        validDeleteFormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "目前無法刪除賓客，請稍後再試。",
    });
  });

  it("sanitizes membership lookup failures without touching guest data", async () => {
    requireWorkspaceAccess.mockRejectedValue(
      new Error("membership database contains secret"),
    );

    await expect(
      createGuestAction("workspace_1", idleState, validGuestFormData()),
    ).resolves.toEqual({
      status: "error",
      message: "目前無法確認工作區權限，請稍後再試。",
    });
    expect(create).not.toHaveBeenCalled();
  });
});
