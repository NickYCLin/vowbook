import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {getWeddingStaffList} from "@/lib/wedding-staff-list";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
import {staffPrintData} from "@/domain/operations-print";
import {OperationsPrintSheet} from "@/components/print/operations-print-sheet";
import {HouseholdPrintButton} from "@/components/guests/household-print-button";
export const metadata:Metadata={title:"工作人員發放清單"};
export default async function PrintPage({params}:{params:Promise<{workspaceId:string}>}) {
 const {workspaceId}=await params;
 let data;try{data=await getWeddingStaffList(workspaceId);}catch(error){if(error instanceof WorkspaceAccessDeniedError)notFound();throw error;}
 return <main className="mx-auto w-full min-w-0 max-w-7xl px-5 py-6 sm:px-8 print:m-0 print:max-w-none print:p-0">
  <div className="print:hidden"><Link href={`/workspaces/${workspaceId}/staff`} className="inline-flex min-h-11 items-center text-sm text-clay-strong">返回工作人員</Link>
   <h1 className="my-4 font-serif text-2xl font-semibold">工作人員發放清單</h1><HouseholdPrintButton label="列印工作人員發放清單／另存 PDF"/>
  </div>
  <OperationsPrintSheet workspaceName={data.workspace.name} title="工作人員發放清單" instructions="依現有工作安排逐筆列出。便當及紅包發出後各自打勾；同一人兼任多個職務時，請依已設定的份數與紅包核對。紙本勾選不會自動更新網站。" data={staffPrintData(data.staff)}/>
 </main>;
}
