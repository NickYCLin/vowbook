import type {SeatingPrintData} from "@/domain/seating-print";
export function SeatingPrintSheet({workspaceName,data}:{workspaceName:string;data:SeatingPrintData}) {
 return <section data-print-document data-seating-print aria-label="招待帶位名單" className="mt-6 print:mt-0">
  <style>{`@media print {
 @page {size:A4 landscape;margin:10mm}
 html:has([data-seating-print]),body:has([data-seating-print]),body:has([data-seating-print]) * {background:white!important;background-image:none!important;box-shadow:none!important;color:black!important}
 [data-seating-print] {font-size:10.5pt}
 [data-seating-print] .seating-groups {display:block;columns:2;column-gap:8mm}
 [data-seating-print] .seating-group {overflow:visible;margin:0 0 5mm;border:1px solid black!important;display:block;width:100%}
 [data-seating-print] .seating-group thead {display:table-header-group;break-inside:avoid;break-after:avoid}
 [data-seating-print] .seating-party {break-inside:avoid;page-break-inside:avoid}
 [data-seating-print] .seating-group-head {border-bottom:1.5px solid black!important}
 [data-seating-print] tr.border-t td {border-top:1px solid #999!important}
 [data-seating-print] .print-check {width:5mm;height:5mm;border:1px solid black!important}
}`}</style>
  <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b-2 border-ink pb-2">
   <h2 className="font-serif text-xl font-semibold">{workspaceName}｜招待帶位名單</h2>
   <p className="font-semibold">{data.summary}</p>
  </header>
  <p className="mt-2 mb-4 text-sm text-ink-soft">帶位完成後打勾，同一戶共用一個勾選框；「需求」空白表示不需要素食或兒童椅。紙本勾選不會自動更新報到紀錄。</p>
  {data.groups.length?<div className="seating-groups grid items-start gap-4 lg:grid-cols-2">{data.groups.map(group=>{
   const head=<div className={`seating-group-head flex items-baseline justify-between gap-3 px-4 py-2 ${group.assigned?"bg-clay-soft":"bg-caution-soft"}`}>
     <h3 className="font-serif text-lg font-semibold">{group.title}</h3>
     <span className={`shrink-0 text-sm font-semibold tabular-nums ${group.full?"text-positive":"text-ink-soft"}`}>{group.meta}</span>
    </div>;
   return <article key={group.key} className={`seating-group overflow-hidden rounded-lg border ${group.assigned?"border-line-strong":"border-dashed border-caution"} bg-surface`}>
    {group.parties.length?null:head}
    {group.parties.length?<table className="w-full table-fixed text-left text-sm">
     <colgroup><col style={{width:"9%"}}/><col style={{width:data.showRelationship?"34%":"48%"}}/>{data.showRelationship?<col style={{width:"22%"}}/>:null}<col style={{width:"12%"}}/><col style={{width:data.showRelationship?"23%":"31%"}}/></colgroup>
     <thead className="text-xs text-ink-soft"><tr><th colSpan={data.showRelationship?5:4} className="p-0 text-left font-normal text-ink">{head}</th></tr><tr><th className="px-3 py-1 font-normal"><span className="sr-only">帶位勾選</span></th><th className="px-2 py-1 font-normal">賓客</th>{data.showRelationship?<th className="px-2 py-1 font-normal">稱謂</th>:null}<th className="px-2 py-1 text-right font-normal">人數</th><th className="px-2 py-1 font-normal">需求</th></tr></thead>
     {group.parties.map(party=><tbody key={party.key} className="seating-party">{[...party.guests.map((g,index)=><tr key={g.key} className={index?"":"border-t border-line"}>
      {index?null:<td rowSpan={party.guests.length+(party.elsewhere?1:0)} className={`px-3 py-2 align-top ${party.guests.length>1?"border-r border-dotted border-line-strong":""}`}>{group.assigned?<span role="img" aria-label={party.guests.length>1?`${party.guests.map(member=>member.name).join("、")}同一戶帶位完成勾選框`:"帶位完成勾選框"} className="print-check inline-block h-5 w-5 rounded-sm border border-ink"/>:null}</td>}
      <td className={`px-2 ${index?"pb-2":"py-2"} align-top font-medium break-words`}>{g.name}</td>
      {data.showRelationship?<td className={`px-2 ${index?"pb-2":"py-2"} align-top text-ink-soft break-words`}>{g.relationship}</td>:null}
      <td className={`px-2 ${index?"pb-2":"py-2"} text-right align-top tabular-nums`}>{g.partySize} 位</td>
      <td className={`px-2 ${index?"pb-2":"py-2"} align-top break-words`}>{g.needs}</td>
     </tr>),...(party.elsewhere?[<tr key={`${party.key}:elsewhere`}><td colSpan={data.showRelationship?4:3} className="px-2 pb-2 text-xs text-caution">{party.elsewhere}</td></tr>]:[])]}</tbody>)}
    </table>:<p className="px-4 py-3 text-sm text-ink-faint">尚未安排賓客</p>}
   </article>;})}</div>:<p className="py-6 text-ink-soft">目前沒有桌次或賓客。</p>}
 </section>;
}
