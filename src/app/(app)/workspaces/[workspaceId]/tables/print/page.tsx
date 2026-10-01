import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {getSeatingPlan,getSeatingPrintDetails} from "@/lib/seating-plan";
import {WorkspaceAccessDeniedError,getWorkspacePermissions} from "@/domain/workspace";
import {seatingPrintData,type SeatingPrintDetails} from "@/domain/seating-print";
import {SeatingPrintSheet} from "@/components/tables/seating-print-sheet";
import {HouseholdPrintButton} from "@/components/guests/household-print-button";
export const metadata:Metadata={title:"招待帶位名單"};
export default async function SeatingPrintPage({params}:{params:Promise<{workspaceId:string}>}) {
 const {workspaceId}=await params;
 let data,details:SeatingPrintDetails|null=null;
 try{data=await getSeatingPlan(workspaceId);if(getWorkspacePermissions(data.role).canEdit)details=await getSeatingPrintDetails(workspaceId);}catch(error){if(error instanceof WorkspaceAccessDeniedError)notFound();throw error;}
 return <main className="mx-auto w-full min-w-0 max-w-7xl px-5 py-6 sm:px-8 print:m-0 print:max-w-none print:p-0">
  <div className="print:hidden"><Link href={`/workspaces/${workspaceId}/tables`} className="inline-flex min-h-11 items-center text-sm text-clay-strong">返回桌次安排</Link>
   <h1 className="my-4 font-serif text-2xl font-semibold">招待帶位名單</h1><HouseholdPrintButton label="列印帶位名單／另存 PDF"/>
  </div>
  <SeatingPrintSheet workspaceName={data.workspace.name} data={seatingPrintData(data.tables,data.unassignedGuests,details)}/>
 </main>;
}
