import { describe, expect, it } from "vitest";
import {
  hasGuestDetails,
  normalizeGuestDetailsInput,
} from "./guest-details";

describe("guest contact and RSVP details", () => {
  it("normalizes optional details independently from import provenance", () => {
    const details = normalizeGuestDetailsInput({
      relationshipLabel: "  大學同學  ",
      contactPhone: "  0900-000-000  ",
      contactEmail: "  GUEST@EXAMPLE.TEST  ",
      ceremonyAttendance: "ATTENDING",
      childSeatCount: "1",
      vegetarianCount: "0",
      invitationDelivery: "DIGITAL",
      mailingAddress: "",
      guestMessage: "  祝福新人  ",
      attendanceReply: "  會出席  ",
      invitationReply: "  已傳送電子喜帖  ",
    });

    expect(details).toEqual({
      relationshipLabel: "大學同學",
      contactPhone: "0900-000-000",
      contactEmail: "GUEST@EXAMPLE.TEST",
      ceremonyAttendance: true,
      childSeatCount: 1,
      vegetarianCount: 0,
      invitationDelivery: "DIGITAL",
      mailingAddress: null,
      guestMessage: "祝福新人",
      attendanceReply: "會出席",
      invitationReply: "已傳送電子喜帖",
    });
    expect(hasGuestDetails(details)).toBe(true);
  });

  it("keeps a completely blank optional section empty", () => {
    const details = normalizeGuestDetailsInput({
      relationshipLabel: "",
      contactPhone: "",
      contactEmail: "",
      ceremonyAttendance: "",
      childSeatCount: "",
      vegetarianCount: "",
      invitationDelivery: "",
      mailingAddress: "",
      guestMessage: "",
      attendanceReply: "",
      invitationReply: "",
    });

    expect(hasGuestDetails(details)).toBe(false);
    expect(Object.values(details).every((value) => value === null)).toBe(true);
  });

  it.each([
    [
      { contactEmail: "not-an-email" },
      "電子信箱格式不正確。",
    ],
    [
      { childSeatCount: "21" },
      "兒童座椅需為 0 到 20 的整數。",
    ],
    [
      { invitationDelivery: "PAPER", mailingAddress: "" },
      "選擇紙本喜帖時請填寫寄送地址。",
    ],
    [
      { invitationDelivery: "", invitationReply: "已寄出" },
      "填寫喜帖回覆補充前，請先選擇喜帖方式。",
    ],
  ])("rejects invalid optional details", (overrides, message) => {
    expect(() =>
      normalizeGuestDetailsInput({
        relationshipLabel: "",
        contactPhone: "",
        contactEmail: "",
        ceremonyAttendance: "",
        childSeatCount: "",
        vegetarianCount: "",
        invitationDelivery: "",
        mailingAddress: "",
        guestMessage: "",
        attendanceReply: "",
        invitationReply: "",
        ...overrides,
      }),
    ).toThrow(message);
  });
});
