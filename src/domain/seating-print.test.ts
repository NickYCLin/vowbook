import {expect,it} from "vitest";
import {seatingPrintData} from "./seating-print";
const guest={id:"g",name:"親友一家",partySize:3,side:"PARTNER_A" as const,vegetarianCount:1,childSeatCount:1,notes:null};
it("uses existing table numbers, party sizes and dietary requirements with a leading check",()=>{
 const data=seatingPrintData([{id:"t",number:5,name:"親友桌",capacity:10,guests:[guest]}],[]);
 expect(data.summary).toContain("已排 3 位");
 expect(data.rows[0].cells).toEqual(["5 號桌 親友桌\n3／10 位","親友一家","男方親友","3","素 1 位","1 張",{checkLabel:"帶位完成勾選框"},""]);
});
it("keeps empty tables and lists unassigned guests last without implying they have seats",()=>{
 const data=seatingPrintData([{id:"b",number:3,name:"預備桌",capacity:10,guests:[]},{id:"a",number:1,name:"主桌",capacity:12,guests:[guest]}],[{...guest,id:"u",name:"未排親友",partySize:2,childSeatCount:null}]);
 expect(data.rows.map(r=>r.key)).toEqual(["table:a:guest:g","table:b:empty","unassigned:u"]);
 expect(data.rows[2].cells[0]).toBe("尚未排桌");expect(data.rows[2].cells[6]).toBe("待安排");
 expect(data.summary).toContain("未排 2 位");
});
