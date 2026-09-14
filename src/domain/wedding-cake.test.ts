import { describe, expect, it } from "vitest";
import { cakeRows, cakeCsv, normalizeCakeHousehold } from "./wedding-cake";
const guest = (id: string, extra = {}) => ({ id, name: id, seniority: "PEER" as const, side: "PARTNER_A" as const, attendanceStatus: "ATTENDING", checkedIn: false, relationshipLabel: "表姊", cakeHouseholdId: null as string | null, ...extra });
describe("cake distribution", () => {
  it("counts a household once, excludes absent members and never multiplies party size", () => {
    const rows = cakeRows([guest("a", { cakeHouseholdId: "h", partySize: 4 }), guest("b", { cakeHouseholdId: "h" }), guest("c", { cakeHouseholdId: "h", attendanceStatus: "DECLINED" }), guest("d", { partySize: 3 }), guest("e", { attendanceStatus: "UNDECIDED" })], [{id:"h", boxes:1}]);
    expect(rows.map(r => [r.names, r.boxes])).toEqual([["a、b",1],["d",1]]);
    expect(rows[0].relationships).toBe("a：新郎的表姊；b：新郎的表姊");
  });
  it("distinguishes both partners' fathers in a shared household and CSV", () => {
    const rows = cakeRows([guest("a", { relationshipLabel: "父親", cakeHouseholdId: "h" }), guest("b", { side: "PARTNER_B", relationshipLabel: "父親", cakeHouseholdId: "h" })], [{id:"h", boxes:1}]);
    expect(rows[0].relationships).toBe("a：新郎的父親；b：新娘的父親");
    expect(rows[0].boxes).toBe(1);
    expect(cakeCsv(rows)).toContain("a：新郎的父親；b：新娘的父親");
  });
  it("keeps shared relationships neutral and makes missing titles explicit", () => {
    const rows = cakeRows([guest("a", { side: "SHARED", relationshipLabel: "朋友" }), guest("b", { side: "PARTNER_B", relationshipLabel: null }), guest("c", { relationshipLabel: "二舅" })], []);
    expect(rows.map(row => row.relationships)).toEqual(["a：共同親友：朋友", "b：新娘親友（稱謂未填）", "c：新郎的二舅"]);
  });
  it("includes checked-in guests and respects custom household box counts", () => {
    expect(cakeRows([guest("a", { checkedIn:true, attendanceStatus:"DECLINED", cakeHouseholdId:"h" })], [{id:"h",boxes:2}])[0].boxes).toBe(2);
    expect(cakeRows([guest("a", { attendanceStatus:"DECLINED", cakeHouseholdId:"h" })], [{id:"h",boxes:2}])).toEqual([]);
  });
  it("escapes CSV punctuation, line breaks and formula prefixes", () => {
    const csv = cakeCsv([{ key:"a", names:'=SUM(1,2)"\n', relationships:"@alias", boxes:1 }]);
    expect(csv).toContain('"\'=SUM(1,2)""\n"');
    expect(csv).toContain('"\'@alias"');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
  it("validates household members and whole box counts", () => {
    const data = new FormData(); data.set("name","林家"); data.set("boxes","1"); data.append("guestId","a");
    expect(normalizeCakeHousehold(data)).toEqual({name:"林家", boxes:1, guestIds:["a"]});
    data.set("boxes","1.5"); expect(() => normalizeCakeHousehold(data)).toThrow();
    data.set("boxes","1"); data.delete("guestId"); expect(() => normalizeCakeHousehold(data)).toThrow();
  });
});
