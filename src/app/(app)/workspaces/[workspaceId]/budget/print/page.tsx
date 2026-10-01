import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {getBudgetPageData} from "@/lib/budget-list";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
import {balanceSheetData} from "@/domain/balance-print";
import {BalancePrintSheet} from "@/components/budget/balance-print-sheet";
import {HouseholdPrintButton} from "@/components/guests/household-print-button";
export const metadata:Metadata={title:"尾款待付清單"};
export default async function PrintPage({params}:{params:Promise<{workspaceId:string}>}) {
 const {workspaceId}=await params;
 let data;try{data=await getBudgetPageData(workspaceId);}catch(error){if(error instanceof WorkspaceAccessDeniedError)notFound();throw error;}
 return <main className="mx-auto w-full min-w-0 max-w-7xl px-5 py-6 sm:px-8 print:m-0 print:max-w-none print:p-0">
  <div className="print:hidden"><Link href={`/workspaces/${workspaceId}/budget`} className="inline-flex min-h-11 items-center text-sm text-clay-strong">返回婚禮花費</Link>
   <h1 className="my-4 font-serif text-2xl font-semibold">尾款待付清單</h1><HouseholdPrintButton label="列印尾款待付清單／另存 PDF"/>
  </div>
  <BalancePrintSheet workspaceName={data.workspaceName} data={balanceSheetData(data.items,data.staffRedEnvelopes)}/>
 </main>;
}
