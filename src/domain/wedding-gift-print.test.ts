import {expect,it} from "vitest";
import {giftPrintRows} from "./wedding-gift-print";
import {cakeRows,type CakeGuest} from "./wedding-cake";
const guest=(id:string,extra:Partial<CakeGuest>&{giftExemptWithCake?:boolean;giftReceived?:boolean}={})=>({id,name:id,category:"GUEST" as const,side:"PARTNER_A" as const,seniority:"PEER" as const,attendanceStatus:"ATTENDING",checkedIn:false,relationshipLabel:null,cakeHouseholdId:null,...extra});
it("uses the same household, includes gift-only guests, and excludes newlyweds",()=>{
 const rows=giftPrintRows([guest("a",{cakeHouseholdId:"h"}),guest("b",{cakeHouseholdId:"h",attendanceStatus:"DECLINED"}),guest("c",{attendanceStatus:"UNDECIDED"}),guest("groom",{category:"COUPLE"})]);
 expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({key:"household:h",names:"a、b",group:"GROOM_FRIENDS"});
 expect(rows.flatMap(row=>row.names)).not.toContain("groom");
 expect(rows.every(row=>!("amount" in row))).toBe(true);
});
it("excludes selected guests from gift printing but keeps them in the cake household",()=>{
 const guests=[guest("a",{giftExemptWithCake:true}),guest("b",{cakeHouseholdId:"h",giftExemptWithCake:true}),guest("c",{cakeHouseholdId:"h"})];
 const rows=giftPrintRows(guests);
 expect(rows).toHaveLength(1);
 expect(rows[0]).toMatchObject({key:"household:h",names:"c",notes:""});
 expect(rows[0].relationships).not.toContain("b：");
 expect(cakeRows(guests,[{id:"h",boxes:1}]).map(row=>row.names)).toEqual(["a","b、c"]);
 expect(giftPrintRows(guests.map(g=>({...g,giftExemptWithCake:true})))).toEqual([]);
 expect(giftPrintRows(guests.map(g=>({...g,giftExemptWithCake:false})))).toHaveLength(2);
});
it.each(["PARTNER_A","PARTNER_B"] as const)("excludes parents and siblings on %s, including catalog aliases",side=>{
 const labels=["父親","爸爸","母親","媽媽","哥哥","兄長","弟弟","姊姊","姐姐","妹妹"];
 expect(giftPrintRows(labels.map((relationshipLabel,i)=>guest(String(i),{side,relationshipLabel})))).toEqual([]);
});
it("retains other household members, classification and exemptions after excluding immediate family",()=>{
 const rows=giftPrintRows([
  guest("parent",{relationshipLabel:"父親",cakeHouseholdId:"h"}),
  guest("relative",{relationshipLabel:"表姊",side:"PARTNER_B",cakeHouseholdId:"h"}),
  guest("sibling",{relationshipLabel:"妹妹",cakeHouseholdId:"only"}),
  guest("cousin",{relationshipLabel:"堂兄"}),guest("inlaw",{relationshipLabel:"姊夫"}),guest("unknown"),
 ]);
 expect(rows).toHaveLength(4);
 expect(rows.find(r=>r.key==="household:h")).toMatchObject({group:"SHARED",names:"relative",exempt:false,notes:""});
 expect(rows.some(r=>r.key==="household:only")).toBe(false);
 expect(rows.map(r=>r.names)).toEqual(expect.arrayContaining(["cousin","inlaw","unknown"]));
});

it("marks a household received once without exposing amounts, and leaves unrecorded households blank",()=>{
 const rows=giftPrintRows([guest("a",{cakeHouseholdId:"h",giftReceived:true}),guest("b",{cakeHouseholdId:"h",giftReceived:true}),guest("c")]);
 expect(rows).toHaveLength(2);
 expect(rows.find(r=>r.key==="household:h")).toMatchObject({giftReceived:true});
 expect(rows.find(r=>r.key==="guest:c")).toMatchObject({giftReceived:false});
 expect(rows.every(r=>!("amount" in r))).toBe(true);
});
