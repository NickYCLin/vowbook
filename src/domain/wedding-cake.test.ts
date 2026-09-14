import { describe, expect, it } from "vitest";
import { cakeRows, cakeRowGroups, normalizeCakeHousehold } from "./wedding-cake";
const guest = (id: string, extra = {}) => ({ id, category: "GUEST" as const, name: id, seniority: "PEER" as const, side: "PARTNER_A" as const, attendanceStatus: "ATTENDING", checkedIn: false, relationshipLabel: "表姊", cakeHouseholdId: null as string | null, ...extra });
describe("cake distribution", () => {
  it("counts a household once, excludes absent members and never multiplies party size", () => {
    const rows = cakeRows([guest("a", { cakeHouseholdId: "h", partySize: 4 }), guest("b", { cakeHouseholdId: "h" }), guest("c", { cakeHouseholdId: "h", attendanceStatus: "DECLINED" }), guest("d", { partySize: 3 }), guest("e", { attendanceStatus: "UNDECIDED" })], [{id:"h", boxes:1}]);
    expect(rows.map(r => [r.names, r.boxes])).toEqual([["a、b",1],["d",1]]);
    expect(rows[0].relationships).toBe("a：新郎的表姊；b：新郎的表姊");
  });
  it("distinguishes both partners' fathers in a shared household", () => {
    const rows = cakeRows([guest("a", { relationshipLabel: "父親", cakeHouseholdId: "h" }), guest("b", { side: "PARTNER_B", relationshipLabel: "父親", cakeHouseholdId: "h" })], [{id:"h", boxes:1}]);
    expect(rows[0].relationships).toBe("a：新郎的父親；b：新娘的父親");
    expect(rows[0].boxes).toBe(1);
  });
  it("keeps shared relationships neutral and makes missing titles explicit", () => {
    const rows = cakeRows([guest("a", { side: "SHARED", relationshipLabel: "朋友" }), guest("b", { side: "PARTNER_B", relationshipLabel: null }), guest("c", { relationshipLabel: "二舅" })], []);
    expect(rows.map(row => row.relationships)).toEqual(["c：新郎的二舅", "b：新娘親友（稱謂未填）", "a：共同親友：朋友"]);
  });
  it("includes checked-in guests and respects custom household box counts", () => {
    expect(cakeRows([guest("a", { checkedIn:true, attendanceStatus:"DECLINED", cakeHouseholdId:"h" })], [{id:"h",boxes:2}])[0].boxes).toBe(2);
    expect(cakeRows([guest("a", { attendanceStatus:"DECLINED", cakeHouseholdId:"h" })], [{id:"h",boxes:2}])).toEqual([]);
  });
  it("validates household members and whole box counts", () => {
    const data = new FormData(); data.set("name","林家"); data.set("boxes","1"); data.append("guestId","a");
    expect(normalizeCakeHousehold(data)).toEqual({name:"林家", boxes:1, guestIds:["a"]});
    data.set("boxes","1.5"); expect(() => normalizeCakeHousehold(data)).toThrow();
    data.set("boxes","1"); data.delete("guestId"); expect(() => normalizeCakeHousehold(data)).toThrow();
  });
});

it("excludes both newlyweds even when attending, checked in, or in a household", () => {
 const rows = cakeRows([
  guest("groom",{category:"COUPLE",cakeHouseholdId:"couple"}),
  guest("bride",{category:"COUPLE",side:"PARTNER_B",checkedIn:true,cakeHouseholdId:"mixed"}),
  guest("parent",{category:"FAMILY",cakeHouseholdId:"mixed"}),
 ],[{id:"couple",boxes:2},{id:"mixed",boxes:1}]);
 expect(rows).toHaveLength(1);
 expect(rows[0]).toMatchObject({names:"parent",boxes:1});
 expect(cakeRows([guest("groom",{category:"COUPLE",checkedIn:true})],[])).toEqual([]);
});


it("groups the four partner categories in the requested order, then shared guests",()=>{
 const rows=cakeRows([
  guest("bf",{side:"PARTNER_B",relationshipLabel:"同學"}),
  guest("br",{side:"PARTNER_B",category:"FAMILY",relationshipLabel:"二阿姨"}),
  guest("gf",{relationshipLabel:"朋友"}),
  guest("gr",{relationshipLabel:"伯父"}),
  guest("shared",{side:"SHARED",relationshipLabel:null}),
 ],[]);
 expect(rows.map(row=>row.group)).toEqual(["GROOM_FAMILY","GROOM_FRIENDS","BRIDE_FAMILY","BRIDE_FRIENDS","SHARED"]);
 expect(cakeRowGroups(rows).map(group=>group.label)).toEqual(["新郎的親戚家人","新郎的朋友","新娘的親戚家人","新娘的朋友","共同親友／待確認"]);
});
it("keeps a mixed household together and counts its boxes only once",()=>{
 const rows=cakeRows([guest("a",{cakeHouseholdId:"h"}),guest("b",{side:"PARTNER_B",cakeHouseholdId:"h"})],[{id:"h",boxes:2}]);
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({group:"SHARED",boxes:2});
 expect(cakeRowGroups(rows).flatMap(group=>group.rows)).toHaveLength(1);
});
it("places same-side families with their companions in the family section, parents first",()=>{
 const rows=cakeRows([guest("companion",{relationshipLabel:null,cakeHouseholdId:"h"}),guest("mother",{relationshipLabel:"媽媽"}),guest("father",{relationshipLabel:"爸爸"}),guest("relative",{category:"FAMILY",cakeHouseholdId:"h",relationshipLabel:"姨母"})],[{id:"h",boxes:1}]);
 expect(rows.map(row=>row.group)).toEqual(["GROOM_FAMILY","GROOM_FAMILY","GROOM_FAMILY"]);
 expect(rows.slice(0,2).map(row=>row.names)).toEqual(["father","mother"]);
 expect(rows.reduce((sum,row)=>sum+row.boxes,0)).toBe(3);
});

it("keeps the household classification stable when only one side attends",()=>{
 const rows=cakeRows([guest("a",{cakeHouseholdId:"h"}),guest("b",{side:"PARTNER_B",cakeHouseholdId:"h",attendanceStatus:"DECLINED"})],[{id:"h",boxes:1}]);
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({names:"a",group:"SHARED",boxes:1});
});
