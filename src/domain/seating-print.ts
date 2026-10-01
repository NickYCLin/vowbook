import {seatingTableLabel} from "./seating-table";
import {compareGuestsBySeniorityThenSurnameStroke,type GuestSeniorityValue} from "./guest";
import {familyRelationshipRank} from "./family-relationship";
type Guest={id:string;name:string;partySize:number;category?:string|null;seniority?:GuestSeniorityValue|null;vegetarianCount?:number|null;childSeatCount?:number|null};
type Table={id:string;number:number;name:string;capacity:number;guests:readonly Guest[]};
export type SeatingPrintGuest={key:string;name:string;partySize:number;needs:string};
/**
 * 同一戶通常一起到，同桌的同戶成員列在一起；沒設定同一戶的人各自一組。
 * 同一戶分坐不同桌時，以「這一桌的這一戶」為一組，elsewhere 提醒招待其他人要帶到哪一桌。
 * 新人本人照樣列出座位，但不併進家人那一戶。
 * 每桌順序比照賓客名單：新人、家人（依稱謂）、一般賓客（依輩份、姓氏筆劃）。
 */
export type SeatingPrintParty={key:string;guests:SeatingPrintGuest[];elsewhere:string};
export type SeatingPrintGroup={key:string;title:string;meta:string;assigned:boolean;full:boolean;parties:SeatingPrintParty[]};
export type SeatingPrintDetails={relationships:ReadonlyMap<string,string>;households:ReadonlyMap<string,string>};
/** 帶位名單要能一張 A4 印完：只印有人的桌；尚未排桌的人數只在畫面上提醒。 */
export type SeatingPrintData={summary:string;unassigned:number;groups:SeatingPrintGroup[]};
/** 「男方親友」這類只講側別的稱謂在帶位時沒有資訊，留白。 */
const SIDE_ONLY=/^(新郎|新娘|男方|女方|共同)(親友)?$/;
export function seatingRelationship(label:string|null|undefined):string {const title=label?.trim()??"";return SIDE_ONLY.test(title)?"":title;}
const heads=(guests:readonly Guest[])=>guests.reduce((sum,g)=>sum+g.partySize,0);
/** 帶位時只需要看「這桌坐誰、幾位、有沒有特殊需求」，未填或 0 就留白，避免滿版的「-」。 */
export function seatingGuestNeeds(g:Pick<Guest,"vegetarianCount"|"childSeatCount">):string {
 const needs:string[]=[];
 if(g.vegetarianCount!=null&&g.vegetarianCount>0)needs.push(`素 ${g.vegetarianCount}`);
 if(g.childSeatCount!=null&&g.childSeatCount>0)needs.push(`兒童椅 ${g.childSeatCount}`);
 return needs.join("・");
}
/** details 為 null 表示目前成員無權讀取賓客明細：不合併同一戶，家人也不依稱謂排序。 */
export function seatingPrintData(tables:readonly Table[],unassigned:readonly Guest[],details:SeatingPrintDetails|null=null):SeatingPrintData {
 const guest=(prefix:string)=>(g:Guest):SeatingPrintGuest=>({key:`${prefix}:guest:${g.id}`,name:g.name,partySize:g.partySize,needs:seatingGuestNeeds(g)});
 const sortedTables=[...tables].sort((a,b)=>a.number-b.number);
 const members=new Map<string,{id:string;name:string;place:string}[]>();
 const place=(table:Table|null)=>table?`${table.number} 號桌`:"尚未排桌";
 for(const [table,guests] of [...sortedTables.map(t=>[t,t.guests] as const),[null,unassigned] as const])for(const g of guests){
  const household=details?.households.get(g.id);
  if(household)members.set(household,[...(members.get(household)??[]),{id:g.id,name:g.name,place:place(table)}]);
 }
 const categoryRank=(g:Guest)=>g.category==="COUPLE"?0:g.category==="FAMILY"?1:2;
 const sortable=(g:Guest)=>({id:g.id,name:g.name,seniority:g.seniority??"UNSPECIFIED"});
 const byGuestList=(a:Guest,b:Guest)=>categoryRank(a)-categoryRank(b)
  ||(a.category==="FAMILY"&&b.category==="FAMILY"?familyRelationshipRank(details?.relationships.get(a.id))-familyRelationshipRank(details?.relationships.get(b.id)):0)
  ||compareGuestsBySeniorityThenSurnameStroke(sortable(a),sortable(b));
 const parties=(prefix:string,table:Table|null,guests:readonly Guest[]):SeatingPrintParty[]=>{
  const byKey=new Map<string,SeatingPrintParty&{household?:string}>();
  for(const g of [...guests].sort(byGuestList)){
   const household=g.category==="COUPLE"?undefined:details?.households.get(g.id);
   const key=household?`${prefix}:household:${household}`:`${prefix}:guest:${g.id}`;
   const party=byKey.get(key)??{key,guests:[],elsewhere:"",household};
   party.guests.push(guest(prefix)(g));byKey.set(key,party);
  }
  return [...byKey.values()].map(({household,...party})=>{
   const others=household?(members.get(household)??[]).filter(m=>m.place!==place(table)):[];
   const byPlace=new Map<string,string[]>();for(const m of others)byPlace.set(m.place,[...(byPlace.get(m.place)??[]),m.name]);
   return {...party,elsewhere:others.length?`同戶另有：${[...byPlace].map(([at,names])=>`${at} ${names.join("、")}`).join("；")}`:""};
  });
 };
 const seated=sortedTables.filter(table=>table.guests.length>0);
 const groups:SeatingPrintGroup[]=seated.map(table=>{
  const count=heads(table.guests);
  return {key:`table:${table.id}`,title:seatingTableLabel(table),meta:`${count}／${table.capacity} 位`,assigned:true,full:count>=table.capacity,parties:parties(`table:${table.id}`,table,table.guests)};
 });
 return {unassigned:heads(unassigned),summary:`${seated.length} 桌 · ${seated.reduce((sum,t)=>sum+heads(t.guests),0)} 位`,groups};
}
