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
it.each(["PARTNER_A","PARTNER_B"] as const)("excludes parents and siblings on %s, including catalog aliases",side=>{
 const labels=["父親","爸爸","母親","媽媽","哥哥","兄長","弟弟","姊姊","姐姐","妹妹"];
 expect(giftPrintRows(labels.map((relationshipLabel,i)=>guest(String(i),{side,relationshipLabel})))).toEqual([]);
});
it("retains other household members, classification and exemptions after excluding immediate family",()=>{
 const rows=giftPrintRows([
  guest("parent",{relationshipLabel:"父親",cakeHouseholdId:"h"}),
  guest("relative",{relationshipLabel:"表姊",side:"PARTNER_B",cakeHouseholdId:"h",giftExemptWithCake:true}),
  guest("sibling",{relationshipLabel:"妹妹",cakeHouseholdId:"only"}),
  guest("cousin",{relationshipLabel:"堂兄"}),guest("inlaw",{relationshipLabel:"姊夫"}),guest("unknown"),
 ]);
 expect(rows).toHaveLength(4);
 expect(rows.find(r=>r.key==="household:h")).toMatchObject({group:"SHARED",names:"relative",exempt:true,notes:"不收禮金、會送餅"});
 expect(rows.some(r=>r.key==="household:only")).toBe(false);
 expect(rows.map(r=>r.names)).toEqual(expect.arrayContaining(["cousin","inlaw","unknown"]));
});
