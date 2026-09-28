import type {Metadata} from "next";
import {WorkspaceSectionTabs} from "@/components/workspaces/workspace-section-tabs";
import {notFound} from "next/navigation";
import {WorkspacePageHeader} from "@/components/workspaces/workspace-shell";
import {WeddingCakeBoard} from "@/components/guests/wedding-cake-board";
import {getWeddingCakes} from "@/lib/wedding-cakes";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
export const metadata:Metadata={title:"發餅名單"};
export default async function WeddingCakesPage({params}:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await params;
 let data;try{data=await getWeddingCakes(workspaceId);}catch(error){if(error instanceof WorkspaceAccessDeniedError)notFound();throw error;}
 return <main className="mx-auto w-full min-w-0 max-w-6xl px-5 py-6 sm:px-8 sm:py-12 print:m-0 print:max-w-none print:p-0">
  <div className="print:hidden"><WorkspacePageHeader workspaceId={workspaceId} workspaceName={data.workspace.name} sectionTitle="發餅名單" description="將共同出席的人設為同一家，準備給發餅工作人員的姓名、稱謂與盒數清單。" activeSection="guests"/></div>
  <WorkspaceSectionTabs label="賓客分頁" items={[
   {label:"婚宴名單",href:`/workspaces/${workspaceId}/guests`,active:false},
   {label:"發餅名單",href:`/workspaces/${workspaceId}/guests/cakes`,active:true},
  ]}/>
  <WeddingCakeBoard workspaceId={workspaceId} data={data}/>
 </main>;
}
