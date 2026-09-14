import {expect,it} from "vitest";
import {staffPrintData,balancePrintData} from "./operations-print";
it("prints meal splits and separate handout checks, preserving already-sent red envelopes",()=>{
 const data=staffPrintData([
  {id:"a",roleName:"接待",personName:"甲",notes:null,mealCount:3,vegetarianMealCount:1,redEnvelopeAmount:1200,redEnvelopeSentAt:null},
  {id:"b",roleName:"主持",personName:"乙",notes:null,mealCount:null,vegetarianMealCount:null,redEnvelopeAmount:2000,redEnvelopeSentAt:new Date()},
 ]);
 expect(data.rows[0].cells).toEqual(["甲","接待","3 份（葷 2／素 1）",{checkLabel:"便當發放勾選框"},"NT$1,200",{checkLabel:"紅包發放勾選框"},""]);
 expect(data.rows[1].cells[5]).toBe("已發放");
 expect(data.summary).toContain("便當 3 份");expect(data.summary).toContain("待發紅包 NT$1,200");
});
it("prints only outstanding arranged expenses using direct recorded balances, never rolled-up totals",()=>{
 const item={id:"a",name:"攝影",kind:"EXPENSE" as const,preparationStatus:"NEEDS_ACTION" as const,bookingStatus:"BOOKED_BALANCE_DUE" as const,paid:false,confirmedVendor:"攝影社",vendorContact:null,balanceAmount:3000,dueDate:null,notes:null,additionalAmount:null};
 const data=balancePrintData([item,{...item,id:"b",name:"造型",balanceAmount:null},{...item,id:"paid",paid:true},{...item,id:"group",kind:"GROUP"},{...item,id:"skip",preparationStatus:"NOT_PLANNED"},{...item,id:"planning",bookingStatus:"PLANNING"}]);
 expect(data.rows).toHaveLength(2);expect(data.summary).toContain("NT$3,000");expect(data.summary).toContain("1 筆金額待確認");
 expect(data.rows[1].cells[2]).toBe("待確認");
});
