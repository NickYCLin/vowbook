import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { invitationObject, normalizeInvitationQuestions, normalizeInvitationReply, parseCheckInCode, type InvitationReply, type InvitationQuestion } from "@/domain/guest-invitations";
import { resolveSeatingFloorPlanPositions, SeatingFloorPlanLayoutConflictError } from "@/domain/seating-floor-plan";
import { seatingTableNumbers } from "@/domain/seating-table";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { requireLockedWorkspaceAccess } from "@/lib/workspace-mutation-access";
import { runSerializableTransaction, SerializationConflictError } from "@/lib/serializable-transaction";
import { MobileRequestError, digest } from "@/lib/mobile/protocol";
import { mobileCheckInBoard } from "@/lib/mobile/check-in";

const unavailable = () => new MobileRequestError(404, "INVITATION_UNAVAILABLE", "邀請連結無效、已到期或已撤銷，請聯絡主辦方。");
const stale = () => new MobileRequestError(409, "STALE", "資料剛剛有更新，請重新載入後再確認。");
const invalid = () => new MobileRequestError(400, "VALIDATION", "邀請資料格式有誤。");
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
function validToken(raw: unknown): string { if (typeof raw !== "string" || !tokenPattern.test(raw)) throw unavailable(); return raw; }
function version(raw: unknown): number { if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > 2_147_483_646) throw invalid(); return raw; }
function boundedText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string" || Array.from(raw.trim()).length > max) throw invalid();
  return raw.trim() || null;
}
export function guestCheckInToken(invitationToken: string): string {
  return createHash("sha256").update(`VowBook Check-in v1:${invitationToken}`).digest("base64url");
}
async function transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  try { return await runSerializableTransaction(operation, prisma); }
  catch (error) {
    if (error instanceof SerializationConflictError || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw stale();
    throw error;
  }
}
const settingsSelect = { version: true, questions: true, venueName: true, venueAddress: true, mapMime: true } as const;
const defaultSettings = { version: 0, questions: [] as InvitationQuestion[], venueName: null, venueAddress: null, hasVenueMap: false };
function settingsDTO(settings: { version: number; questions: Prisma.JsonValue; venueName: string | null; venueAddress: string | null; mapMime: string | null } | null) {
  return settings ? { version: settings.version, questions: normalizeInvitationQuestions(settings.questions), venueName: settings.venueName,
    venueAddress: settings.venueAddress, hasVenueMap: settings.mapMime !== null } : defaultSettings;
}
export async function loadGuestInvitationManagement(workspaceId: string, userId: string) {
  return transaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    const [settings, guests, workspace] = await Promise.all([
      tx.guestInvitationSettings.findUnique({ where: { workspaceId }, select: settingsSelect }),
      tx.guest.findMany({ where: { workspaceId, category: { not: "COUPLE" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, partySize: true, invitation: { select: { version: true, expiresAt: true, revokedAt: true, response: true, responseVersion: true, submittedAt: true } } } }),
      tx.weddingWorkspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } }),
    ]);
    const now = Date.now();
    const rows = guests.map((guest) => ({ id: guest.id, name: guest.name, partySize: guest.partySize,
      invitation: guest.invitation ? { ...guest.invitation, expiresAt: guest.invitation.expiresAt.toISOString(),
        submittedAt: guest.invitation.submittedAt?.toISOString() ?? null, revokedAt: guest.invitation.revokedAt?.toISOString() ?? null,
        active: guest.invitation.revokedAt === null && guest.invitation.expiresAt.getTime() > now } : null }));
    const replies = rows.flatMap((row) => row.invitation?.response ? [row.invitation.response as unknown as { reply: InvitationReply }] : []);
    return { workspace, settings: settingsDTO(settings), guests: rows, summary: {
      guestGroups: rows.length, issuedGroups: rows.filter((row) => row.invitation !== null).length,
      repliedGroups: replies.length, pendingGroups: rows.filter((row) => row.invitation && !row.invitation.response).length,
      attendingGroups: replies.filter((response) => response.reply.attendance === "ATTENDING").length,
      declinedGroups: replies.filter((response) => response.reply.attendance === "DECLINED").length,
      headcount: replies.reduce((total, response) => total + response.reply.partySize, 0),
      vegetarianCount: replies.reduce((total, response) => total + response.reply.vegetarianCount, 0),
    } };
  });
}
export async function saveGuestInvitationSettings(workspaceId: string, userId: string, body: unknown) {
  const input = invitationObject(body, ["expectedVersion", "questions", "venueName", "venueAddress"]);
  const expectedVersion = version(input.expectedVersion);
  const questions = normalizeInvitationQuestions(input.questions);
  const venueName = boundedText(input.venueName, 100), venueAddress = boundedText(input.venueAddress, 200);
  return transaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    await tx.guestInvitationSettings.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} });
    const result = await tx.guestInvitationSettings.updateMany({ where: { workspaceId, version: expectedVersion },
      data: { questions, venueName, venueAddress, version: { increment: 1 } } });
    if (result.count !== 1) throw stale();
    return { version: expectedVersion + 1 };
  });
}
export async function issueGuestInvitation(workspaceId: string, userId: string, body: unknown) {
  const input = invitationObject(body, ["guestId", "expectedVersion", "validDays"]);
  if (typeof input.guestId !== "string" || input.guestId.length > 100 || typeof input.validDays !== "number" || !Number.isInteger(input.validDays) || input.validDays < 1 || input.validDays > 180) throw invalid();
  const expectedVersion = input.expectedVersion === null ? null : version(input.expectedVersion);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + input.validDays * 86_400_000);
  const guestId = input.guestId;
  return transaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    const guest = await tx.guest.findFirst({ where: { id: guestId, workspaceId, category: { not: "COUPLE" } }, select: { id: true } });
    if (!guest) throw stale();
    const current = await tx.guestInvitation.findUnique({ where: { guestId_workspaceId: { guestId, workspaceId } }, select: { version: true } });
    if ((current?.version ?? null) !== expectedVersion) throw stale();
    const data = { tokenHash: digest(token), checkInTokenHash: digest(guestCheckInToken(token)), expiresAt, revokedAt: null };
    if (current) {
      const result = await tx.guestInvitation.updateMany({ where: { guestId, workspaceId, version: current.version }, data: { ...data, version: { increment: 1 } } });
      if (result.count !== 1) throw stale();
    } else await tx.guestInvitation.create({ data: { workspaceId, guestId, ...data } });
    return { token, expiresAt: expiresAt.toISOString(), version: current ? current.version + 1 : 0 };
  });
}
export async function revokeGuestInvitation(workspaceId: string, userId: string, body: unknown) {
  const input = invitationObject(body, ["guestId", "expectedVersion"]);
  const expectedVersion = version(input.expectedVersion);
  if (typeof input.guestId !== "string" || input.guestId.length > 100) throw invalid();
  const guestId = input.guestId;
  return transaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    const result = await tx.guestInvitation.updateMany({ where: { workspaceId, guestId, version: expectedVersion }, data: { revokedAt: new Date(), version: { increment: 1 } } });
    if (result.count !== 1) throw stale();
    return { revoked: true };
  });
}
async function activeInvitation(tx: Prisma.TransactionClient, rawToken: unknown) {
  const token = validToken(rawToken);
  const invitation = await tx.guestInvitation.findUnique({ where: { tokenHash: digest(token) }, select: {
    id: true, workspaceId: true, guestId: true, version: true, responseVersion: true, response: true, expiresAt: true, revokedAt: true,
    guest: { select: { name: true, partySize: true, seatingTableId: true } },
    workspace: { select: { name: true, weddingDate: true, guestInvitationSettings: { select: settingsSelect },
      seatingTables: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, position: true, layoutX: true, layoutY: true } } } },
  } });
  if (!invitation || invitation.revokedAt || invitation.expiresAt.getTime() <= Date.now()) throw unavailable();
  return invitation;
}
export async function readGuestInvitation(rawToken: unknown) {
  return transaction(async (tx) => {
    const invitation = await activeInvitation(tx, rawToken);
    const tables = invitation.workspace.seatingTables;
    const numbers = seatingTableNumbers(tables.length);
    const ownIndex = tables.findIndex((table) => table.id === invitation.guest.seatingTableId);
    let floorPlan: { number: number; x: number; y: number; own: boolean; automatic: boolean }[] = [];
    let floorPlanUnavailable = false;
    try {
      const positions = new Map(resolveSeatingFloorPlanPositions(tables).map((point) => [point.tableId, point]));
      floorPlan = tables.map((table, index) => ({ number: numbers[index], x: positions.get(table.id)!.x, y: positions.get(table.id)!.y,
        own: index === ownIndex, automatic: positions.get(table.id)!.source === "automatic" }));
    } catch (error) { if (!(error instanceof SeatingFloorPlanLayoutConflictError)) throw error; floorPlanUnavailable = true; }
    return {
      wedding: { name: invitation.workspace.name, date: invitation.workspace.weddingDate?.toISOString() ?? null },
      guest: { name: invitation.guest.name, maxPartySize: invitation.guest.partySize },
      settings: settingsDTO(invitation.workspace.guestInvitationSettings),
      table: ownIndex < 0 ? null : { number: numbers[ownIndex], name: tables[ownIndex].name },
      floorPlan, floorPlanUnavailable, response: invitation.response, responseVersion: invitation.responseVersion,
      expiresAt: invitation.expiresAt.toISOString(), checkInCode: `vowbook:check-in:v1:${guestCheckInToken(validToken(rawToken))}`,
    };
  });
}
export async function submitGuestInvitationReply(rawToken: unknown, body: unknown) {
  const input = invitationObject(body, ["formVersion", "responseVersion", "reply"]);
  const formVersion = version(input.formVersion), responseVersion = version(input.responseVersion);
  return transaction(async (tx) => {
    const invitation = await activeInvitation(tx, rawToken);
    const settings = settingsDTO(invitation.workspace.guestInvitationSettings);
    if (settings.version !== formVersion || invitation.responseVersion !== responseVersion) throw stale();
    const reply = normalizeInvitationReply(input.reply, settings.questions, invitation.guest.partySize);
    const submittedAt = new Date();
    const result = await tx.guestInvitation.updateMany({ where: { id: invitation.id, version: invitation.version, responseVersion, revokedAt: null, expiresAt: { gt: submittedAt } },
      data: { response: { reply, questions: settings.questions, formVersion }, responseVersion: { increment: 1 }, submittedAt } });
    if (result.count !== 1) throw stale();
    return { saved: true, responseVersion: responseVersion + 1 };
  });
}
export async function resolveGuestCheckInCode(workspaceId: string, userId: string, body: unknown) {
  const input = invitationObject(body, ["code"]);
  await requireWorkspaceAccess(workspaceId, userId, "edit");
  const token = parseCheckInCode(input.code);
  const invitation = await prisma.guestInvitation.findFirst({ where: { workspaceId, checkInTokenHash: digest(token), revokedAt: null, expiresAt: { gt: new Date() } }, select: { guestId: true } });
  if (!invitation) throw unavailable();
  const board = await mobileCheckInBoard(workspaceId, userId);
  const guest = board.guests.find((item) => item.id === invitation.guestId);
  if (!guest) throw unavailable();
  if (guest.blockedReason) throw new MobileRequestError(409, "NOT_ATTENDING", guest.blockedReason);
  return { guest };
}
export async function readGuestVenueMap(rawToken: unknown) {
  return transaction(async (tx) => {
    const invitation = await activeInvitation(tx, rawToken);
    const settings = await tx.guestInvitationSettings.findUnique({ where: { workspaceId: invitation.workspaceId }, select: { mapBytes: true, mapMime: true } });
    if (!settings?.mapBytes || settings.mapMime !== "image/png") throw new MobileRequestError(404, "MAP_UNAVAILABLE", "主辦方尚未提供會館圖。");
    return settings.mapBytes;
  });
}
export async function saveGuestVenueMap(workspaceId: string, userId: string, expectedVersion: number, image: Uint8Array | null) {
  version(expectedVersion);
  // 影像解碼前就驗證權限，重編碼後在交易內再確認，避免撤銷成員期間仍寫入。
  await requireWorkspaceAccess(workspaceId, userId, "edit");
  let bytes: Buffer | null = null;
  if (image !== null) {
    if (image.byteLength === 0 || image.byteLength > 3 * 1024 * 1024) throw invalid();
    const header = Buffer.from(image.subarray(0, 12));
    if (!(header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (header[0] === 255 && header[1] === 216 && header[2] === 255) ||
      (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP"))) throw invalid();
    const sharp = (await import("sharp")).default;
    try {
      const source = sharp(image, { limitInputPixels: 12_000_000, animated: false });
      const metadata = await source.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw invalid();
      bytes = await source.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      if (bytes.byteLength > 3 * 1024 * 1024) throw invalid();
    } catch { throw new MobileRequestError(400, "VALIDATION", "請使用 3 MiB 以內的有效 PNG、JPEG 或 WebP 圖片。"); }
  }
  return transaction(async (tx) => {
    await requireLockedWorkspaceAccess(workspaceId, userId, "edit", tx);
    await tx.guestInvitationSettings.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} });
    const result = await tx.guestInvitationSettings.updateMany({ where: { workspaceId, version: expectedVersion }, data: {
      mapBytes: bytes === null ? null : new Uint8Array(bytes), mapMime: bytes === null ? null : "image/png", version: { increment: 1 } } });
    if (result.count !== 1) throw stale();
    return { version: expectedVersion + 1 };
  });
}
