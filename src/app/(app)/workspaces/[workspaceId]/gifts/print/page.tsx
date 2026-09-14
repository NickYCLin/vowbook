import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {getWeddingCakes} from "@/lib/wedding-cakes";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
import {giftPrintRows} from "@/domain/wedding-gift-print";
import {HouseholdPrintSheet} from "@/components/guests/household-print-sheet";
import {HouseholdPrintButton} from "@/components/guests/household-print-button";
export const metadata:Metadata={title:"紙本禮金簿"};
export default async function GiftPrintPage({params}:{params:Promise<{workspaceId:string}>}) {
 const {workspaceId}=await params;
 let data;try{data=await getWeddingCakes(workspaceId);}catch(error){if(error instanceof WorkspaceAccessDeniedError)notFound();throw error;}
 return <main className="mx-auto w-full min-w-0 max-w-6xl px-5 py-6 sm:px-8 sm:py-12 print:m-0 print:max-w-none print:p-0">
  <div className="print:hidden">
   <Link href={`/workspaces/${workspaceId}/gifts`} className="inline-flex min-h-11 items-center text-sm text-clay-strong">返回禮金簿</Link>
   <h1 className="mt-3 font-serif text-2xl font-semibold">紙本禮金簿</h1>
   <p className="my-4 text-sm leading-6 text-ink-soft">沿用發餅名單的同一家人設定，每戶一列。包含所有受邀親友，不受出席回覆影響；新人本人、雙方父母與兄弟姊妹不列入（依已設定的關係稱謂辨識）。金額欄留白供現場手寫，不收禮金者保留標記。</p>
   <HouseholdPrintButton label="列印禮金簿／另存 PDF"/>
  </div>
  <HouseholdPrintSheet workspaceName={data.workspace.name} rows={giftPrintRows(data.guests)} kind="gifts"/>
 </main>;
}
