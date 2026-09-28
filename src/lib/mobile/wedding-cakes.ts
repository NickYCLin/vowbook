import "server-only";

import {
  cakeRelationshipLabel,
  cakeRowGroups,
  cakeRows,
  CakeValidationError,
  cakeMemberSnapshot,
} from "@/domain/wedding-cake";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { MobileRequestError } from "@/lib/mobile/protocol";
import { SerializationConflictError } from "@/lib/serializable-transaction";
import { readWeddingCakesForUser } from "@/lib/wedding-cakes";
import { StaleCakeError, writeCakeHousehold } from "@/lib/wedding-cake-households";

export const MAX_APP_HOUSEHOLD = 40;

/** 發餅名單只給能編輯的人看，和網站一樣；稱謂屬於賓客明細。 */
export async function mobileWeddingCakes(workspaceId: string, userId: string) {
  let data;
  try {
    data = await readWeddingCakesForUser(workspaceId, userId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw new MobileRequestError(403, "FORBIDDEN", "發餅名單只有能編輯的協作者可以看。");
    }
    throw error;
  }
  const rows = cakeRows(data.guests, data.households);
  return {
    households: data.households.map((household) => {
      const members = data.guests.filter((guest) => guest.category !== "COUPLE" && guest.cakeHouseholdId === household.id);
      return {
        id: household.id,
        name: household.name,
        boxes: household.boxes,
        version: household.version,
        memberIds: members.map((guest) => guest.id),
        membersSnapshot: cakeMemberSnapshot(members),
      };
    }),
    guests: data.guests
      .filter((guest) => guest.category !== "COUPLE")
      .map((guest) => ({
        id: guest.id,
        name: guest.name,
        version: guest.version,
        relationship: cakeRelationshipLabel(guest),
        partySize: guest.partySize,
        attendanceStatus: guest.attendanceStatus,
        checkedIn: guest.checkedIn,
        householdId: guest.cakeHouseholdId,
      })),
    groups: cakeRowGroups(rows).map((group) => ({
      id: group.id,
      label: group.label,
      rows: group.rows.map((row) => ({ key: row.key, names: row.names, relationships: row.relationships, boxes: row.boxes })),
    })),
    totalBoxes: rows.reduce((sum, row) => sum + row.boxes, 0),
  };
}

function badRequest(message = "輸入格式有誤。"): never {
  throw new MobileRequestError(400, "INVALID_REQUEST", message);
}

function parseInput(body: Record<string, unknown>) {
  const { name, boxes, guests } = body;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
    throw new MobileRequestError(400, "VALIDATION", "請填寫 100 字以內的家庭名稱。");
  }
  if (typeof boxes !== "number" || !Number.isInteger(boxes) || boxes < 0 || boxes > 999) {
    throw new MobileRequestError(400, "VALIDATION", "喜餅盒數請填 0 到 999 的整數。");
  }
  if (!Array.isArray(guests) || !guests.length) {
    throw new MobileRequestError(400, "VALIDATION", "請選擇同一家人的名單成員。");
  }
  // App 的 JSON 上限 4 KB；一家人不會超過這個數，超過請到網站設定。
  if (guests.length > MAX_APP_HOUSEHOLD) {
    throw new MobileRequestError(400, "VALIDATION", `App 一次最多設定 ${MAX_APP_HOUSEHOLD} 位，更多請到網站設定。`);
  }
  const expectedGuests: Record<string, number> = {};
  for (const item of guests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) badRequest();
    const { id, version } = item as { id?: unknown; version?: unknown };
    if (typeof id !== "string" || !id || id.length > 100 || id in expectedGuests) badRequest();
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) badRequest();
    expectedGuests[id] = version;
  }
  return { input: { name: name.trim(), boxes, guestIds: Object.keys(expectedGuests) }, expectedGuests };
}

function versionOf(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) badRequest("版本資訊無效，請重新整理後再試。");
  return value;
}

function snapshotOf(value: unknown) {
  if (typeof value !== "string" || value.length > 20_000) badRequest("請重新整理家庭資料。");
  return value;
}

async function write(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof CakeValidationError) throw new MobileRequestError(400, "VALIDATION", error.message);
    if (error instanceof WorkspaceAccessDeniedError) throw new MobileRequestError(403, "FORBIDDEN", "沒有這場婚宴的編輯權限。");
    if (error instanceof StaleCakeError || error instanceof SerializationConflictError ||
        (typeof error === "object" && error !== null && "code" in error && error.code === "P2003")) {
      throw new MobileRequestError(409, "STALE", "名單或家庭剛被改過，請重新整理後再試。");
    }
    throw error;
  }
}

export async function mobileCreateCakeHousehold(workspaceId: string, userId: string, body: Record<string, unknown>) {
  const { input, expectedGuests } = parseInput(body);
  await write(() => writeCakeHousehold({
    workspaceId, userId, householdId: null, input, expectedVersion: null, expectedGuests, expectedMembers: null,
  }));
  return mobileWeddingCakes(workspaceId, userId);
}

export async function mobileUpdateCakeHousehold(
  workspaceId: string, userId: string, householdId: string, body: Record<string, unknown>,
) {
  const { input, expectedGuests } = parseInput(body);
  const expectedVersion = versionOf(body.expectedVersion);
  const expectedMembers = snapshotOf(body.expectedMembers);
  await write(() => writeCakeHousehold({
    workspaceId, userId, householdId, input, expectedVersion, expectedGuests, expectedMembers,
  }));
  return mobileWeddingCakes(workspaceId, userId);
}

export async function mobileDissolveCakeHousehold(
  workspaceId: string, userId: string, householdId: string, body: Record<string, unknown>,
) {
  const expectedVersion = versionOf(body.expectedVersion);
  const expectedMembers = snapshotOf(body.expectedMembers);
  await write(() => writeCakeHousehold({
    workspaceId, userId, householdId, input: null, expectedVersion, expectedGuests: {}, expectedMembers,
  }));
  return mobileWeddingCakes(workspaceId, userId);
}
