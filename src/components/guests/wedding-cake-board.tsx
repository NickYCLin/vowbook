"use client";
import {useActionState, useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {Button, buttonClassName} from "@/components/ui/button";
import {Field, Input} from "@/components/ui/field";
import {saveCakeHouseholdAction,dissolveCakeHouseholdAction,type CakeMutationState} from "@/actions/wedding-cakes";
import {cakeMemberSnapshot,cakeRows,cakeRelationshipLabel} from "@/domain/wedding-cake";
import {withBasePath} from "@/lib/base-path";
import type {WeddingCakeData} from "@/lib/wedding-cakes";
type Household=WeddingCakeData["households"][number];
function HouseholdForm({workspaceId,data,household,onClose}:{workspaceId:string;data:WeddingCakeData;household?:Household;onClose:()=>void}){
 const router=useRouter();
 const [state,action,pending]=useActionState(saveCakeHouseholdAction.bind(null,workspaceId,household?.id??null),{status:"idle"} as CakeMutationState);
 const [deleted,deleteAction,deleting]=useActionState(dissolveCakeHouseholdAction.bind(null,workspaceId,household?.id??""),{status:"idle"} as CakeMutationState);
 const [confirmDissolve,setConfirmDissolve]=useState(false);
 const members=data.guests.filter(g=>household&&g.cakeHouseholdId===household.id);
 const [selected,setSelected]=useState(members.map(g=>g.id));
 const [query,setQuery]=useState("");
 const [name,setName]=useState(household?.name??"");
 const [boxes,setBoxes]=useState(String(household?.boxes??1));
 useEffect(()=>{if(state.status==="success"||deleted.status==="success"){router.refresh();onClose();}},[state.status,deleted.status,router,onClose]);
 const hidden=<><input type="hidden" name="expectedVersion" value={household?.version??0}/><input type="hidden" name="expectedMembers" value={cakeMemberSnapshot(members)}/><input type="hidden" name="expectedGuests" value={JSON.stringify(Object.fromEntries(data.guests.map(g=>[g.id,g.version])))}/></>;
 return <section className="my-6 min-w-0 rounded-card border border-line bg-surface p-5" aria-label={household?"編輯發餅家庭":"新增發餅家庭"}>
  <h2 className="font-serif text-xl font-semibold">{household?"編輯發餅家庭":"設定同一家人"}</h2>
  <p className="mt-2 text-sm text-ink-soft">每戶預設一盒；也可只選一筆名單調整盒數。設為 0 盒代表當日不領餅，仍會列出供核對。</p>
  <form action={action} className="mt-5 space-y-5">
   {hidden}{selected.map(id=><input key={id} type="hidden" name="guestId" value={id}/>)}
   <div className="grid min-w-0 gap-5 sm:grid-cols-2">
    <Field htmlFor="cake-household-name" label="家庭名稱"><Input id="cake-household-name" name="name" value={name} onChange={e=>setName(e.target.value)} maxLength={100} required placeholder="例如：舅舅一家"/></Field>
    <Field htmlFor="cake-household-boxes" label="喜餅盒數"><Input id="cake-household-boxes" name="boxes" type="number" min={0} max={999} step={1} value={boxes} onChange={e=>setBoxes(e.target.value)} required/></Field>
   </div>
   <Field htmlFor="cake-guest-search" label="搜尋成員"><Input id="cake-guest-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="輸入姓名或稱謂"/></Field>
   <fieldset className="min-w-0"><legend className="text-sm font-semibold">同一家人的成員（已選 {selected.length} 筆）</legend>
    <div className="mt-2 max-h-80 overflow-y-auto rounded-control border border-line">
    {data.guests.filter(g=>`${g.name} ${cakeRelationshipLabel(g)}`.includes(query.trim())).map(g=>{
     const occupied=g.cakeHouseholdId!==null&&g.cakeHouseholdId!==household?.id;
     return <label key={g.id} className="flex min-h-11 min-w-0 items-center gap-3 border-b border-line p-3 text-sm last:border-0">
      <input type="checkbox" className="h-5 w-5 shrink-0" checked={selected.includes(g.id)} disabled={occupied||pending||deleting} onChange={e=>setSelected(current=>e.target.checked?[...current,g.id]:current.filter(id=>id!==g.id))}/>
      <span className="min-w-0 break-words">{g.name} · {cakeRelationshipLabel(g)} · {g.partySize} 人{g.attendanceStatus==="ATTENDING"||g.checkedIn?" · 確認出席":" · 尚未確認出席，不列入匯出"}{occupied?" · 已屬其他家庭":""}</span>
     </label>;
    })}</div>
   </fieldset>
   {state.message?<p role="status" className="text-sm text-danger">{state.message}</p>:null}
   <div className="flex flex-wrap gap-3"><Button type="submit" disabled={pending||deleting||!selected.length}>{pending?"儲存中…":"儲存家庭設定"}</Button><Button variant="secondary" onClick={onClose} disabled={pending||deleting}>取消</Button></div>
  </form>
  {household?<form action={deleteAction} className="mt-5 border-t border-line pt-5">{hidden}
   {confirmDissolve?<><p className="mb-3 text-sm">解散後，每筆確認出席名單會恢復各領一盒。</p><Button type="submit" variant="danger" disabled={pending||deleting}>確認解散家庭</Button></>:<Button variant="danger" onClick={()=>setConfirmDissolve(true)} disabled={pending||deleting}>解散家庭</Button>}
   {deleted.message?<p role="status">{deleted.message}</p>:null}
  </form>:null}
 </section>;
}
export function WeddingCakeBoard({workspaceId,data,defaultCreateOpen=false}:{workspaceId:string;data:WeddingCakeData;defaultCreateOpen?:boolean}){
 const [editing,setEditing]=useState<Household|null|undefined>(defaultCreateOpen?null:undefined);
 const rows=cakeRows(data.guests,data.households);
 return <>
  <div className="mt-6 flex flex-wrap items-center gap-3"><Button onClick={()=>setEditing(null)}>設定同一家人</Button><a href={withBasePath(`/workspaces/${workspaceId}/guests/cakes/export`)} className={buttonClassName({variant:"secondary"})}>匯出發餅名單（CSV）</a></div>
  <p className="mt-4 text-sm leading-6 text-ink-soft">所有確認出席或已報到的人都會列入。同戶只算一次；未設定家庭時，每筆名單一盒，同行人數不會增加盒數。稱謂可到賓客的「關係補充」編輯。</p>
  {editing!==undefined?<HouseholdForm key={editing?.id??"new"} workspaceId={workspaceId} data={data} household={editing??undefined} onClose={()=>setEditing(undefined)}/>:null}
  <section className="mt-6" aria-label="已設定家庭"><h2 className="font-serif text-lg font-semibold">已設定家庭</h2>
   {!data.households.length?<p className="mt-2 text-sm text-ink-soft">尚未合併家庭；可勾選共同出席的人，設定為同一家。</p>:<div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">{data.households.map(h=><div key={h.id} className="min-w-0 rounded-card border border-line p-4"><p className="break-words font-semibold">{h.name} · {h.boxes} 盒</p><p className="my-2 break-words text-sm text-ink-soft">{data.guests.filter(g=>g.cakeHouseholdId===h.id).map(g=>g.name).join("、")||"目前沒有成員"}</p><Button variant="secondary" onClick={()=>setEditing(h)} aria-label={`編輯家庭 ${h.name}`}>編輯家庭</Button></div>)}</div>}
  </section>
  <section className="mt-8" aria-label="發餅匯出預覽"><h2 className="font-serif text-lg font-semibold">發餅名單 · {rows.length} 戶／筆，共 {rows.reduce((sum,r)=>sum+r.boxes,0)} 盒</h2>
   <div className="mt-3 overflow-x-auto rounded-card border border-line"><table className="w-full table-fixed text-left text-sm"><thead className="bg-surface"><tr><th className="w-2/5 p-3">姓名</th><th className="w-2/5 p-3">稱謂</th><th className="p-3">盒數</th></tr></thead><tbody>{rows.map(r=><tr key={r.key} className="border-t border-line"><td className="break-words p-3">{r.names}</td><td className="break-words p-3">{r.relationships}</td><td className="p-3">{r.boxes}</td></tr>)}</tbody></table></div>
   {!rows.length?<p className="mt-3 text-sm">尚無確認出席名單。</p>:null}
  </section>
 </>;
}
