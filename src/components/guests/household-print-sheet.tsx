import {cakeRowGroups,type CakeGroup} from "@/domain/wedding-cake";
export type HouseholdPrintRow={key:string;group:CakeGroup;names:string;relationships:string;boxes?:number;exempt?:boolean;notes?:string};
export function HouseholdPrintSheet({workspaceName,rows,kind}:{workspaceName:string;rows:readonly HouseholdPrintRow[];kind:"cakes"|"gifts"}) {
 const cake=kind==="cakes";
 const title=cake?"發餅名單":"紙本禮金簿";
 const groups=cakeRowGroups(rows);
 const countLabel=(entries:readonly HouseholdPrintRow[])=>`${entries.length} 戶／筆${cake?`，共 ${entries.reduce((sum,row)=>sum+(row.boxes??0),0)} 盒`:""}`;
 return <>
  <style>{`@media print {
 @page { size: A4 portrait; margin: 12mm; }
 html:has([data-household-print]), body:has([data-household-print]), body:has([data-household-print]) * { background-color: white !important; background-image: none !important; box-shadow: none !important; }
 [data-household-print] { color: black !important; margin: 0 !important; font-size: 11pt; }
 [data-household-print] * { color: black !important; background: transparent !important; }
 [data-household-print] .household-table-wrap { overflow: visible; border: 0; border-radius: 0; }
 [data-household-print] table { border-collapse: collapse; width: calc(100% - 1px); }
 [data-household-print] thead { display: table-header-group; break-inside: avoid; break-after: avoid; }
 [data-household-print] tr { break-inside: avoid; page-break-inside: avoid; }
 [data-household-print] th, [data-household-print] td { border: 1px solid black; padding: 3mm; }
 [data-household-print] .cake-check-box { width: 6mm; height: 6mm; border: 1px solid black; }
 [data-household-print] .gift-amount-blank { min-height: 9mm; }
}`}</style>
  <section data-household-print data-cake-print={cake?true:undefined} data-gift-print={!cake?true:undefined} className="mt-8 print:mt-0" aria-label={cake?"發餅匯出預覽":"紙本禮金簿預覽"}>
   <p className="hidden print:block font-semibold">{workspaceName}｜{title}</p>
   <p className="hidden print:block my-2 text-sm">{cake?"請核對姓名與盒數，發放後在「領取勾選」欄打勾。同戶只領一次，新人本人不領餅。":"同一家人合併登記，請在金額欄手寫收到的禮金。金額欄預留空白，不收禮金者已註明。"}</p>
   <h2 className="font-serif text-lg font-semibold">{title} · {countLabel(rows)}</h2>
   {groups.map(group=><section key={group.id} aria-label={group.label} className={`mt-6 ${group.rows.length?"":"print:hidden"}`}>
    <h3 className="font-serif text-lg font-semibold print:hidden">{group.label} · {countLabel(group.rows)}</h3>
    {group.rows.length?<div className="household-table-wrap mt-3 overflow-x-auto rounded-card border border-line">
     <table className="w-full table-fixed text-left text-sm">
      <colgroup>{(cake?[30,40,12,18]:[25,35,20,20]).map((width,index)=><col key={index} style={{width:`${width}%`}}/>)}</colgroup>
      <thead className="bg-surface">
       <tr className="hidden print:table-row"><th colSpan={4} className="p-3 text-base">{group.label} · {countLabel(group.rows)}</th></tr>
       <tr><th className={cake?"w-[30%] p-3":"w-1/4 p-3"}>姓名</th><th className={cake?"w-[40%] p-3":"w-[35%] p-3"}>稱謂</th><th className={cake?"w-[12%] p-3":"w-1/5 p-3"}>{cake?"盒數":"禮金金額（元）"}</th><th className={cake?"w-[18%] p-3":"w-1/5 p-3"}>{cake?"領取勾選":"備註"}</th></tr>
      </thead>
      <tbody>{group.rows.map(row=><tr key={row.key} className="border-t border-line">
       <td className="break-words p-3">{row.names}</td><td className="break-words p-3">{row.relationships}</td>
       <td className="p-3">{cake?row.boxes:row.exempt?<span className="font-semibold">不收禮金</span>:<span data-gift-amount-blank className="gift-amount-blank block min-h-9 w-full border-b border-ink"/>}</td>
       <td className="break-words p-3">{cake?<span role="img" aria-label="領取勾選框" className="cake-check-box inline-block h-6 w-6 border border-ink align-middle"/>:row.notes}</td>
      </tr>)}</tbody>
     </table>
    </div>:<p className="mt-2 text-sm text-ink-soft">{cake?"此分類目前沒有確認出席的領餅名單。":"此分類目前沒有親友名單。"}</p>}
   </section>)}
   {!rows.length?<p className="mt-3 text-sm">{cake?"尚無確認出席名單。":"尚無可列印的親友名單。"}</p>:null}
  </section>
 </>;
}
