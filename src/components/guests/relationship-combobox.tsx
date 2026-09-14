"use client";
import {useEffect,useRef,useState} from "react";
import {Input} from "@/components/ui/field";
import {searchFamilyRelationships} from "@/domain/family-relationship";
export function RelationshipCombobox({id,value,onChange}:{id:string;value:string;onChange:(value:string)=>void}){
 const [open,setOpen]=useState(false);
 const [query,setQuery]=useState("");
 const [active,setActive]=useState(0);
 const composing=useRef(false);
 const wrapperRef=useRef<HTMLDivElement>(null);
 const listRef=useRef<HTMLUListElement>(null);
 const options=searchFamilyRelationships(query);
 useEffect(()=>{
  const list=listRef.current;
  const option=list?.children[active] as HTMLElement|undefined;
  if(!list||!option)return;
  const bounds=list.getBoundingClientRect();
  const item=option.getBoundingClientRect();
  if(item.top<bounds.top)list.scrollTop-=bounds.top-item.top;
  else if(item.bottom>bounds.bottom)list.scrollTop+=item.bottom-bounds.bottom;
 },[active,open,query]);
 const activeOption=options[active];
 function choose(title:string){onChange(title);setOpen(false);setQuery("");}
 return <div ref={wrapperRef} className="min-w-0" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
  <div className="relative min-w-0">
   <Input id={id} role="combobox" name="relationshipLabel" autoComplete="off" maxLength={100} value={value}
    aria-expanded={open} aria-controls={open?`${id}-options`:undefined} aria-autocomplete="list" aria-activedescendant={open&&activeOption?`${id}-option-${active}`:undefined}
    placeholder="選擇稱謂，或輸入關鍵字搜尋" className="pr-12"
    onFocus={()=>{setOpen(true);setQuery("");setActive(0);}}
    onChange={event=>{onChange(event.target.value);setQuery(event.target.value);setActive(0);setOpen(true);}}
    onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
    onKeyDown={event=>{
     if(composing.current||event.nativeEvent.isComposing||event.keyCode===229){if(event.key==="Enter")event.preventDefault();return;}
     if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();if(!open){setOpen(true);setQuery("");setActive(0);}else setActive(index=>Math.max(0,Math.min(options.length-1,index+(event.key==="ArrowDown"?1:-1))));
     }else if(event.key==="Enter"&&open){event.preventDefault();if(activeOption)choose(activeOption.value);else setOpen(false);}
     else if(event.key==="Escape"&&open){event.preventDefault();event.stopPropagation();setOpen(false);}
    }}/>
   <button type="button" aria-label={open?"收合稱謂選單":"展開稱謂選單"} aria-controls={`${id}-options`} aria-expanded={open}
    className="absolute inset-y-0 right-0 flex min-h-11 w-11 items-center justify-center rounded-r-control text-ink-soft"
    onMouseDown={event=>event.preventDefault()} onClick={()=>{if(open)setOpen(false);else{wrapperRef.current?.querySelector("input")?.focus();setQuery("");setActive(0);setOpen(true);}}}>▾</button>
  </div>
  {open?<div className="mt-1 min-w-0 rounded-control border border-line bg-surface shadow-card">
   <ul ref={listRef} id={`${id}-options`} role="listbox" aria-label="親屬稱謂選項" className="max-h-60 overflow-y-auto">
    {options.map((option,index)=><li id={`${id}-option-${index}`} key={option.value} role="option" aria-selected={index===active}
      className={`flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 px-3 py-2 text-sm ${index===active?"bg-clay-soft text-clay-strong":"text-ink hover:bg-surface-sunken"}`}
      onMouseDown={event=>event.preventDefault()} onClick={()=>choose(option.value)}>
      <span>{option.value}{option.aliases?`（${option.aliases}）`:""}</span><span className="text-ink-soft">｜{option.description}</span><span className="text-caption text-ink-faint">{option.group}</span>
    </li>)}
   </ul>
   <p role="status" className="border-t border-line px-3 py-2 text-caption text-ink-soft">{options.length?`找到 ${options.length} 個稱謂；也可直接保留輸入的自訂稱呼。`:"沒有符合的稱謂，將保留你輸入的自訂稱呼。"}</p>
  </div>:null}
 </div>;
}
