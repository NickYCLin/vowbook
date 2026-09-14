"use server";
import {revalidatePath} from "next/cache";
import {CakeValidationError, cakeMemberSnapshot, normalizeCakeHousehold} from "@/domain/wedding-cake";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
import {requireCurrentUser} from "@/lib/current-user";
import {requireWorkspaceAccess} from "@/lib/workspace-access";
import {requireLockedWorkspaceAccess} from "@/lib/workspace-mutation-access";
import {runSerializableTransaction,SerializationConflictError} from "@/lib/serializable-transaction";
export type CakeMutationState={status:"idle"|"success"|"error";message?:string;code?:"FORBIDDEN"|"VALIDATION"|"STALE"|"UNAVAILABLE"};
class StaleCakeError extends Error {}
async function mutate(workspaceId:string,id:string|null,data:FormData,remove:boolean):Promise<CakeMutationState>{
 const user=await requireCurrentUser();
 try{
  await requireWorkspaceAccess(workspaceId,user.id,"edit");
  const input=remove?null:normalizeCakeHousehold(data);
  const version=data.get("expectedVersion");
  if(id && (typeof version!=="string" || !/^\d{1,9}$/u.test(version))) throw new CakeValidationError("請重新整理家庭資料。");
  let expected:Record<string,number>;
  try{expected=JSON.parse(String(data.get("expectedGuests")));if(!expected||typeof expected!=="object"||Array.isArray(expected))throw Error();}catch{throw new CakeValidationError("請重新整理名單後再試。");}
  await runSerializableTransaction(async tx=>{
   await requireLockedWorkspaceAccess(workspaceId,user.id,"edit",tx);
   const selected=input?.guestIds??[];
   const guests=await tx.guest.findMany({where:{workspaceId,OR:[{id:{in:selected}},...(id?[{cakeHouseholdId:id}]:[])]},select:{id:true,version:true,category:true,cakeHouseholdId:true}});
   if(guests.some(g=>selected.includes(g.id)&&g.category==="COUPLE"))throw new CakeValidationError("新人本人不列入發餅家庭，請選擇其他名單成員。");
   const members=guests.filter(g=>id!==null&&g.cakeHouseholdId===id);
   if(id && cakeMemberSnapshot(members)!==data.get("expectedMembers"))throw new StaleCakeError();
   if(selected.some(guestId=>{const g=guests.find(g=>g.id===guestId);return !g||g.version!==expected[guestId]||(g.cakeHouseholdId!==null&&g.cakeHouseholdId!==id);}))throw new StaleCakeError();
   let householdId=id;
   if(id){const result=await tx.weddingCakeHousehold.updateMany({where:{id,workspaceId,version:Number(version)},data:{...(input?{name:input.name,boxes:input.boxes}:{}),version:{increment:1}}});if(result.count!==1)throw new StaleCakeError();}
   else if(input){householdId=(await tx.weddingCakeHousehold.create({data:{workspaceId,name:input.name,boxes:input.boxes},select:{id:true}})).id;}
   else throw new CakeValidationError("請選擇家庭。");
   for(const g of guests){
    const target=selected.includes(g.id)?householdId:null;
    if(g.cakeHouseholdId===target)continue;
    const result=await tx.guest.updateMany({where:{id:g.id,workspaceId,version:g.version,cakeHouseholdId:g.cakeHouseholdId},data:{cakeHouseholdId:target,version:{increment:1}}});
    if(result.count!==1)throw new StaleCakeError();
   }
   if(remove && id){const result=await tx.weddingCakeHousehold.deleteMany({where:{id,workspaceId,version:Number(version)+1}});if(result.count!==1)throw new StaleCakeError();}
  });
 }catch(error){
  if(error instanceof WorkspaceAccessDeniedError)return {status:"error",code:"FORBIDDEN",message:error.message};
  if(error instanceof CakeValidationError)return {status:"error",code:"VALIDATION",message:error.message};
  if(error instanceof StaleCakeError||error instanceof SerializationConflictError || (typeof error==="object"&&error!==null&&"code" in error&&error.code==="P2003"))return {status:"error",code:"STALE",message:"名單或家庭已被修改，請重新整理後再試；尚未覆寫你的設定。"};
  return {status:"error",code:"UNAVAILABLE",message:"目前無法儲存發餅設定，請稍後再試。"};
 }
 try{revalidatePath(`/workspaces/${workspaceId}/guests`);revalidatePath(`/workspaces/${workspaceId}/guests/cakes`);}catch{return {status:"success",message:"已儲存，請重新整理以取得最新名單。"};}
 return {status:"success",message:remove?"已解散家庭，成員恢復每筆名單一盒。":"已儲存家庭發餅設定。"};
}
export async function saveCakeHouseholdAction(workspaceId:string,id:string|null,_state:CakeMutationState,data:FormData){return mutate(workspaceId,id,data,false);}
export async function dissolveCakeHouseholdAction(workspaceId:string,id:string,_state:CakeMutationState,data:FormData){return mutate(workspaceId,id,data,true);}
