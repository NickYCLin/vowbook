import {expect,it} from "vitest";
import {staffPrintData} from "./operations-print";
const base={notes:null,mealCount:null,vegetarianMealCount:null,redEnvelopeAmount:null};
it("prints only people who need meals with a meal check and no red envelope columns",()=>{
 const data=staffPrintData([
  {...base,id:"a",roleName:"接待",personName:"甲",mealCount:3,vegetarianMealCount:1,redEnvelopeAmount:1200},
  {...base,id:"b",roleName:"主持",personName:"乙",redEnvelopeAmount:2000},
 ]);
 expect(data.columns.map(c=>c.label)).toEqual(["姓名","工作／職務","便當份數","便當發放","備註"]);
 expect(data.rows.map(r=>r.cells)).toEqual([["甲","接待","3 份（葷 2／素 1）",{checkLabel:"便當發放勾選框"},""]]);
 expect(data.summary).toBe("便當 3 份（葷 2／素 1）・1 筆工作安排（另有 1 筆不需要便當，未列出）");
});
it("uses the same helper-first order in the printed meal list",()=>{
 const data=staffPrintData(["拍拍印","收禮","主持人","招待","總招"].map(roleName=>({...base,id:roleName,roleName,personName:roleName,mealCount:1,redEnvelopeAmount:1000})));
 expect(data.rows.map(row=>row.cells[1])).toEqual(["總招","招待","收禮","主持人","拍拍印"]);
});
