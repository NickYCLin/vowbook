import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  AccountDeletionBlockedError,
  AccountDeletionConfirmationError,
  deleteOwnAccount,
  previewAccountDeletion,
} from "./account-deletion";

type Member = { userId: string; role: "OWNER" | "PARTNER" | "PLANNER" | "VIEWER" };

function fakeClient(workspaces: Array<{ id: string; name: string; memberships: Member[] }>) {
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: "Me@Example.com" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    weddingWorkspace: {
      findMany: vi.fn().mockResolvedValue(workspaces),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    membership: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    budgetAttachment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workspaceInvitation: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const client = { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) };
  return { tx, client: client as never };
}

const solo = { id: "w1", name: "只有我", memberships: [{ userId: "me", role: "OWNER" as const }] };
const shared = {
  id: "w2", name: "有另一位擁有者",
  memberships: [{ userId: "me", role: "OWNER" as const }, { userId: "other", role: "OWNER" as const }],
};
const partnerOnly = {
  id: "w3", name: "伴侶接手",
  memberships: [{ userId: "me", role: "OWNER" as const }, { userId: "partner", role: "PARTNER" as const }],
};
const plannerOnly = {
  id: "w4", name: "只剩婚顧",
  memberships: [{ userId: "me", role: "OWNER" as const }, { userId: "planner", role: "PLANNER" as const }],
};

describe("刪除自己的帳號", () => {
  beforeEach(() => vi.clearAllMocks());

  it("預覽把婚宴分成刪除、退出、交給伴侶與擋下", async () => {
    const { client } = fakeClient([solo, shared, partnerOnly, plannerOnly]);
    expect(await previewAccountDeletion("me", client)).toEqual({
      email: "Me@Example.com",
      deleted: ["只有我"],
      left: ["有另一位擁有者"],
      handedOver: ["伴侶接手"],
      blocked: ["只剩婚顧"],
    });
  });

  it("Email 對不上就不刪", async () => {
    const { tx, client } = fakeClient([solo]);
    await expect(deleteOwnAccount("me", "someone@example.com", client)).rejects.toBeInstanceOf(
      AccountDeletionConfirmationError,
    );
    await expect(deleteOwnAccount("me", 42, client)).rejects.toBeInstanceOf(AccountDeletionConfirmationError);
    expect(tx.user.deleteMany).not.toHaveBeenCalled();
  });

  it("只剩婚顧的婚宴會擋下，什麼都不刪", async () => {
    const { tx, client } = fakeClient([solo, plannerOnly]);
    await expect(deleteOwnAccount("me", "me@example.com", client)).rejects.toBeInstanceOf(
      AccountDeletionBlockedError,
    );
    expect(tx.weddingWorkspace.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.deleteMany).not.toHaveBeenCalled();
  });

  it("只刪自己的婚宴，別人在用的交給擁有者或伴侶", async () => {
    const { tx, client } = fakeClient([solo, shared, partnerOnly]);
    expect(await deleteOwnAccount("me", " ME@example.com ", client)).toEqual({
      deletedWorkspaceCount: 1,
      leftWorkspaceCount: 2,
    });
    expect(tx.weddingWorkspace.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["w1"] } } });
    expect(tx.membership.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.membership.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "w3", userId: "partner", role: "PARTNER" },
      data: { role: "OWNER" },
    });
    expect(tx.weddingWorkspace.updateMany).toHaveBeenCalledWith({
      where: { id: "w2", createdById: "me" }, data: { createdById: "other" },
    });
    expect(tx.budgetAttachment.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "w3", uploadedByUserId: "me" }, data: { uploadedByUserId: "partner" },
    });
    expect(tx.workspaceInvitation.deleteMany).toHaveBeenCalledWith({ where: { invitedByUserId: "me" } });
    expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { id: "me" } });
  });
});
