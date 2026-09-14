import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {WorkspacePageHeader} from "@/components/workspaces/workspace-shell";
import {WeddingCakeBoard} from "@/components/guests/wedding-cake-board";
import {getWeddingCakes} from "@/lib/wedding-cakes";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
export const metadata:Metadata={title:"發餅名單"};
export default async function WeddingCakesPage({params}:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await params;
 let data;try{data=await getWeddingCakes(workspaceId);}catch(error){if(error instanceof WorkspaceAccessDeniedError)notFound();throw error;}
 return <main className="mx-auto w-full min-w-0 max-w-6xl px-5 py-6 sm:px-8 sm:py-12">
  <WorkspacePageHeader workspaceId={workspaceId} workspaceName={data.workspace.name} sectionTitle="發餅名單" description="將共同出席的人設為同一家，準備給發餅工作人員的姓名、稱謂與盒數清單。" activeSection="guests"/>
  <Link href={`/workspaces/${workspaceId}/guests`} className="inline-flex min-h-11 items-center text-sm text-clay-strong">返回婚宴名單</Link>
  <WeddingCakeBoard workspaceId={workspaceId} data={data}/>
 </main>;
}
