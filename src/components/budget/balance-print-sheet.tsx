import type {BalanceSheetData,BalanceVendor} from "@/domain/balance-print";

const check=(label:string)=><span role="img" aria-label={label} className="print-check mt-1 inline-block h-5 w-5 shrink-0 rounded-sm border border-ink"/>;
/** 現金紅包當天交給對方時勾選。 */
const cashChecks=(name:string)=><span className="flex shrink-0 flex-col items-center text-center text-[10px] leading-tight text-ink-soft">{check(`${name}紅包已交勾選框`)}已交</span>;

function VendorCard({vendor,cash}:{vendor:BalanceVendor;cash:boolean}) {
 const showMethod=vendor.lines.some(line=>line.method);
 return <article className="balance-card flex gap-3 border-t border-line px-4 py-3 first:border-t-0">
  {cash?cashChecks(`${vendor.vendor}尾款`):check(`${vendor.vendor}尾款付款勾選框`)}
  <div className="min-w-0 flex-1">
   <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
    <div className="min-w-0">
     <h4 className="font-semibold break-words">{vendor.vendor}</h4>
     <p className="text-sm text-ink-soft break-words">{vendor.lines.map(line=>line.name).join("、")}{vendor.contact?<span>・{vendor.contact}</span>:null}</p>
    </div>
    <div className="text-right">
     <p className="font-serif text-lg font-semibold tabular-nums">{vendor.remaining}</p>
     <p className="text-xs text-ink-soft">{[vendor.method,vendor.dueDate||"未設定期限"].join("・")}</p>
    </div>
   </div>
   {vendor.detailed?<table className="mt-2 w-full table-fixed text-left text-xs tabular-nums">
    <thead className="text-ink-faint"><tr>
     <th className="py-1 pr-2 font-normal">項目</th>
     <th className="py-1 px-2 text-right font-normal">尾款</th>
     <th className="py-1 px-2 text-right font-normal">＋加購</th>
     <th className="py-1 px-2 text-right font-normal">－已先付</th>
     <th className="py-1 pl-2 text-right font-normal">＝還要付</th>
     {showMethod?<th className="py-1 pl-2 font-normal">付款方式</th>:null}
    </tr></thead>
    <tbody>{vendor.lines.map(line=><tr key={line.key} className="border-t border-dotted border-line">
     <td className="py-1 pr-2 break-words">{line.name}</td>
     <td className="py-1 px-2 text-right">{line.balance}</td>
     <td className="py-1 px-2 text-right">{line.additional}</td>
     <td className="whitespace-pre-line py-1 px-2 text-right">{line.paid}</td>
     <td className="py-1 pl-2 text-right font-semibold">{line.remaining}</td>
     {showMethod?<td className="py-1 pl-2">{line.method}</td>:null}
    </tr>)}</tbody>
   </table>:null}
   {vendor.notes.length?<ul className="mt-2 space-y-0.5 text-xs text-ink-soft">{vendor.notes.map(note=><li key={note.key} className="whitespace-pre-wrap break-words">備註{note.label?`（${note.label}）`:""}：{note.text}</li>)}</ul>:null}
  </div>
 </article>;
}

export function BalancePrintSheet({workspaceName,data}:{workspaceName:string;data:BalanceSheetData}) {
 const empty=!data.sections.length;
 return <section data-print-document data-balance-print aria-label="尾款待付清單" className="mt-6 print:mt-0">
  <style>{`@media print {
 @page {size:A4 portrait;margin:12mm}
 html:has([data-balance-print]),body:has([data-balance-print]),body:has([data-balance-print]) * {background:white!important;background-image:none!important;box-shadow:none!important;color:black!important}
 [data-balance-print] {font-size:10.5pt}
 [data-balance-print] .balance-card,[data-balance-print] .balance-total,[data-balance-print] tr {break-inside:avoid;page-break-inside:avoid}
 [data-balance-print] .balance-section-head {break-after:avoid;border-bottom:1.5px solid black!important}
 [data-balance-print] .balance-section {border:1px solid black!important}
 [data-balance-print] .print-check {width:5mm;height:5mm;border:1px solid black!important}
}`}</style>
  <header className="border-b-2 border-ink pb-2"><h2 className="font-serif text-xl font-semibold">{workspaceName}｜尾款待付清單</h2></header>
  <div className="mt-4 grid gap-3 sm:grid-cols-3">
   {[{label:"還要付",value:data.remaining,hint:data.counts},{label:"當天備現金",value:data.cash,hint:"廠商尾款紅包＋工作人員紅包"},{label:"已先分批付款",value:data.prepaid,hint:"已從上面金額扣除"}].map(card=>
    <div key={card.label} className="balance-total rounded-card border border-line-strong bg-surface px-4 py-3">
     <p className="text-sm text-ink-soft">{card.label}</p>
     <p className="font-serif text-2xl font-semibold tabular-nums">{card.value}</p>
     <p className="text-xs text-ink-faint">{card.hint}</p>
    </div>)}
  </div>
  {data.warnings.length?<ul className="mt-3 flex flex-wrap gap-2">{data.warnings.map(w=><li key={w} className="rounded-full bg-caution-soft px-3 py-1 text-xs font-semibold text-caution">{w}</li>)}</ul>:null}
  <p className="mt-3 text-sm text-ink-soft">還要付＝尾款＋加購－已先分批付的款項。尾款預設用現金紅包付；現金紅包（廠商尾款與工作人員紅包）當天交給對方時勾「已交」。匯款或刷卡付清後打勾，並回網站記錄；紙本勾選不會自動更新網站。</p>
  {empty?<p className="py-6 text-ink-soft">目前沒有待付的尾款或紅包。</p>:<div className="mt-4 space-y-5">{data.sections.map(section=>
   <section key={section.id} aria-label={section.title} className={`balance-section overflow-hidden rounded-card border bg-surface ${section.id==="UNSET"?"border-dashed border-caution":"border-line-strong"}`}>
    <header className={`balance-section-head flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2 ${section.id==="CASH"?"bg-clay-soft":section.id==="UNSET"?"bg-caution-soft":"bg-sage-soft"}`}>
     <div><h3 className="font-serif text-lg font-semibold">{section.title}</h3><p className="text-xs text-ink-soft">{section.hint}</p></div>
     <p className="font-semibold tabular-nums">小計 {section.total}</p>
    </header>
    {section.vendors.map(vendor=><VendorCard key={vendor.key} vendor={vendor} cash={section.id==="CASH"}/>)}
    {section.staffEnvelopes?<div className="border-t border-line-strong">
     <div className="flex flex-wrap items-baseline justify-between gap-x-4 bg-surface px-4 pt-3">
      <h4 className="font-semibold">工作人員紅包 {section.staffEnvelopes.count} 份</h4>
      <p className="font-serif text-lg font-semibold tabular-nums">{section.staffEnvelopes.total}</p>
     </div>
     {section.staffEnvelopes.people.map(person=><article key={person.key} className="balance-card flex items-center gap-3 border-t border-dotted border-line px-4 py-2 first-of-type:border-t-0">
      {cashChecks(`${person.name}（${person.role}）`)}
      <p className="min-w-0 flex-1 break-words"><span className="font-semibold">{person.name}</span><span className="text-sm text-ink-soft">・{person.role}</span></p>
      <p className="font-semibold tabular-nums">{person.amount}</p>
     </article>)}
    </div>:null}
   </section>)}</div>}
 </section>;
}
