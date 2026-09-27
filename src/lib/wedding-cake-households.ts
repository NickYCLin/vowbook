import "server-only";
import {CakeValidationError, cakeMemberSnapshot} from "@/domain/wedding-cake";
import {requireLockedWorkspaceAccess} from "@/lib/workspace-mutation-access";
import {runSerializableTransaction} from "@/lib/serializable-transaction";

export class StaleCakeError extends Error {}

export type CakeHouseholdWrite = {
  workspaceId: string;
  userId: string;
  /** null 代表新增家庭。 */
  householdId: string | null;
  /** null 代表解散家庭。 */
  input: {name: string; boxes: number; guestIds: string[]} | null;
  expectedVersion: number | null;
  /** 勾選成員各自讀到的版本，避免覆寫別人剛改的名單。 */
  expectedGuests: Record<string, number>;
  /** 開啟家庭時的成員快照，見 cakeMemberSnapshot。 */
  expectedMembers: string | null;
};

/** 網站和 App 共用：寫入前在交易內重新確認 Membership 與每筆版本。 */
export async function writeCakeHousehold(w: CakeHouseholdWrite) {
  const {workspaceId, householdId: id, input, expectedGuests: expected} = w;
  if (id && w.expectedVersion === null) throw new CakeValidationError("請重新整理家庭資料。");
  const remove = input === null;
  return runSerializableTransaction(async tx => {
    await requireLockedWorkspaceAccess(workspaceId, w.userId, "edit", tx);
    const selected = input?.guestIds ?? [];
    const guests = await tx.guest.findMany({where: {workspaceId, OR: [{id: {in: selected}}, ...(id ? [{cakeHouseholdId: id}] : [])]}, select: {id: true, version: true, category: true, cakeHouseholdId: true}});
    if (guests.some(g => selected.includes(g.id) && g.category === "COUPLE")) throw new CakeValidationError("新人本人不列入發餅家庭，請選擇其他名單成員。");
    const members = guests.filter(g => id !== null && g.cakeHouseholdId === id);
    if (id && cakeMemberSnapshot(members) !== w.expectedMembers) throw new StaleCakeError();
    if (selected.some(guestId => {const g = guests.find(g => g.id === guestId); return !g || g.version !== expected[guestId] || (g.cakeHouseholdId !== null && g.cakeHouseholdId !== id);})) throw new StaleCakeError();
    let householdId = id;
    if (id) {
      const result = await tx.weddingCakeHousehold.updateMany({where: {id, workspaceId, version: w.expectedVersion!}, data: {...(input ? {name: input.name, boxes: input.boxes} : {}), version: {increment: 1}}});
      if (result.count !== 1) throw new StaleCakeError();
    } else if (input) {
      householdId = (await tx.weddingCakeHousehold.create({data: {workspaceId, name: input.name, boxes: input.boxes}, select: {id: true}})).id;
    } else throw new CakeValidationError("請選擇家庭。");
    for (const g of guests) {
      const target = selected.includes(g.id) ? householdId : null;
      if (g.cakeHouseholdId === target) continue;
      const result = await tx.guest.updateMany({where: {id: g.id, workspaceId, version: g.version, cakeHouseholdId: g.cakeHouseholdId}, data: {cakeHouseholdId: target, version: {increment: 1}}});
      if (result.count !== 1) throw new StaleCakeError();
    }
    if (remove && id) {
      const result = await tx.weddingCakeHousehold.deleteMany({where: {id, workspaceId, version: w.expectedVersion! + 1}});
      if (result.count !== 1) throw new StaleCakeError();
    }
    return {householdId};
  });
}
