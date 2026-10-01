import {expect,it} from "vitest";
import {balanceDueLabel,balanceSheetData} from "./balance-print";

const item={id:"a",name:"宴客場地",kind:"EXPENSE" as const,preparationStatus:"NEEDS_ACTION" as const,bookingStatus:"BOOKED_BALANCE_DUE" as const,paid:false,confirmedVendor:"萊特薇庭",vendorContact:"02-1234",balanceAmount:200000,dueDate:"2026-10-20",notes:null,additionalAmount:15000,balancePaymentMethod:"BANK_TRANSFER" as const};
const staffBase={notes:null,contactPhone:null};

it("merges one vendor into one card whose amount includes add-ons minus prepayments",()=>{
 const data=balanceSheetData([
  {...item,paidAmount:100000,payments:[{amount:60000},{amount:40000}]},
  {...item,id:"b",name:"證婚",confirmedVendor:" 萊特薇庭 ",balanceAmount:30000,additionalAmount:null,dueDate:"2026-10-01",notes:"含佈置"},
 ],[]);
 const vendor=data.sections[0].vendors[0];
 expect(data.sections.map(s=>s.id)).toEqual(["ADVANCE"]);
 expect(vendor.remaining).toBe("NT$145,000");
 expect(vendor.dueDate).toBe("10/01 前");
 expect(vendor.detailed).toBe(true);
 expect(vendor.lines[0]).toMatchObject({balance:"NT$200,000",additional:"NT$15,000",paid:"NT$100,000\n分 2 次",remaining:"NT$115,000"});
 expect(vendor.notes).toEqual([{key:"b",label:"證婚",text:"含佈置"}]);
 expect(data.prepaid).toBe("NT$100,000");
 expect(data.remaining).toBe("NT$145,000");
});

it("splits sections by payment method and counts unsent staff envelopes as day-of cash",()=>{
 const data=balanceSheetData([
  {...item,confirmedVendor:"會館",balanceAmount:3000,additionalAmount:null,dueDate:null},
  {...item,id:"b",confirmedVendor:"新秘",balanceAmount:8000,additionalAmount:null,balancePaymentMethod:"RED_ENVELOPE"},
  {...item,id:"c",confirmedVendor:"樂團",balanceAmount:null,additionalAmount:null,balancePaymentMethod:"CASH"},
  {...item,id:"d",confirmedVendor:"花藝",balanceAmount:500,additionalAmount:null,balancePaymentMethod:null},
 ],[
  {...staffBase,id:"s1",roleName:"主持",personName:"乙",redEnvelopeAmount:2000,redEnvelopeSentAt:null},
  {...staffBase,id:"s2",roleName:"接待",personName:"丙",redEnvelopeAmount:1200,redEnvelopeSentAt:new Date()},
 ]);
 expect(data.sections.map(s=>s.id)).toEqual(["CASH","ADVANCE"]);
 expect(data.cash).toBe("NT$10,500");
 expect(data.sections[0].total).toBe("NT$10,500＋1 項待確認");
 expect(data.sections[0].staffEnvelopes).toEqual({count:1,total:"NT$2,000",people:[{key:"s1",name:"乙",role:"主持",amount:"NT$2,000"}]});
 expect(data.sections[1].staffEnvelopes).toBeNull();
 expect(data.remaining).toBe("NT$13,500");
 expect(data.warnings).toEqual(["1 項金額待確認，未算進合計"]);
});

it("skips paid, income, not-planned and still-planning items and never goes below zero",()=>{
 const data=balanceSheetData([
  {...item,paid:true},
  {...item,id:"b",kind:"GROUP" as never},
  {...item,id:"c",preparationStatus:"NOT_PLANNED" as never},
  {...item,id:"d",bookingStatus:"PLANNING" as never},
  {...item,id:"e",confirmedVendor:"攝影",balanceAmount:1000,additionalAmount:null,paidAmount:5000},
 ],[]);
 expect(data.counts).toBe("1 家廠商");
 expect(data.remaining).toBe("NT$0");
});

it("formats due dates without guessing malformed values",()=>{
 expect(balanceDueLabel("2026-10-01")).toBe("10/01 前");
 expect(balanceDueLabel(null)).toBe("");
 expect(balanceDueLabel("10月初")).toBe("10月初");
});

it("treats an unset balance payment method as day-of cash and only flags mixed vendors",()=>{
 const data=balanceSheetData([
  {...item,id:"a",confirmedVendor:"花藝",balanceAmount:500,additionalAmount:null,balancePaymentMethod:null},
  {...item,id:"b",confirmedVendor:"樂團",balanceAmount:800,additionalAmount:null,balancePaymentMethod:"CASH"},
  {...item,id:"c",confirmedVendor:"樂團",balanceAmount:100,additionalAmount:null,balancePaymentMethod:"BANK_TRANSFER"},
 ],[]);
 expect(data.sections.map(s=>[s.id,s.title])).toEqual([["CASH","當天備現金"],["UNSET","付款方式不一致"]]);
 expect(data.sections[0].vendors[0].method).toBe("現金紅包");
 expect(data.cash).toBe("NT$500");
 expect(data.warnings).toEqual(["1 家廠商付款方式不一致"]);
});

it("lists each unsent staff envelope in helper-first order for per-person checks",()=>{
 const data=balanceSheetData([],[
  {...staffBase,id:"s1",roleName:"主持人",personName:"Wish",redEnvelopeAmount:3000,redEnvelopeSentAt:null},
  {...staffBase,id:"s2",roleName:"招待",personName:"丙",redEnvelopeAmount:1200,redEnvelopeSentAt:null},
  {...staffBase,id:"s3",roleName:"收禮",personName:"丁",redEnvelopeAmount:null,redEnvelopeSentAt:null},
 ]);
 expect(data.sections.map(s=>s.id)).toEqual(["CASH"]);
 expect(data.sections[0].staffEnvelopes?.people.map(p=>p.name)).toEqual(["丙","Wish"]);
 expect(data.cash).toBe("NT$4,200");
});
it("uses the default due date when none is filled",()=>{
 const data=balanceSheetData([
  {...item,id:"a",confirmedVendor:"會館",dueDate:null,defaultDueDate:{date:"2026-11-08",reason:"婚禮當天"},balancePaymentMethod:"CASH"},
  {...item,id:"b",confirmedVendor:"禮服",dueDate:null,defaultDueDate:{date:"2026-11-07",reason:"領禮服當天"},balancePaymentMethod:"CASH"},
 ],[]);
 expect(data.sections[0].vendors.map(v=>[v.vendor,v.dueDate])).toEqual([["禮服","11/07 領禮服當天"],["會館","11/08 婚禮當天"]]);
});
