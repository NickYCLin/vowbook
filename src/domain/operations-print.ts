import {sortWeddingStaff} from "./wedding-staff-order";
import {summarizeWeddingStaffMeals} from "./wedding-staff";
import type {WeddingStaffListItem} from "@/lib/wedding-staff-list";
export type PrintCell=string|{checkLabel:string};
export type OperationsPrintData={summary:string;columns:{label:string;width:number}[];rows:{key:string;cells:PrintCell[]}[]};
type Staff=Pick<WeddingStaffListItem,"id"|"personName"|"roleName"|"notes"|"mealCount"|"vegetarianMealCount">&{redEnvelopeAmount?:number|null};
/**
 * 工作人員便當發放清單：只列需要便當的人，當天逐人勾選。
 * 紅包（工作人員與廠商尾款）統一在尾款待付清單勾選，避免兩張紙重複勾。
 */
export function staffPrintData(staff:readonly Staff[]):OperationsPrintData {
 const meals=summarizeWeddingStaffMeals(staff);
 const needMeals=sortWeddingStaff(staff).filter(p=>(p.mealCount??0)>0);
 const skipped=staff.length-needMeals.length;
 return {
  summary:`便當 ${meals.mealCount} 份（葷 ${meals.nonVegetarianMealCount}／素 ${meals.vegetarianMealCount}）・${needMeals.length} 筆工作安排${skipped?`（另有 ${skipped} 筆不需要便當，未列出）`:""}`,
  columns:[{label:"姓名",width:20},{label:"工作／職務",width:20},{label:"便當份數",width:22},{label:"便當發放",width:12},{label:"備註",width:26}],
  rows:needMeals.map(p=>({key:p.id,cells:[p.personName,p.roleName,`${p.mealCount} 份（葷 ${p.mealCount!-(p.vegetarianMealCount??0)}／素 ${p.vegetarianMealCount??0}）`,{checkLabel:"便當發放勾選框"},p.notes??""]})),
 };
}
