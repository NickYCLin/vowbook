"use server";
import {revalidatePath} from "next/cache";
import {CakeValidationError, normalizeCakeHousehold} from "@/domain/wedding-cake";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
import {requireCurrentUser} from "@/lib/current-user";
import {requireWorkspaceAccess} from "@/lib/workspace-access";
import {SerializationConflictError} from "@/lib/serializable-transaction";
import {StaleCakeError,writeCakeCollected,writeCakeHousehold} from "@/lib/wedding-cake-households";
export type CakeMutationState={status:"idle"|"success"|"error";message?:string;code?:"FORBIDDEN"|"VALIDATION"|"STALE"|"UNAVAILABLE"};
async function mutate(workspaceId:string,id:string|null,data:FormData,remove:boolean):Promise<CakeMutationState>{
 const user=await requireCurrentUser();
 try{
  await requireWorkspaceAccess(workspaceId,user.id,"edit");
  const input=remove?null:normalizeCakeHousehold(data);
  const version=data.get("expectedVersion");
  if(id && (typeof version!=="string" || !/^\d{1,9}$/u.test(version))) throw new CakeValidationError("請重新整理家庭資料。");
  let expected:Record<string,number>;
  try{expected=JSON.parse(String(data.get("expectedGuests")));if(!expected||typeof expected!=="object"||Array.isArray(expected))throw Error();}catch{throw new CakeValidationError("請重新整理名單後再試。");}
  await writeCakeHousehold({workspaceId,userId:user.id,householdId:id,input,expectedVersion:id?Number(version):null,expectedGuests:expected,expectedMembers:id?String(data.get("expectedMembers")):null});
 }catch(error){
  if(error instanceof WorkspaceAccessDeniedError)return {status:"error",code:"FORBIDDEN",message:error.message};
  if(error instanceof CakeValidationError)return {status:"error",code:"VALIDATION",message:error.message};
  if(error instanceof StaleCakeError||error instanceof SerializationConflictError || (typeof error==="object"&&error!==null&&"code" in error&&error.code==="P2003"))return {status:"error",code:"STALE",message:"名單或家庭已被修改，請重新整理後再試；尚未覆寫你的設定。"};
  return {status:"error",code:"UNAVAILABLE",message:"目前無法儲存發餅設定，請稍後再試。"};
 }
 try{for(const view of ["guests", "guests/cakes", "gifts", "gifts/print"])revalidatePath(`/workspaces/${workspaceId}/${view}`);}catch{return {status:"success",message:"已儲存，請重新整理以取得最新名單。"};}
 return {status:"success",message:remove?"已解散家庭，成員恢復每筆名單一盒。":"已儲存家庭發餅設定。"};
}
export async function saveCakeHouseholdAction(workspaceId:string,id:string|null,_state:CakeMutationState,data:FormData){return mutate(workspaceId,id,data,false);}
export async function dissolveCakeHouseholdAction(workspaceId:string,id:string,_state:CakeMutationState,data:FormData){return mutate(workspaceId,id,data,true);}
export async function setCakeCollectedAction(workspaceId:string,guestIds:string[],collected:boolean):Promise<CakeMutationState>{
 const user=await requireCurrentUser();
 try{
  if(!Array.isArray(guestIds)||guestIds.some(id=>typeof id!=="string"))throw new CakeValidationError("請重新整理名單後再試。");
  await requireWorkspaceAccess(workspaceId,user.id,"edit");
  await writeCakeCollected({workspaceId,userId:user.id,guestIds,collected:collected===true});
 }catch(error){
  if(error instanceof WorkspaceAccessDeniedError)return {status:"error",code:"FORBIDDEN",message:error.message};
  if(error instanceof CakeValidationError)return {status:"error",code:"VALIDATION",message:error.message};
  if(error instanceof StaleCakeError||error instanceof SerializationConflictError)return {status:"error",code:"STALE",message:"名單已被修改，請重新整理後再試。"};
  return {status:"error",code:"UNAVAILABLE",message:"目前無法儲存領取狀態，請稍後再試。"};
 }
 try{revalidatePath(`/workspaces/${workspaceId}/guests/cakes`);}catch{}
 return {status:"success",message:collected?"已標記領取。":"已取消領取標記。"};
}
