import {expect,it} from "vitest";
import {giftPrintRows} from "./wedding-gift-print";
import type {CakeGuest} from "./wedding-cake";
const guest=(id:string,extra:Partial<CakeGuest>&{giftExemptWithCake?:boolean}={})=>({id,name:id,category:"GUEST" as const,side:"PARTNER_A" as const,seniority:"PEER" as const,attendanceStatus:"ATTENDING",checkedIn:false,relationshipLabel:null,cakeHouseholdId:null,...extra});
it("uses the same household, includes gift-only guests, and excludes newlyweds",()=>{
 const rows=giftPrintRows([guest("a",{cakeHouseholdId:"h"}),guest("b",{cakeHouseholdId:"h",attendanceStatus:"DECLINED"}),guest("c",{attendanceStatus:"UNDECIDED"}),guest("groom",{category:"COUPLE"})]);
 expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({key:"household:h",names:"a、b",group:"GROOM_FRIENDS"});
 expect(rows.flatMap(row=>row.names)).not.toContain("groom");
 expect(rows.every(row=>!("amount" in row))).toBe(true);
});
it("marks exempt households and retains individual exemptions in a mixed household",()=>{
 const rows=giftPrintRows([guest("a",{giftExemptWithCake:true}),guest("b",{cakeHouseholdId:"h",giftExemptWithCake:true}),guest("c",{cakeHouseholdId:"h"})]);
 expect(rows.find(row=>row.key==="guest:a")).toMatchObject({exempt:true,notes:"不收禮金、會送餅"});
 expect(rows.find(row=>row.key==="household:h")).toMatchObject({exempt:false,notes:"b：不收禮金、會送餅"});
});
