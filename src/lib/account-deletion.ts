import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeInvitationEmail } from "@/domain/workspace-invitation";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";

/**
 * 使用者自己刪除帳號。和系統管理刪除不同：別人還在用的婚宴不能跟著消失。
 *
 * - 只剩自己的婚宴：整場刪除，名單、桌次、花費、附件都跟著 cascade。
 * - 還有其他擁有者：只移出自己；自己建立的婚宴改掛到那位擁有者名下，
 *   自己上傳的收據也改掛給他，對方的花費紀錄才不會少附件。
 * - 沒有其他擁有者但有伴侶：伴侶升為擁有者接手，預覽會先講清楚。
 * - 只剩婚顧或檢視者：擋下來。婚宴不能交給廠商或賓客，請先在網站移除協作者或刪掉婚宴。
 */

export class AccountDeletionConfirmationError extends Error {
  constructor() {
    super("請輸入你登入用的 Email 再確認一次。");
    this.name = "AccountDeletionConfirmationError";
  }
}

export class AccountDeletionBlockedError extends Error {
  constructor(public readonly workspaceNames: string[]) {
    super(
      `「${workspaceNames.join("」「")}」還有其他協作者，但沒有伴侶可以接手。請先到網站移除協作者或刪掉這場婚宴，再刪除帳號。`,
    );
    this.name = "AccountDeletionBlockedError";
  }
}

export class AccountDeletionMissingError extends Error {
  constructor() {
    super("找不到這個帳號，可能已經刪除。");
    this.name = "AccountDeletionMissingError";
  }
}

type Tx = Prisma.TransactionClient;

type WorkspaceRef = { id: string; name: string };

export type AccountDeletionPlan = {
  email: string;
  /** 只剩自己，會整場刪除。 */
  deleted: WorkspaceRef[];
  /** 還有其他人在用，只把自己移出。 */
  left: WorkspaceRef[];
  /** 沒有其他擁有者，由伴侶升為擁有者接手。 */
  handedOver: WorkspaceRef[];
  /** 只剩婚顧或檢視者，不能直接刪帳號。 */
  blocked: WorkspaceRef[];
  /** 留下來的婚宴改由誰接手建立者與收據。 */
  heirs: Map<string, string>;
  /** 要升為擁有者的伴侶。 */
  promotions: Map<string, string>;
};

async function planFor(tx: Tx, userId: string): Promise<AccountDeletionPlan> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new AccountDeletionMissingError();

  const workspaces = await tx.weddingWorkspace.findMany({
    where: { OR: [{ createdById: userId }, { memberships: { some: { userId } } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      memberships: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { userId: true, role: true },
      },
    },
  });

  const plan: AccountDeletionPlan = {
    email: user.email, deleted: [], left: [], handedOver: [], blocked: [], heirs: new Map(), promotions: new Map(),
  };
  for (const workspace of workspaces) {
    const ref = { id: workspace.id, name: workspace.name };
    const others = workspace.memberships.filter((member) => member.userId !== userId);
    if (others.length === 0) {
      plan.deleted.push(ref);
      continue;
    }
    const owner = others.find((member) => member.role === "OWNER");
    if (owner) {
      plan.left.push(ref);
      plan.heirs.set(workspace.id, owner.userId);
      continue;
    }
    const partner = others.find((member) => member.role === "PARTNER");
    if (partner) {
      plan.handedOver.push(ref);
      plan.heirs.set(workspace.id, partner.userId);
      plan.promotions.set(workspace.id, partner.userId);
      continue;
    }
    plan.blocked.push(ref);
  }
  return plan;
}

export async function previewAccountDeletion(
  userId: string,
  client: Pick<PrismaClient, "$transaction"> = prisma,
) {
  const plan = await client.$transaction((tx) => planFor(tx, userId));
  return {
    email: plan.email,
    deleted: plan.deleted.map((item) => item.name),
    left: plan.left.map((item) => item.name),
    handedOver: plan.handedOver.map((item) => item.name),
    blocked: plan.blocked.map((item) => item.name),
  };
}

export async function deleteOwnAccount(
  userId: string,
  confirmationEmail: unknown,
  client: Pick<PrismaClient, "$transaction"> = prisma,
) {
  return runSerializableTransaction(async (tx) => {
    const plan = await planFor(tx, userId);
    let typed: string;
    try {
      typed = normalizeInvitationEmail(confirmationEmail);
    } catch {
      throw new AccountDeletionConfirmationError();
    }
    if (typed !== normalizeInvitationEmail(plan.email)) throw new AccountDeletionConfirmationError();
    if (plan.blocked.length > 0) throw new AccountDeletionBlockedError(plan.blocked.map((item) => item.name));

    if (plan.deleted.length > 0) {
      await tx.weddingWorkspace.deleteMany({ where: { id: { in: plan.deleted.map((item) => item.id) } } });
    }
    for (const [workspaceId, partnerId] of plan.promotions) {
      await tx.membership.updateMany({
        where: { workspaceId, userId: partnerId, role: "PARTNER" },
        data: { role: "OWNER" },
      });
    }
    for (const [workspaceId, heirId] of plan.heirs) {
      await tx.weddingWorkspace.updateMany({
        where: { id: workspaceId, createdById: userId },
        data: { createdById: heirId },
      });
      await tx.budgetAttachment.updateMany({
        where: { workspaceId, uploadedByUserId: userId },
        data: { uploadedByUserId: heirId },
      });
    }
    // 邀請紀錄的關聯是 Restrict：接受過的只清掉接受者，自己發出的邀請直接刪。
    await tx.workspaceInvitation.updateMany({
      where: { acceptedByUserId: userId },
      data: { acceptedByUserId: null },
    });
    await tx.workspaceInvitation.deleteMany({ where: { invitedByUserId: userId } });

    // 成員身分、手機登入與頭像都是 Cascade，隨帳號一起刪。
    const removed = await tx.user.deleteMany({ where: { id: userId } });
    if (removed.count !== 1) throw new AccountDeletionMissingError();
    return {
      deletedWorkspaceCount: plan.deleted.length,
      leftWorkspaceCount: plan.left.length + plan.handedOver.length,
    };
  }, client);
}
