import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {getBudgetPageData} from "@/lib/budget-list";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
import {balancePrintData} from "@/domain/operations-print";
import {OperationsPrintSheet} from "@/components/print/operations-print-sheet";
import {HouseholdPrintButton} from "@/components/guests/household-print-button";
export const metadata:Metadata={title:"廠商尾款清單"};
export default async function PrintPage({params}:{params:Promise<{workspaceId:string}>}) {
 const {workspaceId}=await params;
 let data;try{data=await getBudgetPageData(workspaceId);}catch(error){if(error instanceof WorkspaceAccessDeniedError)notFound();throw error;}
 return <main className="mx-auto w-full min-w-0 max-w-7xl px-5 py-6 sm:px-8 print:m-0 print:max-w-none print:p-0">
  <div className="print:hidden"><Link href={`/workspaces/${workspaceId}/budget`} className="inline-flex min-h-11 items-center text-sm text-clay-strong">返回婚禮花費</Link>
   <h1 className="my-4 font-serif text-2xl font-semibold">廠商尾款清單</h1><HouseholdPrintButton label="列印廠商尾款清單／另存 PDF"/>
  </div>
  <OperationsPrintSheet workspaceName={data.workspaceName} title="廠商尾款清單" instructions="列出需要安排且已下訂、尾款未清的費用項目。尾款採各項直接登記金額，不重複加總分類小計；追加費用另列備註，請核對是否已付。付款方式設為現金或紅包的尾款，會加總成當天需備現金。付款後打勾，並回網站更新付款狀態。" data={balancePrintData(data.items)}/>
 </main>;
}
