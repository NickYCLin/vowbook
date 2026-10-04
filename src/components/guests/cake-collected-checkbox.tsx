"use client";
import {useState, useTransition} from "react";
import {setCakeCollectedAction} from "@/actions/wedding-cakes";

/** 螢幕上可直接勾選已領取；列印時仍印出空框，方便現場用筆打勾。 */
export function CakeCollectedCheckbox({workspaceId,guestIds,names,collected}:{workspaceId:string;guestIds:readonly string[];names:string;collected:boolean}) {
 const [checked,setChecked]=useState(collected);
 const [error,setError]=useState<string|null>(null);
 const [pending,startTransition]=useTransition();
 const toggle=(next:boolean)=>{
  setChecked(next);setError(null);
  startTransition(async()=>{
   const result=await setCakeCollectedAction(workspaceId,[...guestIds],next);
   if(result.status!=="success"){setChecked(!next);setError(result.message??"儲存失敗，請稍後再試。");}
  });
 };
 return <>
  <label className="inline-flex cursor-pointer items-center gap-2 print:hidden">
   <input type="checkbox" className="h-6 w-6 shrink-0 cursor-pointer" checked={checked} disabled={pending} onChange={event=>toggle(event.currentTarget.checked)} aria-label={`標記 ${names} 已領取喜餅`}/>
   <span className={`text-xs ${checked?"text-ink":"text-ink-soft"}`}>{checked?"已領":"未領"}</span>
  </label>
  <span aria-hidden className="cake-check-box hidden h-6 w-6 border border-ink align-middle print:inline-block"/>
  {error?<p role="alert" className="mt-1 text-xs text-red-700 print:hidden">{error}</p>:null}
 </>;
}
