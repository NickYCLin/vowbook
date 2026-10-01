import {BUDGET_BALANCE_PAYMENT_METHOD_LABELS,DAY_OF_CASH_PAYMENT_METHODS,formatTwdAmount,type BudgetBalancePaymentMethod} from "./budget-item";
import {effectiveDueDate} from "./budget-due-date";
import {sortWeddingStaff} from "./wedding-staff-order";
import type {WeddingStaffListItem} from "@/lib/wedding-staff-list";
import type {BudgetItemListItem} from "@/lib/budget-list";

type Balance=Pick<BudgetItemListItem,"id"|"name"|"kind"|"preparationStatus"|"bookingStatus"|"paid"|"confirmedVendor"|"vendorContact"|"balanceAmount"|"dueDate"|"defaultDueDate"|"notes"|"additionalAmount">&{balancePaymentMethod?:BudgetBalancePaymentMethod|null;paidAmount?:number;payments?:readonly {amount:number}[]};
type BalanceStaff=Pick<WeddingStaffListItem,"id"|"personName"|"roleName"|"contactPhone"|"notes"|"redEnvelopeAmount"|"redEnvelopeSentAt">&{mealCount?:number|null};

/** 明細每格都是已格式化的字串；空字串表示這一格沒有東西，不印「-」。 */
export type BalanceLine={key:string;name:string;balance:string;additional:string;paid:string;remaining:string;method:string};
export type BalanceVendor={key:string;vendor:string;contact:string;remaining:string;method:string;dueDate:string;lines:BalanceLine[];detailed:boolean;notes:{key:string;label:string;text:string}[]};
/** 工作人員紅包和廠商尾款紅包都在尾款待付清單逐人勾選「已交」，工作人員清單只管便當。 */
export type BalanceStaffEnvelope={key:string;name:string;role:string;amount:string};
export type BalanceStaffEnvelopes={count:number;total:string;people:BalanceStaffEnvelope[]};
export type BalanceSectionId="CASH"|"ADVANCE"|"UNSET";
export type BalanceSection={id:BalanceSectionId;title:string;hint:string;total:string;vendors:BalanceVendor[];staffEnvelopes:BalanceStaffEnvelopes|null};
export type BalanceSheetData={remaining:string;cash:string;prepaid:string;counts:string;warnings:string[];sections:BalanceSection[]};

const ZERO=BigInt(0);
const SECTIONS:Record<BalanceSectionId,{title:string;hint:string}>={
 CASH:{title:"當天備現金",hint:"廠商尾款（預設用現金紅包付）與工作人員紅包：當天交給對方時勾「已交」。"},
 ADVANCE:{title:"事先匯款／刷卡",hint:"請在期限前付清，付款後回網站記錄。"},
 UNSET:{title:"付款方式不一致",hint:"同一家廠商的項目付款方式不同，請和廠商確認後回網站統一。"},
};
/** 尾款預設用現金紅包付：沒設定付款方式就當現金。 */
const effectiveMethod=(method:BudgetBalancePaymentMethod|null|undefined):BudgetBalancePaymentMethod=>method??"CASH";
const methodSection=(method:BudgetBalancePaymentMethod|null|undefined):BalanceSectionId=>DAY_OF_CASH_PAYMENT_METHODS.has(effectiveMethod(method))?"CASH":"ADVANCE";
const money=(amount:bigint)=>formatTwdAmount(Number(amount));
/** 2026-10-01 → 10/01 前；日期格式不對就原樣印出，不猜。 */
export function balanceDueLabel(date:string|null):string {
 if(!date)return "";
 const match=/^\d{4}-(\d{2})-(\d{2})$/u.exec(date);
 return match?`${match[1]}/${match[2]} 前`:date;
}

/** 廠商名稱去掉前後空白後相同就算同一家；沒填廠商的各自一張，避免把不相干的項目併在一起。 */
function groupByVendor<T extends {confirmedVendor:string|null}>(items:readonly T[]):T[][] {
 const groups:T[][]=[];const byVendor=new Map<string,T[]>();
 for(const item of items){
  const vendor=item.confirmedVendor?.trim();
  if(!vendor){groups.push([item]);continue;}
  const group=byVendor.get(vendor);
  if(group){group.push(item);continue;}
  const created=[item];byVendor.set(vendor,created);groups.push(created);
 }
 return groups;
}

function balanceVendors(items:readonly Balance[]) {
 const pending=items.filter(i=>i.kind==="EXPENSE"&&(i.preparationStatus??"NEEDS_ACTION")==="NEEDS_ACTION"&&i.bookingStatus==="BOOKED_BALANCE_DUE"&&!i.paid);
 const paid=(i:Balance)=>BigInt(i.paidAmount??0);
 const unknown=(i:Balance)=>i.balanceAmount===null&&i.additionalAmount===null;
 const due=(i:Balance)=>{const rest=BigInt(i.balanceAmount??0)+BigInt(i.additionalAmount??0)-paid(i);return rest>ZERO?rest:ZERO;};
 const methodLabel=(i:Balance)=>BUDGET_BALANCE_PAYMENT_METHOD_LABELS[effectiveMethod(i.balancePaymentMethod)];

 const vendors=groupByVendor(pending).map(group=>{
  const sections=new Set(group.map(i=>methodSection(i.balancePaymentMethod)));
  const section:BalanceSectionId=sections.size===1?[...sections][0]:"UNSET";
  const methods=new Set(group.map(methodLabel));
  const known=group.filter(i=>!unknown(i));
  const remainingAmount=known.reduce((sum,i)=>sum+due(i),ZERO);
  const missing=group.length-known.length;
  const dueInfo=group.map(i=>effectiveDueDate(i)).filter((d):d is NonNullable<typeof d>=>d!==null).sort((a,b)=>a.date.localeCompare(b.date))[0]??null;
  const lines=group.map<BalanceLine>(i=>({
   key:i.id,name:i.name,
   balance:i.balanceAmount===null?(unknown(i)?"待確認":""):formatTwdAmount(i.balanceAmount),
   additional:i.additionalAmount?formatTwdAmount(i.additionalAmount):"",
   paid:paid(i)>ZERO?`${money(paid(i))}${(i.payments?.length??0)>1?`\n分 ${i.payments!.length} 次`:""}`:"",
   remaining:unknown(i)?"待確認":money(due(i)),
   method:methods.size>1?methodLabel(i):"",
  }));
  const vendor:BalanceVendor&{section:BalanceSectionId;amount:bigint;dueSort:string;missing:number}={
   key:group.length===1?group[0].id:`vendor-${group[0].id}`,
   vendor:group[0].confirmedVendor?.trim()||"廠商待確認",
   contact:[...new Set(group.map(i=>i.vendorContact?.trim()).filter((c):c is string=>!!c))].join("、"),
   remaining:known.length===0?"金額待確認":`${money(remainingAmount)}${missing?`＋${missing} 項待確認`:""}`,
   method:methods.size===1?[...methods][0]:"各項不同",
   dueDate:dueInfo?(dueInfo.reason?`${balanceDueLabel(dueInfo.date).replace(/ 前$/u,"")} ${dueInfo.reason}`:balanceDueLabel(dueInfo.date)):"",
   lines,
   detailed:group.length>1||group.some(i=>i.additionalAmount||paid(i)>ZERO),
   notes:group.filter(i=>i.notes?.trim()).map(i=>({key:i.id,label:group.length>1?i.name:"",text:i.notes!.trim()})),
   section,amount:remainingAmount,dueSort:dueInfo?.date??"9999",missing,
  };
  return vendor;
 });
 return {pending,vendors,paid};
}

/**
 * 尾款待付清單：同一家廠商一張卡、一個勾選框，還要付的金額＝尾款＋加購－已先分批付出的款項。
 * 依付款方式分區，當天要備的現金（含工作人員紅包）一眼就能加總。
 */
export function balanceSheetData(items:readonly Balance[],staff:readonly BalanceStaff[]):BalanceSheetData {
 const {pending,vendors,paid}=balanceVendors(items);
 const envelopes=sortWeddingStaff(staff.filter(p=>p.redEnvelopeAmount!==null&&!p.redEnvelopeSentAt));
 const envelopeTotal=envelopes.reduce((sum,p)=>sum+BigInt(p.redEnvelopeAmount??0),ZERO);
 const sections=(["CASH","ADVANCE","UNSET"] as const).map<BalanceSection>(id=>{
  const own=vendors.filter(v=>v.section===id).sort((a,b)=>a.dueSort.localeCompare(b.dueSort));
  const staffEnvelopes=id==="CASH"&&envelopes.length?{count:envelopes.length,total:money(envelopeTotal),people:envelopes.map(p=>({key:p.id,name:p.personName,role:p.roleName,amount:formatTwdAmount(p.redEnvelopeAmount??0)}))}:null;
  const total=own.reduce((sum,v)=>sum+v.amount,ZERO)+(id==="CASH"?envelopeTotal:ZERO);
  const missing=own.reduce((sum,v)=>sum+v.missing,0);
  return {id,...SECTIONS[id],total:`${money(total)}${missing?`＋${missing} 項待確認`:""}`,
   vendors:own.map(v=>({key:v.key,vendor:v.vendor,contact:v.contact,remaining:v.remaining,method:v.method,dueDate:v.dueDate,lines:v.lines,detailed:v.detailed,notes:v.notes})),staffEnvelopes};
 }).filter(s=>s.vendors.length||s.staffEnvelopes);

 const remaining=vendors.reduce((sum,v)=>sum+v.amount,ZERO)+envelopeTotal;
 const cash=vendors.filter(v=>v.section==="CASH").reduce((sum,v)=>sum+v.amount,ZERO)+envelopeTotal;
 const prepaid=pending.reduce((sum,i)=>sum+paid(i),ZERO);
 const missing=vendors.reduce((sum,v)=>sum+v.missing,0);
 const unset=vendors.filter(v=>v.section==="UNSET").length;
 return {
  remaining:money(remaining),cash:money(cash),prepaid:money(prepaid),
  counts:`${vendors.length} 家廠商${envelopes.length?`・${envelopes.length} 份工作人員紅包`:""}`,
  warnings:[
   ...(missing?[`${missing} 項金額待確認，未算進合計`]:[]),
   ...(unset?[`${unset} 家廠商付款方式不一致`]:[]),
  ],
  sections,
 };
}
