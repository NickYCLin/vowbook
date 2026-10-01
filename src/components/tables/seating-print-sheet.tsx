import type {SeatingPrintData} from "@/domain/seating-print";
/** 帶位名單濃縮成一張 A4：直式三欄，每桌一塊不切開；只印姓名、人數與素食／兒童椅。 */
export function SeatingPrintSheet({workspaceName,data}:{workspaceName:string;data:SeatingPrintData}) {
 return <section data-print-document data-seating-print aria-label="招待帶位名單" className="mt-6 print:mt-0">
  <style>{`@media print {
 @page {size:A4 portrait;margin:8mm}
 html:has([data-seating-print]),body:has([data-seating-print]),body:has([data-seating-print]) * {background:white!important;background-image:none!important;box-shadow:none!important;color:black!important}
 [data-seating-print] {font-size:9pt;line-height:1.3}
 [data-seating-print] .seating-groups {display:block;columns:3;column-gap:5mm}
 [data-seating-print] .seating-group {display:block;width:100%;margin:0 0 3mm;break-inside:avoid;page-break-inside:avoid;border:1px solid black!important}
 [data-seating-print] .seating-group-head {border-bottom:1px solid black!important}
}`}</style>
  {data.unassigned?<p className="mb-3 text-sm text-caution print:hidden">還有 {data.unassigned} 位尚未排桌，帶位名單不會列出。</p>:null}
  <header className="flex items-baseline justify-between gap-4 border-b-2 border-ink pb-1">
   <h2 className="font-serif text-lg font-semibold">{workspaceName}｜招待帶位名單</h2>
   <p className="text-sm font-semibold tabular-nums">{data.summary}</p>
  </header>
  {data.groups.length?<div className="seating-groups mt-3 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.groups.map(group=><article key={group.key} className="seating-group overflow-hidden rounded-md border border-line-strong bg-surface">
   <div className="seating-group-head flex items-baseline justify-between gap-2 bg-clay-soft px-2 py-1">
    <h3 className="font-semibold">{group.title}</h3>
    <span className={`shrink-0 text-xs tabular-nums ${group.full?"text-positive":"text-ink-soft"}`}>{group.meta}</span>
   </div>
   <ul className="px-2 py-1 text-sm">{group.parties.map(party=><li key={party.key} className="py-0.5">
    {party.guests.map((g,index)=><span key={g.key}>{index?"、":""}<span className="font-medium">{g.name}</span>{g.partySize>1?<span className="text-ink-soft tabular-nums"> {g.partySize} 位</span>:null}{g.needs?<span className="text-caution"> {g.needs}</span>:null}</span>)}
    {party.elsewhere?<span className="block text-xs text-caution">{party.elsewhere}</span>:null}
   </li>)}</ul>
  </article>)}</div>:<p className="py-6 text-ink-soft">目前沒有已排桌的賓客。</p>}
 </section>;
}
