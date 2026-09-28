import {sortWeddingStaff} from "./wedding-staff-order";
import {BUDGET_BALANCE_PAYMENT_METHOD_LABELS,DAY_OF_CASH_PAYMENT_METHODS,formatTwdAmount,type BudgetBalancePaymentMethod} from "./budget-item";
import {summarizeWeddingStaffMeals,summarizeWeddingStaffRedEnvelopes} from "./wedding-staff";
import type {WeddingStaffListItem} from "@/lib/wedding-staff-list";
import type {BudgetItemListItem} from "@/lib/budget-list";
export type PrintCell=string|{checkLabel:string};
export type OperationsPrintData={summary:string;columns:{label:string;width:number}[];rows:{key:string;cells:PrintCell[]}[]};
type Staff=Pick<WeddingStaffListItem,"id"|"personName"|"roleName"|"notes"|"mealCount"|"vegetarianMealCount"|"redEnvelopeAmount"|"redEnvelopeSentAt">;
export function staffPrintData(staff:readonly Staff[]):OperationsPrintData {
 const meals=summarizeWeddingStaffMeals(staff);const envelopes=summarizeWeddingStaffRedEnvelopes(staff);
 return {
  summary:`${staff.length} 筆工作安排 · 便當 ${meals.mealCount} 份（葷 ${meals.nonVegetarianMealCount}／素 ${meals.vegetarianMealCount}） · 待發紅包 ${formatTwdAmount(envelopes.pendingAmount)}`,
  columns:[{label:"姓名",width:14},{label:"工作／職務",width:16},{label:"便當份數",width:20},{label:"便當發放",width:10},{label:"紅包金額",width:14},{label:"紅包發放",width:10},{label:"備註",width:16}],
  rows:sortWeddingStaff(staff).map(p=>({key:p.id,cells:[p.personName,p.roleName,p.mealCount===null?"不需要便當":`${p.mealCount} 份（葷 ${p.mealCount-(p.vegetarianMealCount??0)}／素 ${p.vegetarianMealCount??0}）`,p.mealCount?{checkLabel:"便當發放勾選框"}:"—",p.redEnvelopeAmount===null?"不發紅包":formatTwdAmount(p.redEnvelopeAmount),p.redEnvelopeAmount===null?"—":p.redEnvelopeSentAt?"已發放":{checkLabel:"紅包發放勾選框"},p.notes??""]})),
 };
}
type Balance=Pick<BudgetItemListItem,"id"|"name"|"kind"|"preparationStatus"|"bookingStatus"|"paid"|"confirmedVendor"|"vendorContact"|"balanceAmount"|"dueDate"|"notes"|"additionalAmount">&{balancePaymentMethod?:BudgetBalancePaymentMethod|null};
type BalanceStaff=Pick<WeddingStaffListItem,"id"|"personName"|"roleName"|"contactPhone"|"notes"|"redEnvelopeAmount"|"redEnvelopeSentAt">;
/** 還沒發出去的紅包跟廠商尾款一樣是當天要掏出去的錢，不列進去就會少估。 */
export function balancePrintData(items:readonly Balance[],staff:readonly BalanceStaff[]):OperationsPrintData {
 const pending=items.filter(i=>i.kind==="EXPENSE"&&(i.preparationStatus??"NEEDS_ACTION")==="NEEDS_ACTION"&&i.bookingStatus==="BOOKED_BALANCE_DUE"&&!i.paid);
 const envelopes=sortWeddingStaff(staff).filter(p=>p.redEnvelopeAmount!==null&&!p.redEnvelopeSentAt);
 // 加購多半是當天連尾款一起結，所以金額直接合併，另外標出組成方便對帳。
 const due=(i:Balance)=>BigInt(i.balanceAmount??0)+BigInt(i.additionalAmount??0);
 const unknownAmount=(i:Balance)=>i.balanceAmount===null&&i.additionalAmount===null;
 const dueCell=(i:Balance)=>{
  if(unknownAmount(i))return "待確認";
  const amount=formatTwdAmount(Number(due(i)));
  if(!i.additionalAmount)return amount;
  return i.balanceAmount===null?`${amount}\n全為加購`
   :`${amount}\n尾款 ${formatTwdAmount(i.balanceAmount)}＋加購 ${formatTwdAmount(i.additionalAmount)}`;
 };
 const total=pending.reduce((sum,i)=>sum+due(i),BigInt(0))
  +envelopes.reduce((sum,p)=>sum+BigInt(p.redEnvelopeAmount??0),BigInt(0));
 const missing=pending.filter(unknownAmount).length;
 const isDayOfCash=(i:Balance)=>i.balancePaymentMethod!=null&&DAY_OF_CASH_PAYMENT_METHODS.has(i.balancePaymentMethod);
 const cashItems=pending.filter(isDayOfCash);
 const cashTotal=cashItems.reduce((sum,i)=>sum+due(i),BigInt(0))
  +envelopes.reduce((sum,p)=>sum+BigInt(p.redEnvelopeAmount??0),BigInt(0));
 const cashMissing=cashItems.filter(unknownAmount).length;
 const methodLabel=(i:Balance)=>i.balancePaymentMethod?BUDGET_BALANCE_PAYMENT_METHOD_LABELS[i.balancePaymentMethod]+(isDayOfCash(i)?"\n當天備現金":""):"未設定";
 return {
  summary:`${pending.length+envelopes.length} 筆尾款待付 · 已登記尾款合計 ${formatTwdAmount(total)}${missing?` · ${missing} 筆金額待確認`:""} · 當天需備現金 ${formatTwdAmount(cashTotal)}${cashMissing?`（${cashMissing} 筆現金金額待確認）`:""}`,
  columns:[{label:"項目／廠商",width:22},{label:"聯絡資訊",width:17},{label:"尾款金額",width:12},{label:"付款方式",width:12},{label:"付款期限",width:11},{label:"付款勾選",width:9},{label:"備註",width:17}],
  rows:[
   ...pending.map(i=>({key:i.id,cells:[`${i.name}\n${i.confirmedVendor||"廠商待確認"}`,i.vendorContact??"",dueCell(i),methodLabel(i),i.dueDate??"未設定",{checkLabel:"尾款付款勾選框"},i.notes??""] as PrintCell[]})),
   ...envelopes.map(p=>({key:`staff-${p.id}`,cells:[`工作人員紅包\n${p.personName}（${p.roleName}）`,p.contactPhone??"",formatTwdAmount(p.redEnvelopeAmount??0),"現金紅包\n當天備現金","婚禮當天",{checkLabel:"紅包發放勾選框"},p.notes??""] as PrintCell[]})),
  ],
 };
}
