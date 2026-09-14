import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/current-user";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { effectiveGuestDetailValue } from "@/domain/guest-detail-value";
import { compareGuestsBySeniorityThenSurnameStroke } from "@/domain/guest";
export async function getWeddingCakes(workspaceId: string) {
  const user = await requireCurrentUser();
  return prisma.$transaction(async tx => {
    // 稱謂沿用賓客明細的 editor 邊界；工作人員取得的是新人匯出的檔案。
    const access = await requireWorkspaceAccess<{id:string; name:string}>(workspaceId, user.id, "edit", tx);
    return {workspace:access.workspace, ...await readHouseholdRoster(tx,workspaceId)};
  }, {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
export type WeddingCakeData = Awaited<ReturnType<typeof getWeddingCakes>>;

async function readHouseholdRoster(tx:Prisma.TransactionClient,workspaceId:string) {
    const [guests, households] = await Promise.all([
      tx.guest.findMany({ where:{workspaceId}, select:{id:true, name:true, category:true, giftExemptWithCake:true, version:true, side:true, seniority:true, attendanceStatus:true, partySize:true, cakeHouseholdId:true, checkIn:{select:{id:true}}, importRecords:{orderBy:[{source:"asc"},{sourceInstance:"asc"}],select:{source:true,sourceInstance:true,sourceManaged:true,relationshipLabel:true}}} }),
      tx.weddingCakeHousehold.findMany({where:{workspaceId},orderBy:[{createdAt:"asc"},{id:"asc"}],select:{id:true,name:true,boxes:true,version:true}}),
    ]);
    return { households, guests:guests.map(({checkIn,importRecords,...g}) => ({...g,checkedIn:Boolean(checkIn),relationshipLabel:effectiveGuestDetailValue(importRecords, r => r.relationshipLabel)})).sort(compareGuestsBySeniorityThenSurnameStroke) };
}

/** 紙本禮金簿僅查詢是否有紀錄，不讀取禮金金額。 */
export async function getWeddingGiftPrint(workspaceId:string) {
 const user=await requireCurrentUser();
 return prisma.$transaction(async tx=>{
  const access=await requireWorkspaceAccess<{id:string;name:string}>(workspaceId,user.id,"edit",tx);
  const [roster,gifts]=await Promise.all([
   readHouseholdRoster(tx,workspaceId),
   tx.weddingGift.findMany({where:{workspaceId},select:{guestId:true}}),
  ]);
  const received=new Set(gifts.map(gift=>gift.guestId));
  return {workspace:access.workspace,...roster,guests:roster.guests.map(guest=>({...guest,giftReceived:received.has(guest.id)}))};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
