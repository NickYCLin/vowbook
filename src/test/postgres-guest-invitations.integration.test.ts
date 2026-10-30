import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { digest } from "@/lib/mobile/protocol";
import { guestCheckInToken, issueGuestInvitation, loadGuestInvitationManagement, readGuestInvitation, readGuestVenueMap, resolveGuestCheckInCode, revokeGuestInvitation, saveGuestInvitationSettings, saveGuestVenueMap, submitGuestInvitationReply } from "@/lib/guest-invitations";
import { mobileCheckInGuest } from "@/lib/mobile/check-in";
const suite = process.env.VOWBOOK_DB_INTEGRATION === "1" ? describe : describe.skip;
const prefix = `guest-invitation-it-${process.pid}-`;
let sequence = 0;
const reply = { attendance: "ATTENDING", partySize: 2, vegetarianCount: 1, phone: "0000000000", dietaryNotes: "合成需求", answers: {} };
async function fixture() {
  const user = await prisma.user.create({ data: { googleSubject: `${prefix}${sequence++}`, email: "fixture@example.test" } });
  const workspace = await prisma.weddingWorkspace.create({ data: { name: "合成邀請婚宴", createdById: user.id, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const guest = await prisma.guest.create({ data: { workspaceId: workspace.id, name: "合成受邀組", side: "SHARED", partySize: 2, attendanceStatus: "ATTENDING" } });
  const issue = await issueGuestInvitation(workspace.id, user.id, { guestId: guest.id, expectedVersion: null, validDays: 30 });
  return { user, workspace, guest, ...issue };
}
suite("受限邀請與掃碼使用隔離 PostgreSQL", () => {
  afterAll(async () => {
    await prisma.weddingWorkspace.deleteMany({ where: { createdBy: { googleSubject: { startsWith: prefix } } } });
    await prisma.user.deleteMany({ where: { googleSubject: { startsWith: prefix } } });
    await prisma.$disconnect();
  });
  it("只存能力碼雜湊，邀請與報到碼不能互換", async () => {
    const data = await fixture();
    const saved = await prisma.guestInvitation.findUniqueOrThrow({ where: { guestId_workspaceId: { guestId: data.guest.id, workspaceId: data.workspace.id } } });
    expect(saved.tokenHash).toBe(digest(data.token));
    expect(saved.checkInTokenHash).toBe(digest(guestCheckInToken(data.token)));
    expect(JSON.stringify(saved)).not.toContain(data.token);
    expect(JSON.stringify(saved)).not.toContain(guestCheckInToken(data.token));
    await expect(readGuestInvitation(guestCheckInToken(data.token))).rejects.toMatchObject({ status: 404 });
    await expect(resolveGuestCheckInCode(data.workspace.id, data.user.id, { code: `vowbook:check-in:v1:${data.token}` })).rejects.toMatchObject({ status: 404 });
  });
  it("訪客只能看到自己與無名單的桌位圖，不能取得其他賓客、禮金與備註", async () => {
    const data = await fixture();
    await prisma.guest.create({ data: { workspaceId: data.workspace.id, name: "不應出現在邀請的其他合成賓客", notes: "不應公開的備註", side: "SHARED" } });
    const table = await prisma.seatingTable.create({ data: { workspaceId: data.workspace.id, position: 1, name: "本人合成桌", capacity: 10 } });
    await prisma.guest.update({ where: { id: data.guest.id }, data: { seatingTableId: table.id } });
    const view = await readGuestInvitation(data.token);
    expect(view.guest).toEqual({ name: "合成受邀組", maxPartySize: 2 });
    expect(view.table).toEqual({ number: 1, name: "本人合成桌" });
    expect(view.floorPlan).toHaveLength(1);
    expect(view.floorPlan[0]).toMatchObject({ number: 1, own: true, automatic: true });
    for (const secret of ["不應出現在邀請的其他合成賓客", "不應公開的備註", "tokenHash", "checkInTokenHash", "guestId", "workspaceId", "weddingGift"]) expect(JSON.stringify(view)).not.toContain(secret);
  });
  it("保存回覆並統計，但不覆寫既有名單、席位、來源或報到", async () => {
    const data = await fixture();
    const before = await prisma.guest.findUniqueOrThrow({ where: { id: data.guest.id } });
    await submitGuestInvitationReply(data.token, { formVersion: 0, responseVersion: 0, reply });
    expect(await prisma.guest.findUniqueOrThrow({ where: { id: data.guest.id } })).toEqual(before);
    const board = await loadGuestInvitationManagement(data.workspace.id, data.user.id);
    expect(board.summary).toMatchObject({ repliedGroups: 1, pendingGroups: 0, attendingGroups: 1, headcount: 2, vegetarianCount: 1 });
    expect((await readGuestInvitation(data.token)).response).toMatchObject({ reply });
    expect(await prisma.guestCheckIn.count({ where: { guestId: data.guest.id } })).toBe(0);
  });
  it("回覆與表單版本防止覆蓋其他分頁或舊題目，保留題目快照", async () => {
    const data = await fixture();
    const questions = [{ id: "transport", label: "合成接駁題", type: "CHOICE", required: true, options: ["需要", "不需要"] }];
    await saveGuestInvitationSettings(data.workspace.id, data.user.id, { expectedVersion: 0, venueName: "合成會館", venueAddress: "", questions });
    await expect(submitGuestInvitationReply(data.token, { formVersion: 0, responseVersion: 0, reply })).rejects.toMatchObject({ status: 409 });
    await submitGuestInvitationReply(data.token, { formVersion: 1, responseVersion: 0, reply: { ...reply, answers: { transport: "需要" } } });
    await expect(submitGuestInvitationReply(data.token, { formVersion: 1, responseVersion: 0, reply: { ...reply, answers: { transport: "不需要" } } })).rejects.toMatchObject({ status: 409 });
    expect((await readGuestInvitation(data.token)).response).toMatchObject({ questions, reply: { answers: { transport: "需要" } } });
    await expect(saveGuestInvitationSettings(data.workspace.id, data.user.id, { expectedVersion: 0, venueName: "", venueAddress: "", questions: [] })).rejects.toMatchObject({ status: 409 });
  });
  it("重發讓舊邀請及 QR 立即失效，並保留先前回覆", async () => {
    const data = await fixture();
    await submitGuestInvitationReply(data.token, { formVersion: 0, responseVersion: 0, reply });
    const next = await issueGuestInvitation(data.workspace.id, data.user.id, { guestId: data.guest.id, expectedVersion: 0, validDays: 7 });
    await expect(readGuestInvitation(data.token)).rejects.toMatchObject({ status: 404 });
    await expect(resolveGuestCheckInCode(data.workspace.id, data.user.id, { code: `vowbook:check-in:v1:${guestCheckInToken(data.token)}` })).rejects.toMatchObject({ status: 404 });
    expect((await readGuestInvitation(next.token)).responseVersion).toBe(1);
    await revokeGuestInvitation(data.workspace.id, data.user.id, { guestId: data.guest.id, expectedVersion: 1 });
    await expect(readGuestInvitation(next.token)).rejects.toMatchObject({ status: 404 });
    await expect(submitGuestInvitationReply(next.token, { formVersion: 0, responseVersion: 1, reply })).rejects.toMatchObject({ status: 404 });
  });
  it("過期邀請與未知 Token 都拒絕存取", async () => {
    const data = await fixture();
    await prisma.guestInvitation.updateMany({ where: { guestId: data.guest.id }, data: { expiresAt: new Date(0) } });
    await expect(readGuestInvitation(data.token)).rejects.toMatchObject({ status: 404 });
    await expect(readGuestInvitation("x".repeat(43))).rejects.toMatchObject({ status: 404 });
    await expect(readGuestVenueMap(data.token)).rejects.toMatchObject({ status: 404 });
  });
  it("跨婚宴、唯讀與非成員不得管理邀請或解析報到碼", async () => {
    const data = await fixture(), other = await fixture();
    const code = `vowbook:check-in:v1:${guestCheckInToken(data.token)}`;
    await expect(resolveGuestCheckInCode(other.workspace.id, other.user.id, { code })).rejects.toMatchObject({ status: 404 });
    await expect(issueGuestInvitation(other.workspace.id, other.user.id, { guestId: data.guest.id, expectedVersion: 0, validDays: 7 })).rejects.toMatchObject({ status: 409 });
    await expect(loadGuestInvitationManagement(data.workspace.id, other.user.id)).rejects.toThrow();
    await prisma.membership.create({ data: { workspaceId: data.workspace.id, userId: other.user.id, role: "VIEWER" } });
    await expect(resolveGuestCheckInCode(data.workspace.id, other.user.id, { code })).rejects.toThrow();
    await expect(saveGuestInvitationSettings(data.workspace.id, other.user.id, { expectedVersion: 0, venueName: "", venueAddress: "", questions: [] })).rejects.toThrow();
    await expect(revokeGuestInvitation(data.workspace.id, other.user.id, { guestId: data.guest.id, expectedVersion: 0 })).rejects.toThrow();
  });
  it("掃碼只核對一組賓客，工作人員明確確認後才報到，重掃不取消報到", async () => {
    const data = await fixture(); const code = `vowbook:check-in:v1:${guestCheckInToken(data.token)}`;
    const preview = await resolveGuestCheckInCode(data.workspace.id, data.user.id, { code });
    expect(preview.guest.id).toBe(data.guest.id);
    expect(preview.guest.checkIn).toBeNull();
    expect(await prisma.guestCheckIn.count({ where: { guestId: data.guest.id } })).toBe(0);
    await mobileCheckInGuest(data.workspace.id, data.user.id, data.guest.id, { headcount: 2, notes: "" });
    expect((await resolveGuestCheckInCode(data.workspace.id, data.user.id, { code })).guest.checkIn?.headcount).toBe(2);
    expect(await prisma.guestCheckIn.count({ where: { guestId: data.guest.id } })).toBe(1);
    await prisma.guest.update({ where: { id: data.guest.id }, data: { attendanceStatus: "DECLINED" } });
    await expect(resolveGuestCheckInCode(data.workspace.id, data.user.id, { code })).rejects.toMatchObject({ status: 409 });
  });
  it("會館圖重編碼、限定本人邀請工作區且版本受保護", async () => {
    const data = await fixture(), other = await fixture();
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    await saveGuestVenueMap(data.workspace.id, data.user.id, 0, bytes);
    const map = await readGuestVenueMap(data.token);
    expect((await sharp(map).metadata()).format).toBe("png");
    await expect(readGuestVenueMap(other.token)).rejects.toMatchObject({ status: 404 });
    await expect(saveGuestVenueMap(data.workspace.id, data.user.id, 0, bytes)).rejects.toMatchObject({ status: 409 });
    await expect(saveGuestVenueMap(data.workspace.id, other.user.id, 1, bytes)).rejects.toThrow();
    await expect(saveGuestVenueMap(data.workspace.id, data.user.id, 1, Buffer.from("not an image"))).rejects.toMatchObject({ status: 400 });
    await saveGuestVenueMap(data.workspace.id, data.user.id, 1, null);
    await expect(readGuestVenueMap(data.token)).rejects.toMatchObject({ status: 404 });
  });
});
