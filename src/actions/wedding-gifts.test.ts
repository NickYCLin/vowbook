import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  requireLockedWorkspaceAccess: vi.fn(),
  guestFindFirst: vi.fn(),
  guestUpdateMany: vi.fn(),
  giftCreate: vi.fn(),
  giftFindFirst: vi.fn(),
  giftUpdateMany: vi.fn(),
  giftDeleteMany: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

const transactionClient = {
  guest: { findFirst: mocks.guestFindFirst, updateMany: mocks.guestUpdateMany },
  weddingGift: {
    create: mocks.giftCreate,
    findFirst: mocks.giftFindFirst,
    updateMany: mocks.giftUpdateMany,
    deleteMany: mocks.giftDeleteMany,
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
  setGuestGiftExemptionAction,
  createWeddingGiftAction,
  deleteWeddingGiftAction,
  setWeddingGiftReturnAction,
  updateWeddingGiftAction,
} from "./wedding-gifts";

const idleState = { status: "idle" as const };

function giftForm({
  amount = "12000",
  notes = "  大學同學桌  ",
  expectedVersion,
}: {
  amount?: string;
  notes?: string;
  expectedVersion?: string;
} = {}) {
  const form = new FormData();
  form.set("amount", amount);
  form.set("notes", notes);
  if (expectedVersion !== undefined) {
    form.set("expectedVersion", expectedVersion);
  }
  return form;
}

describe("wedding gift actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ id: "session_user" });
    mocks.requireWorkspaceAccess.mockResolvedValue({
      role: "PLANNER",
      workspace: { id: "workspace_1" },
    });
    mocks.requireLockedWorkspaceAccess.mockResolvedValue("PLANNER");
    mocks.guestFindFirst.mockResolvedValue({ id: "guest_1", category: "GUEST", giftExemptWithCake: false, importRecords: [] });
    mocks.giftCreate.mockResolvedValue({
      id: "gift_1",
      amount: 12_000,
      notes: "大學同學桌",
      version: 0,
    });
    mocks.giftUpdateMany.mockResolvedValue({ count: 1 });
    mocks.giftFindFirst.mockResolvedValue({
      id: "gift_1",
      amount: 3600,
      notes: null,
      version: 5,
    });
    mocks.giftDeleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (operation) =>
      operation(transactionClient),
    );
  });

  it("marks a return gift as sent with a server timestamp under version CAS", async () => {
    mocks.giftFindFirst
      .mockResolvedValueOnce({
        id: "gift_1",
        amount: 3600,
        notes: null,
        returnGiftSentAt: null,
        returnGiftNote: null,
        version: 2,
      })
      .mockResolvedValueOnce({
        id: "gift_1",
        amount: 3600,
        notes: null,
        returnGiftSentAt: new Date("2026-09-05T02:00:00.000Z"),
        returnGiftNote: "寄了 2 盒喜餅",
        version: 3,
      });
    const form = new FormData();
    form.set("expectedVersion", "2");
    form.set("returnGiftSent", "on");
    form.set("returnGiftNote", "  寄了 2 盒喜餅  ");
    // client 送來的時間一律忽略。
    form.set("returnGiftSentAt", "1999-01-01T00:00:00.000Z");

    await expect(
      setWeddingGiftReturnAction("workspace_1", "gift_1", idleState, form),
    ).resolves.toMatchObject({
      status: "success",
      message: "已標記為已回禮。",
    });

    const update = mocks.giftUpdateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: { returnGiftSentAt: Date | null; returnGiftNote: string | null };
    };
    expect(update.where).toEqual({
      id: "gift_1",
      workspaceId: "workspace_1",
      version: 2,
    });
    expect(update.data.returnGiftNote).toBe("寄了 2 盒喜餅");
    expect(update.data.returnGiftSentAt).toBeInstanceOf(Date);
    expect(update.data.returnGiftSentAt?.getFullYear()).toBeGreaterThan(2000);
  });

  it("keeps the original sent timestamp when the same gift is marked again", async () => {
    const original = new Date("2026-09-05T02:00:00.000Z");
    mocks.giftFindFirst.mockResolvedValue({
      id: "gift_1",
      amount: 3600,
      notes: null,
      returnGiftSentAt: original,
      returnGiftNote: null,
      version: 2,
    });
    const form = new FormData();
    form.set("expectedVersion", "2");
    form.set("returnGiftSent", "on");

    await expect(
      setWeddingGiftReturnAction("workspace_1", "gift_1", idleState, form),
    ).resolves.toMatchObject({ status: "success" });

    const update = mocks.giftUpdateMany.mock.calls[0]?.[0] as {
      data: { returnGiftSentAt: Date | null };
    };
    expect(update.data.returnGiftSentAt).toBe(original);
  });

  it("clears the sent timestamp when the checkbox is not submitted", async () => {
    mocks.giftFindFirst.mockResolvedValue({
      id: "gift_1",
      amount: 3600,
      notes: null,
      returnGiftSentAt: new Date("2026-09-05T02:00:00.000Z"),
      returnGiftNote: "寄了 2 盒喜餅",
      version: 2,
    });
    const form = new FormData();
    form.set("expectedVersion", "2");
    form.set("returnGiftNote", "寄了 2 盒喜餅");

    await expect(
      setWeddingGiftReturnAction("workspace_1", "gift_1", idleState, form),
    ).resolves.toMatchObject({
      status: "success",
      message: "已改回尚未回禮。",
    });
    const update = mocks.giftUpdateMany.mock.calls[0]?.[0] as {
      data: { returnGiftSentAt: Date | null };
    };
    expect(update.data.returnGiftSentAt).toBeNull();
  });

  it("refuses a return update whose expected version no longer matches", async () => {
    mocks.giftFindFirst.mockResolvedValue({
      id: "gift_1",
      amount: 3600,
      notes: null,
      returnGiftSentAt: null,
      returnGiftNote: null,
      version: 5,
    });
    const form = new FormData();
    form.set("expectedVersion", "2");
    form.set("returnGiftSent", "on");

    await expect(
      setWeddingGiftReturnAction("workspace_1", "gift_1", idleState, form),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(mocks.giftUpdateMany).not.toHaveBeenCalled();
  });

  it.each(["yes", "1", "true"])(
    "rejects the forged return-gift flag %j before opening a transaction",
    async (value) => {
      const form = new FormData();
      form.set("expectedVersion", "2");
      form.set("returnGiftSent", value);

      await expect(
        setWeddingGiftReturnAction("workspace_1", "gift_1", idleState, form),
      ).resolves.toMatchObject({
        status: "error",
        code: "VALIDATION",
        message: "回禮狀態無效，請重新整理後再試。",
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it("refuses a return update for a viewer without opening a transaction", async () => {
    mocks.requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );
    const form = new FormData();
    form.set("expectedVersion", "2");

    await expect(
      setWeddingGiftReturnAction("workspace_1", "gift_1", idleState, form),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects registration for a currently exempt guest even from a stale client", async () => {
    mocks.guestFindFirst.mockResolvedValue({id:"guest_1",giftExemptWithCake:true,importRecords:[]});
    await expect(createWeddingGiftAction("workspace_1","guest_1",idleState,giftForm())).resolves.toMatchObject({status:"error",code:"VALIDATION",message:"此親友不收禮金（新人、雙方父母手足或已設定不收禮金），無法新增登記。"});
    expect(mocks.giftCreate).not.toHaveBeenCalled();
  });

  it.each(["父親","母親","哥哥","弟弟","姊姊","妹妹"])("rejects direct registration for %s", async relationshipLabel => {
    mocks.guestFindFirst.mockResolvedValue({id:"guest_1",importRecords:[{source:"MANUAL",sourceInstance:"guest-details",sourceManaged:false,relationshipLabel}],giftExemptWithCake:false,category:"FAMILY"});
    expect(await createWeddingGiftAction("workspace_1","guest_1",idleState,giftForm())).toMatchObject({status:"error",code:"VALIDATION"});
    expect(mocks.giftCreate).not.toHaveBeenCalled();
  });

  it("uses imported relationship labels when no manual details exist", async () => {
    mocks.guestFindFirst.mockResolvedValue({
      id: "guest_1", category: "FAMILY", giftExemptWithCake: false,
      importRecords: [{ source: "LINEIN", sourceInstance: "rsvp", sourceManaged: true, relationshipLabel: "父親" }],
    });
    expect(await createWeddingGiftAction("workspace_1", "guest_1", idleState, giftForm()))
      .toMatchObject({ status: "error", code: "VALIDATION" });
    expect(mocks.giftCreate).not.toHaveBeenCalled();
  });

  it("respects manually cleared relationship labels over old imports", async () => {
    mocks.guestFindFirst.mockResolvedValue({
      id: "guest_1", category: "GUEST", giftExemptWithCake: false,
      importRecords: [
        { source: "LINEIN", sourceInstance: "rsvp", sourceManaged: true, relationshipLabel: "父親" },
        { source: "MANUAL", sourceInstance: "guest-details", sourceManaged: false, relationshipLabel: null },
      ],
    });
    expect(await createWeddingGiftAction("workspace_1", "guest_1", idleState, giftForm()))
      .toMatchObject({ status: "success" });
    expect(mocks.giftCreate).toHaveBeenCalledOnce();
  });

  it("authorizes before validation and refuses a viewer without opening a transaction", async () => {
    mocks.requireWorkspaceAccess.mockRejectedValueOnce(
      new WorkspaceAccessDeniedError(),
    );

    await expect(
      createWeddingGiftAction(
        "workspace_1",
        "guest_1",
        idleState,
        giftForm({ amount: "forged" }),
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
      createWeddingGiftAction(
        "workspace_1",
        "guest_1",
        idleState,
        giftForm(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "FORBIDDEN" });

    expect(mocks.requireLockedWorkspaceAccess).toHaveBeenCalledWith(
      "workspace_1",
      "session_user",
      "edit",
      transactionClient,
    );
    expect(mocks.guestFindFirst).not.toHaveBeenCalled();
    expect(mocks.giftCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("creates one record only for the route-bound same-workspace invitation group and ignores client identity", async () => {
    const form = giftForm();
    form.set("workspaceId", "workspace_attacker");
    form.set("guestId", "guest_attacker");
    form.set("userId", "attacker");
    form.set("version", "99");

    await expect(
      createWeddingGiftAction("workspace_1", "guest_1", idleState, form),
    ).resolves.toEqual({
      status: "success",
      message: "已登記禮金。",
      gift: {
        id: "gift_1",
        amount: 12_000,
        notes: "大學同學桌",
        version: 0,
      },
    });

    expect(mocks.guestFindFirst).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1" },
      select: { id: true, giftExemptWithCake: true, category: true, importRecords: {
        orderBy: [{ source: "asc" }, { sourceInstance: "asc" }],
        select: { source: true, sourceInstance: true, sourceManaged: true, relationshipLabel: true },
      } },
    });
    expect(mocks.giftCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        guestId: "guest_1",
        amount: 12_000,
        notes: "大學同學桌",
      },
      select: {
        id: true,
        amount: true,
        notes: true,
        returnGiftSentAt: true,
        returnGiftNote: true,
        version: true,
      },
    });
  });

  it("returns stale for a cross-workspace guest or a concurrent create conflict", async () => {
    mocks.guestFindFirst.mockResolvedValueOnce(null);
    await expect(
      createWeddingGiftAction(
        "workspace_1",
        "foreign_guest",
        idleState,
        giftForm(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
    expect(mocks.giftCreate).not.toHaveBeenCalled();

    mocks.guestFindFirst.mockResolvedValueOnce({ id: "guest_1", category: "GUEST", giftExemptWithCake: false, importRecords: [] });
    mocks.giftCreate.mockRejectedValueOnce({ code: "P2002" });
    await expect(
      createWeddingGiftAction(
        "workspace_1",
        "guest_1",
        idleState,
        giftForm(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    mocks.guestFindFirst.mockResolvedValueOnce({ id: "guest_1", category: "GUEST", giftExemptWithCake: false, importRecords: [] });
    mocks.giftCreate.mockRejectedValueOnce({ code: "P2003" });
    await expect(
      createWeddingGiftAction(
        "workspace_1",
        "guest_1",
        idleState,
        giftForm(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });
  });

  it("updates by route-bound gift id with workspace plus version CAS", async () => {
    const form = giftForm({ amount: "3600", notes: " ", expectedVersion: "4" });
    form.set("giftId", "gift_attacker");

    await expect(
      updateWeddingGiftAction("workspace_1", "gift_1", idleState, form),
    ).resolves.toEqual({
      status: "success",
      message: "已更新禮金。",
      gift: {
        id: "gift_1",
        amount: 3600,
        notes: null,
        version: 5,
      },
    });

    expect(mocks.giftUpdateMany).toHaveBeenCalledWith({
      where: { id: "gift_1", workspaceId: "workspace_1", version: 4 },
      data: {
        amount: 3600,
        notes: null,
        version: { increment: 1 },
      },
    });
    expect(mocks.giftFindFirst).toHaveBeenCalledWith({
      where: { id: "gift_1", workspaceId: "workspace_1" },
      select: {
        id: true,
        amount: true,
        notes: true,
        returnGiftSentAt: true,
        returnGiftNote: true,
        version: true,
      },
    });
  });

  it("returns stale and refreshes the guest view when update or delete CAS does not match", async () => {
    mocks.giftUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      updateWeddingGiftAction(
        "workspace_1",
        "foreign_gift",
        idleState,
        giftForm({ expectedVersion: "3" }),
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    mocks.giftDeleteMany.mockResolvedValueOnce({ count: 0 });
    const deleteForm = new FormData();
    deleteForm.set("expectedVersion", "3");
    await expect(
      deleteWeddingGiftAction(
        "workspace_1",
        "foreign_gift",
        idleState,
        deleteForm,
      ),
    ).resolves.toMatchObject({ status: "error", code: "STALE" });

    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(
      1,
      "/workspaces/workspace_1/gifts",
    );
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(
      2,
      "/workspaces/workspace_1/gifts",
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith(
      "/workspaces/workspace_1/overview",
    );
  });

  it("deletes by id + workspace + version and revalidates guests plus anonymous overview", async () => {
    const form = new FormData();
    form.set("expectedVersion", "7");

    await expect(
      deleteWeddingGiftAction("workspace_1", "gift_1", idleState, form),
    ).resolves.toEqual({
      status: "success",
      message: "已移除禮金紀錄。",
    });

    expect(mocks.giftDeleteMany).toHaveBeenCalledWith({
      where: { id: "gift_1", workspaceId: "workspace_1", version: 7 },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/gifts",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/overview",
    );
  });

  it("keeps an authoritative committed success when cache revalidation fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.revalidatePath.mockRejectedValueOnce(new Error("secret cache failure"));
    mocks.giftFindFirst.mockResolvedValueOnce({
      id: "gift_1",
      amount: 3600,
      notes: "更新",
      version: 5,
    });

    await expect(
      updateWeddingGiftAction(
        "workspace_1",
        "gift_1",
        idleState,
        giftForm({ amount: "3600", notes: "更新", expectedVersion: "4" }),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "已更新禮金；畫面未自動更新，請重新整理。",
      gift: { id: "gift_1", amount: 3600, notes: "更新", version: 5 },
    });
    expect(mocks.giftUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(4);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspaces/workspace_1/guests");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/workspaces/workspace_1/overview",
    );
    expect(log).toHaveBeenCalledWith("禮金頁面重新驗證失敗。");
    expect(log).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it("strictly validates the amount, notes, and required update/delete version", async () => {
    for (const form of [
      giftForm({ amount: "0" }),
      giftForm({ amount: "1.5" }),
      giftForm({ notes: "x".repeat(501) }),
    ]) {
      await expect(
        createWeddingGiftAction(
          "workspace_1",
          "guest_1",
          idleState,
          form,
        ),
      ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
    }

    await expect(
      updateWeddingGiftAction(
        "workspace_1",
        "gift_1",
        idleState,
        giftForm(),
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });

    const deleteForm = new FormData();
    deleteForm.set("expectedVersion", "01");
    await expect(
      deleteWeddingGiftAction(
        "workspace_1",
        "gift_1",
        idleState,
        deleteForm,
      ),
    ).resolves.toMatchObject({ status: "error", code: "VALIDATION" });
  });
});

describe("guest gift exemption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ id: "session_user" });
    mocks.requireWorkspaceAccess.mockResolvedValue({ role: "OWNER" });
    mocks.requireLockedWorkspaceAccess.mockResolvedValue("OWNER");
    mocks.transaction.mockImplementation(async (callback) => callback(transactionClient));
    mocks.guestUpdateMany.mockResolvedValue({ count: 1 });
  });
  function form(value = "on") {
    const data = new FormData();
    data.set("expectedVersion", "2");
    data.set("giftExemptWithCake", value);
    return data;
  }
  it.each(["on", "off"])("saves %s without creating or changing a gift", async (value) => {
    const result = await setGuestGiftExemptionAction("workspace_1", "guest_1", idleState, form(value));
    expect(result.status).toBe("success");
    expect(mocks.requireLockedWorkspaceAccess).toHaveBeenCalled();
    expect(mocks.guestUpdateMany).toHaveBeenCalledWith({
      where: { id: "guest_1", workspaceId: "workspace_1", version: 2 },
      data: { giftExemptWithCake: value === "on", version: { increment: 1 } },
    });
    expect(mocks.giftCreate).not.toHaveBeenCalled();
    expect(mocks.giftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspaces/workspace_1/gifts/print");
  });
  it("rejects stale or other-workspace guests", async () => {
    mocks.guestUpdateMany.mockResolvedValue({ count: 0 });
    expect(await setGuestGiftExemptionAction("workspace_1", "guest_1", idleState, form())).toMatchObject({ status: "error", code: "STALE" });
  });
  it("rejects invalid input before mutation", async () => {
    expect(await setGuestGiftExemptionAction("workspace_1", "guest_1", idleState, form("true"))).toMatchObject({ status: "error", code: "VALIDATION" });
    expect(mocks.guestUpdateMany).not.toHaveBeenCalled();
  });
  it("denies viewers and revoked membership", async () => {
    mocks.requireLockedWorkspaceAccess.mockRejectedValue(new WorkspaceAccessDeniedError());
    expect(await setGuestGiftExemptionAction("workspace_1", "guest_1", idleState, form())).toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(mocks.guestUpdateMany).not.toHaveBeenCalled();
  });
});
