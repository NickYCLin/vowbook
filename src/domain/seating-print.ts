import {GUEST_SIDE_LABELS,type GuestSideValue} from "./guest";
import {seatingTableLabel} from "./seating-table";
import type {OperationsPrintData,PrintCell} from "./operations-print";
type Guest={id:string;name:string;partySize:number;side:GuestSideValue;vegetarianCount?:number|null;childSeatCount?:number|null;notes?:string|null};
type Table={id:string;number:number;name:string;capacity:number;guests:readonly Guest[]};
export function seatingPrintData(tables:readonly Table[],unassigned:readonly Guest[]):OperationsPrintData {
 const rows:OperationsPrintData["rows"]=[];
 const cells=(label:string,g:Guest,assigned:boolean):PrintCell[]=>[label,g.name,GUEST_SIDE_LABELS[g.side],String(g.partySize),g.vegetarianCount==null?"未填":g.vegetarianCount>0?`素 ${g.vegetarianCount} 位`:"—",g.childSeatCount==null?"未填":g.childSeatCount>0?`${g.childSeatCount} 張`:"—",assigned?{checkLabel:"帶位完成勾選框"}:"待安排",g.notes??""];
 for(const table of [...tables].sort((a,b)=>a.number-b.number)) {
  const count=table.guests.reduce((sum,g)=>sum+g.partySize,0);
  const label=`${seatingTableLabel(table)}\n${count}／${table.capacity} 位`;
  for(const g of table.guests)rows.push({key:`table:${table.id}:guest:${g.id}`,cells:cells(label,g,true)});
  if(!table.guests.length)rows.push({key:`table:${table.id}:empty`,cells:[label,"尚未安排賓客","—","0","—","—","—",""]});
 }
 for(const g of unassigned)rows.push({key:`unassigned:${g.id}`,cells:cells("尚未排桌",g,false)});
 return {
  summary:`${tables.length} 桌 · 已排 ${tables.reduce((sum,t)=>sum+t.guests.reduce((n,g)=>n+g.partySize,0),0)} 位 · 未排 ${unassigned.reduce((sum,g)=>sum+g.partySize,0)} 位`,
  columns:[{label:"桌號／桌名",width:20},{label:"賓客姓名",width:22},{label:"所屬親友",width:9},{label:"人數",width:8},{label:"素食",width:10},{label:"兒童椅",width:9},{label:"帶位勾選",width:10},{label:"備註",width:12}],rows,
 };
}
