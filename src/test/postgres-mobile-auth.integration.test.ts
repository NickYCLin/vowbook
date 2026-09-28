import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { issueLoginGrant, exchangeGrant, requireMobileUser, revokeMobileSession } from "@/lib/mobile/session";
import { pkceChallenge, digest } from "@/lib/mobile/protocol";
import { listWorkspaceOverviewsForUser } from "@/lib/workspace-overview";
import { createWorkspaceForUser } from "@/lib/create-workspace";
const suite = process.env.VOWBOOK_DB_INTEGRATION === "1" ? describe : describe.skip;
const prefix = `mobile-it-${process.pid}-`;
let sequence = 0;
const verifier = "V".repeat(43);
const bearer = (token: string) => new Request("https://example.test", { headers: { Authorization: `Bearer ${token}` } });
async function user() {
  const subject = `${prefix}${sequence++}`;
  return prisma.user.create({ data: { googleSubject: subject, email: `${subject}@example.test` } });
}
suite("mobile authorization against PostgreSQL", () => {
  afterAll(async () => {
    await prisma.weddingWorkspace.deleteMany({ where: { createdBy: { googleSubject: { startsWith: prefix } } } });
    await prisma.user.deleteMany({ where: { googleSubject: { startsWith: prefix } } });
    await prisma.$disconnect();
  });
  it("allows exactly one concurrent exchange and never stores plaintext credentials", async () => {
    const identity = await user();
    const code = await issueLoginGrant(identity.id, pkceChallenge(verifier));
    const results = await Promise.allSettled([exchangeGrant({ code, verifier }), exchangeGrant({ code, verifier })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const winner = results.find((r) => r.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("Missing successful exchange");
    const rows = await prisma.mobileSession.findMany({ where: { userId: identity.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(digest(winner.value.token));
    expect(await prisma.mobileLoginGrant.count({ where: { codeHash: digest(code) } })).toBe(0);
  });
  it("rejects wrong PKCE without consuming the legitimate grant, expired codes and blocked users", async () => {
    const identity = await user();
    const code = await issueLoginGrant(identity.id, pkceChallenge(verifier));
    await expect(exchangeGrant({ code, verifier: "W".repeat(43) })).rejects.toMatchObject({ status: 401 });
    expect(await prisma.mobileLoginGrant.count({ where: { codeHash: digest(code) } })).toBe(1);
    await prisma.mobileLoginGrant.update({ where: { codeHash: digest(code) }, data: { expiresAt: new Date(0) } });
    await expect(exchangeGrant({ code, verifier })).rejects.toMatchObject({ status: 401 });
    const blockedCode = await issueLoginGrant(identity.id, pkceChallenge(verifier));
    await prisma.user.update({ where: { id: identity.id }, data: { accessStatus: "SUSPENDED" } });
    await expect(exchangeGrant({ code: blockedCode, verifier })).rejects.toMatchObject({ status: 401 });
  });
  it("immediately enforces suspension, expiry and logout", async () => {
    const identity = await user();
    const code = await issueLoginGrant(identity.id, pkceChallenge(verifier));
    const session = await exchangeGrant({ code, verifier });
    await expect(requireMobileUser(bearer(session.token))).resolves.toMatchObject({ id: identity.id });
    await prisma.user.update({ where: { id: identity.id }, data: { accessStatus: "SUSPENDED" } });
    await expect(requireMobileUser(bearer(session.token))).rejects.toMatchObject({ status: 401 });
    await prisma.user.update({ where: { id: identity.id }, data: { accessStatus: "ACTIVE" } });
    await prisma.mobileSession.update({ where: { tokenHash: digest(session.token) }, data: { expiresAt: new Date(0) } });
    await expect(requireMobileUser(bearer(session.token))).rejects.toMatchObject({ status: 401 });
    await revokeMobileSession(bearer(session.token));
    await revokeMobileSession(bearer(session.token));
    expect(await prisma.mobileSession.count({ where: { tokenHash: digest(session.token) } })).toBe(0);
  });
  it("shares real workspace creation with web and applies membership removal on the next read", async () => {
    const owner = await user(), viewer = await user();
    const workspace = await createWorkspaceForUser(owner.id, { name: "測試婚宴", weddingDate: null, timezone: "Asia/Taipei" });
    expect(await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } } })).toMatchObject({ role: "OWNER" });
    expect(await prisma.budgetItem.count({ where: { workspaceId: workspace.id } })).toBeGreaterThan(0);
    expect(await listWorkspaceOverviewsForUser(viewer.id)).toEqual([]);
    await prisma.membership.create({ data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" } });
    expect(await listWorkspaceOverviewsForUser(viewer.id)).toEqual([expect.objectContaining({ role: "VIEWER", workspace: expect.objectContaining({ id: workspace.id }) })]);
    await prisma.membership.delete({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: viewer.id } } });
    expect(await listWorkspaceOverviewsForUser(viewer.id)).toEqual([]);
  });
});
