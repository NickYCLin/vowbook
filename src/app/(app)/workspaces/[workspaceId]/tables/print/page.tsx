import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {getSeatingPlan} from "@/lib/seating-plan";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
import {seatingPrintData} from "@/domain/seating-print";
import {OperationsPrintSheet} from "@/components/print/operations-print-sheet";
import {HouseholdPrintButton} from "@/components/guests/household-print-button";
export const metadata:Metadata={title:"招待帶位名單"};
export default async function SeatingPrintPage({params}:{params:Promise<{workspaceId:string}>}) {
 const {workspaceId}=await params;
 let data;try{data=await getSeatingPlan(workspaceId);}catch(error){if(error instanceof WorkspaceAccessDeniedError)notFound();throw error;}
 return <main className="mx-auto w-full min-w-0 max-w-7xl px-5 py-6 sm:px-8 print:m-0 print:max-w-none print:p-0">
  <div className="print:hidden"><Link href={`/workspaces/${workspaceId}/tables`} className="inline-flex min-h-11 items-center text-sm text-clay-strong">返回桌次安排</Link>
   <h1 className="my-4 font-serif text-2xl font-semibold">招待帶位名單</h1><HouseholdPrintButton label="列印帶位名單／另存 PDF"/>
  </div>
  <OperationsPrintSheet workspaceName={data.workspace.name} title="招待帶位名單" instructions="依現有桌次與桌號排列，每筆姓名包含同行人數。素食及兒童椅數字為已登記需求，未填者請另行確認。帶位完成後打勾；尚未排桌的親友列於最後，請先確認座位。紙本勾選不會自動更新報到紀錄。" data={seatingPrintData(data.tables,data.unassignedGuests)}/>
 </main>;
}
