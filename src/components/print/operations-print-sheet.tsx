import type {OperationsPrintData} from "@/domain/operations-print";
export function OperationsPrintSheet({workspaceName,title,instructions,data}:{workspaceName:string;title:string;instructions:string;data:OperationsPrintData}) {
 return <section data-operations-print aria-label={title} className="mt-6 print:mt-0">
  <style>{`@media print {
 @page {size:A4 landscape;margin:12mm}
 html:has([data-operations-print]),body:has([data-operations-print]),body:has([data-operations-print]) * {background:white!important;background-image:none!important;box-shadow:none!important;color:black!important}
 [data-operations-print] {font-size:11pt}
 [data-operations-print] .operations-wrap {overflow:visible}
 [data-operations-print] table {width:calc(100% - 1px);border-collapse:collapse}
 [data-operations-print] thead {display:table-header-group;break-inside:avoid;break-after:avoid}
 [data-operations-print] tr {break-inside:avoid;page-break-inside:avoid}
 [data-operations-print] td,[data-operations-print] th {border:1px solid black;padding:3mm}
 [data-operations-print] .print-check {width:6mm;height:6mm;border:1px solid black}
}`}</style>
  <h2 className="font-serif text-xl font-semibold">{workspaceName}｜{title}</h2>
  <p className="my-2 text-sm">{instructions}</p><p className="mb-4 font-semibold">{data.summary}</p>
  {data.rows.length?<div className="operations-wrap overflow-x-auto"><table className="w-full table-fixed text-left text-sm">
   <colgroup>{data.columns.map(c=><col key={c.label} style={{width:`${c.width}%`}}/>)}</colgroup>
   <thead><tr>{data.columns.map(c=><th key={c.label} className="border border-line p-3 break-words">{c.label}</th>)}</tr></thead>
   <tbody>{data.rows.map(row=><tr key={row.key}>{row.cells.map((cell,index)=><td key={index} className="border border-line p-3 whitespace-pre-wrap break-words">{typeof cell==="string"?cell:<span role="img" aria-label={cell.checkLabel} className="print-check inline-block h-6 w-6 border border-ink"/>}</td>)}</tr>)}</tbody>
  </table></div>:<p className="py-6 text-ink-soft">目前沒有符合條件的項目。</p>}
 </section>;
}
