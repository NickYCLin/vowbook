import { describe, expect, it } from "vitest";
import { FAMILY_RELATIONSHIP_GROUPS, FAMILY_RELATIONSHIP_VALUES } from "./family-relationship";
describe("family relationship suggestions", () => {
  it("orders suggestions from ancestors through peers to descendants", () => {
    const sequence = ["高祖父", "曾祖父", "祖父", "伯祖父", "父親", "伯父", "舅父", "哥哥", "堂兄", "表兄", "丈夫", "兒子", "孫子", "曾孫", "玄孫"];
    const positions = sequence.map(value => FAMILY_RELATIONSHIP_VALUES.indexOf(value));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
  it("has unique values across paternal, maternal, cousin and in-law groups", () => {
    expect(new Set(FAMILY_RELATIONSHIP_VALUES).size).toBe(FAMILY_RELATIONSHIP_VALUES.length);
    for (const name of ["祖父", "外祖母", "舅母", "姑丈", "堂弟媳", "姑表姊", "舅表兄", "姨表妹", "外甥女", "外孫", "親家母"]) expect(FAMILY_RELATIONSHIP_VALUES).toContain(name);
    expect(FAMILY_RELATIONSHIP_GROUPS.find(group => group.label === "配偶與姻親")?.options).toContainEqual(["小叔", "丈夫的弟弟"]);
  });
});
