import { describe, expect, it } from "vitest";
import {
  normalizeWeddingStaffDetails,
  WeddingStaffValidationError,
} from "./wedding-staff";

describe("wedding staff domain", () => {
  it("normalizes outer whitespace while preserving notes line breaks", () => {
    expect(
      normalizeWeddingStaffDetails({
        roleName: "  婚禮主持  ",
        personName: "  林小美  ",
        contactPhone: "  0912 345 678  ",
        notes: "  第一段\n  第二段  ",
      }),
    ).toEqual({
      roleName: "婚禮主持",
      personName: "林小美",
      contactPhone: "0912 345 678",
      notes: "第一段\n  第二段",
    });
  });

  it.each([
    [{ roleName: "", personName: "人", contactPhone: "", notes: "" }, "職務"],
    [
      {
        roleName: "職務",
        personName: "人".repeat(121),
        contactPhone: "",
        notes: "",
      },
      "姓名",
    ],
    [
      {
        roleName: "職務",
        personName: "人",
        contactPhone: "0".repeat(41),
        notes: "",
      },
      "電話",
    ],
    [
      {
        roleName: "職務",
        personName: "人",
        contactPhone: "",
        notes: "備".repeat(501),
      },
      "備註",
    ],
  ])("rejects bounded invalid staff fields", (input, message) => {
    expect(() => normalizeWeddingStaffDetails(input)).toThrow(
      WeddingStaffValidationError,
    );
    expect(() => normalizeWeddingStaffDetails(input)).toThrow(message);
  });
});
