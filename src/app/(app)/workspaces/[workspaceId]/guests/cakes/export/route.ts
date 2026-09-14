import {getWeddingCakes} from "@/lib/wedding-cakes";
import {cakeCsv,cakeRows} from "@/domain/wedding-cake";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await params;
 try{
  const data=await getWeddingCakes(workspaceId);
  return new Response(cakeCsv(cakeRows(data.guests,data.households)),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=\"wedding-cakes.csv\"; filename*=UTF-8''%E7%99%BC%E9%A4%85%E5%90%8D%E5%96%AE.csv","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch(error){if(error instanceof WorkspaceAccessDeniedError)return new Response("找不到此名單",{status:404,headers:{"Cache-Control":"private, no-store"}});throw error;}
}
