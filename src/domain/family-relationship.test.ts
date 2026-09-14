import { describe, expect, it } from "vitest";
import { FAMILY_RELATIONSHIP_GROUPS, FAMILY_RELATIONSHIP_VALUES, searchFamilyRelationships } from "./family-relationship";
describe("family relationship suggestions", () => {
  it("places parents and close family before more distant relatives", () => {
    expect(FAMILY_RELATIONSHIP_VALUES.slice(0, 2)).toEqual(["父親", "母親"]);
    const sequence = ["父親", "母親", "哥哥", "祖父", "伯父", "堂兄", "高祖父"];
    const positions = sequence.map(value => FAMILY_RELATIONSHIP_VALUES.indexOf(value));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
  it("has unique values across paternal, maternal, cousin and in-law groups", () => {
    expect(new Set(FAMILY_RELATIONSHIP_VALUES).size).toBe(FAMILY_RELATIONSHIP_VALUES.length);
    for (const name of ["祖父", "外祖母", "舅母", "姑丈", "堂弟媳", "姑表姊", "舅表兄", "姨表妹", "外甥女", "外孫", "親家母"]) expect(FAMILY_RELATIONSHIP_VALUES).toContain(name);
    expect(FAMILY_RELATIONSHIP_GROUPS.find(group => group.label === "配偶與姻親")?.options).toContainEqual(["小叔", "丈夫的弟弟"]);
  });
});

describe("searchable relationship ordering", () => {
  it("puts male titles before female titles within each generation and category", () => {
    for (const [male, female] of [["父親", "母親"], ["弟弟", "姊姊"], ["妹夫", "嫂嫂"], ["姑丈", "姑母"], ["外孫", "孫女"]]) {
      expect(FAMILY_RELATIONSHIP_VALUES.indexOf(male)).toBeLessThan(FAMILY_RELATIONSHIP_VALUES.indexOf(female));
    }
    expect(FAMILY_RELATIONSHIP_VALUES.indexOf("孫女")).toBeLessThan(FAMILY_RELATIONSHIP_VALUES.indexOf("曾孫"));
    expect(FAMILY_RELATIONSHIP_VALUES.indexOf("曾孫女")).toBeLessThan(FAMILY_RELATIONSHIP_VALUES.indexOf("玄孫"));
  });
  it("searches aliases and non-contiguous characters while preserving order for equal matches", () => {
    expect(searchFamilyRelationships("爸爸")[0].value).toBe("父親");
    expect(searchFamilyRelationships("舅媽")[0].value).toBe("舅母");
    expect(searchFamilyRelationships("外父").map(option => option.value)).toContain("外祖父");
    expect(searchFamilyRelationships("兄弟姊妹與配偶").map(option => option.value)).toEqual(["姊夫", "妹夫", "嫂嫂", "弟媳"]);
    expect(searchFamilyRelationships("不存在的稱謂")).toEqual([]);
  });
});

it("explains every title and also searches by relationship path", () => {
 const options = searchFamilyRelationships("");
 expect(options.every(option => Boolean(option.description))).toBe(true);
 expect(searchFamilyRelationships("爸爸的哥哥").some(option => option.value === "伯父")).toBe(true);
 expect(options.find(option => option.value === "姨母")?.description).toBe("媽媽的姊妹");
});
